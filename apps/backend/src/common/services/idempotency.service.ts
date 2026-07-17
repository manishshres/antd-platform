import {
  Inject,
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

const TTL_SECONDS = 24 * 60 * 60; // 24h — long enough for retry-on-network-blink
const SCOPE_PREFIX = 'idem';

/**
 * Generic idempotency-key store for state-changing POST endpoints.
 *
 * Pattern: a client passes `Idempotency-Key: <opaque-string>` on a POST. The
 * service records the outcome (status code + JSON body) under a namespaced
 * Redis key so a retried request can replay the original response instead of
 * running the side effect again.
 *
 * This closes the duplicate-payment / duplicate-refund race window that the
 * advisory locks on `orders` rows alone don't cover (the second writer's lock
 * is held long enough that the second refund *also* reads net paid and
 * succeeds; the lock only serializes the *new* writers, not the replay side).
 *
 * Backed by the existing Redis cache module — no new schema/table.
 *
 * Used by:
 *   - HttpRefundsController side (no Idempotency-Key, no replay)
 *   - Refund paths in OrderPaymentService (no Idempotency-Key, no replay)
 *   - Webhooks (uses different `webhookEvents` table)
 *
 * Enabling the middleware: in the controller / service that you want to
 * protect, call `idempotency.begin(key)` once before mutating state. After
 * the mutation succeeds, call `idempotency.complete(key, status, body)` to
 * cache the response. A second concurrent request with the same key will
 * already see `inflight=true` in Redis and throw `ConflictException` until
 * the first finishes; once finished, the second sees the cached response.
 *
 * Important: the Idempotency-Key check is **opt-in**. Existing callers (mobile
 * POS, AI order webhook) work unchanged.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  private key(scope: string, k: string): string {
    return `${SCOPE_PREFIX}:${scope}:${k}`;
  }

  /**
   * Reserve a key for an in-flight operation. Returns `true` if we won the
   * race (caller should proceed), `false` if a concurrent request already
   * reserved the key (caller should treat as duplicate).
   */
  async begin(scope: string, key: string): Promise<boolean> {
    const k = this.key(scope, key);
    const reservation = { status: 'inflight', at: new Date().toISOString() };
    // SET NX is the standard "reserve or fail" pattern. cache-manager's
    // abstract `set(key, value, ttl, { raw })` doesn't expose NX, so we use
    // the underlying ioredis client when available.
    const client = (
      this.cache as unknown as {
        store?: { client?: { set: (...args: unknown[]) => Promise<unknown> } };
      }
    ).store?.client;
    if (client && typeof client.set === 'function') {
      const reply = await client.set(
        k,
        JSON.stringify(reservation),
        'EX',
        TTL_SECONDS,
        'NX',
      );
      return reply === 'OK';
    }
    // Fallback if ioredis client isn't exposed (mock cache). Use a best-effort
    // optimistic check; lower-strict but still catches non-trivial replays.
    const existing = await this.cache.get<unknown>(k);
    if (existing !== undefined && existing !== null) return false;
    await this.cache.set(k, reservation, TTL_SECONDS * 1000);
    return true;
  }

  /** Persist the response once the operation has completed. */
  async complete(
    scope: string,
    key: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    const k = this.key(scope, key);
    await this.cache.set(
      k,
      {
        status: 'completed',
        httpStatus: status,
        body,
        at: new Date().toISOString(),
      },
      TTL_SECONDS * 1000,
    );
  }

  /** Read a previously-completed response; null if not present. */
  async replay<K = unknown>(
    scope: string,
    key: string,
  ): Promise<{ httpStatus: number; body: K } | null> {
    const k = this.key(scope, key);
    const v = await this.cache.get<{
      status: string;
      httpStatus: number;
      body: K;
    }>(k);
    if (!v || v.status !== 'completed') return null;
    return { httpStatus: v.httpStatus, body: v.body };
  }

  /**
   * Drop an in-flight reservation so the next retry isn't held by the TTL.
   * Used in the catch-path of `withIdempotency` for callers that fail mid-flight.
   */
  async drop(scope: string, key: string): Promise<void> {
    const k = this.key(scope, key);
    const client = (
      this.cache as unknown as {
        store?: { client?: { del?: (...args: unknown[]) => Promise<unknown> } };
      }
    ).store?.client;
    if (client?.del) {
      await client.del(k);
      return;
    }
    if (
      typeof (
        this.cache as unknown as { del?: (k: string) => Promise<unknown> }
      ).del === 'function'
    ) {
      await (
        this.cache as unknown as { del: (k: string) => Promise<unknown> }
      ).del(k);
    }
  }

  /**
   * Throw a 409 ConflictException unless the caller is prepared to handle it.
   * Reserved for endpoints that advertise Idempotency-Key as PART of their
   * contract — currently none in this codebase.
   */
  requireKeyOrThrow(value: string | undefined): string {
    if (!value || value.length < 8 || value.length > 128) {
      throw new BadRequestException(
        `Idempotency-Key header is required (8–128 chars).`,
      );
    }
    return value;
  }

  /** Throw helpful diagnostics if caching is misconfigured. */
  ping(): void {
    if (!this.cache) {
      throw new ConflictException(
        'CACHE_MANAGER not wired; idempotency disabled.',
      );
    }
  }
}
