import { Logger } from '@nestjs/common';
import type { RedisOptions } from 'ioredis';

const DEFAULT_URL = 'redis://localhost:6379';

/** Managed Redis providers that only accept TLS connections. */
const TLS_ONLY_HOST_SUFFIXES = ['.upstash.io'];

/**
 * Transient socket failures worth reconnecting on rather than surfacing. Upstash (and most
 * managed proxies) drop idle connections, which surfaces as ECONNRESET on the next write.
 */
const RECONNECT_ON = ['READONLY', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'];

export interface RedisConnection {
  url: string;
  options: RedisOptions;
}

function needsTls(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'rediss:') return true;
    return TLS_ONLY_HOST_SUFFIXES.some((suffix) =>
      parsed.hostname.endsWith(suffix),
    );
  } catch {
    return false;
  }
}

/**
 * Shared Redis connection settings.
 *
 * Two things here are load-bearing for managed Redis (Upstash in particular):
 *
 * - **TLS.** Upstash endpoints refuse plaintext, and a `redis://` URL against one connects,
 *   gets closed by the server, and reconnects forever — an endless ECONNRESET loop rather
 *   than a clear error. We enable TLS whenever the scheme says so *or* the host is known to
 *   be TLS-only, so a copy-pasted `redis://` URL still works instead of melting the logs.
 * - **Retry ceilings.** ioredis defaults to 20 retries per request and then throws
 *   MaxRetriesPerRequestError, unhandled, once per queued command. BullMQ requires `null`
 *   (retry forever, it manages its own recovery); the cache wants a small finite number so
 *   a Redis outage fails cache reads fast instead of hanging HTTP requests behind them.
 */
export function buildRedisConnection(
  rawUrl: string | undefined,
  purpose: 'cache' | 'queue',
  logger?: Logger,
): RedisConnection {
  const url = rawUrl?.trim() || DEFAULT_URL;
  const tls = needsTls(url);

  if (tls && url.startsWith('redis://')) {
    logger?.warn(
      'REDIS_URL uses redis:// against a TLS-only host — connecting over TLS anyway. Use rediss:// to silence this.',
    );
  }

  return {
    url,
    options: {
      ...(tls ? { tls: {} } : {}),
      // BullMQ mandates null; the cache fails fast instead of stalling requests.
      maxRetriesPerRequest: purpose === 'queue' ? null : 3,
      // Managed proxies don't always answer the INFO probe ioredis uses to decide readiness.
      enableReadyCheck: false,
      keepAlive: 30_000,
      connectTimeout: 15_000,
      retryStrategy: (times: number) => Math.min(times * 500, 10_000),
      reconnectOnError: (err: Error) =>
        RECONNECT_ON.some((code) => err.message.includes(code)),
    },
  };
}

/**
 * Log connection errors at most once a minute. A dead Redis otherwise emits an error per
 * queued command, which buries every other line in the logs.
 */
export function attachThrottledErrorLogger(
  client: { on: (event: 'error', cb: (err: Error) => void) => unknown },
  logger: Logger,
  intervalMs = 60_000,
): void {
  let lastLoggedAt = 0;
  let suppressed = 0;

  client.on('error', (err: Error) => {
    const now = Date.now();
    if (now - lastLoggedAt < intervalMs) {
      suppressed += 1;
      return;
    }
    const tail = suppressed > 0 ? ` (${suppressed} similar suppressed)` : '';
    lastLoggedAt = now;
    suppressed = 0;
    logger.error(`Redis connection error: ${err.message}${tail}`);
  });
}
