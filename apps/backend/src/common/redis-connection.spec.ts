import { Logger } from '@nestjs/common';
import {
  attachThrottledErrorLogger,
  buildRedisConnection,
} from './redis-connection';

describe('buildRedisConnection', () => {
  it('enables TLS for rediss:// URLs', () => {
    const { options } = buildRedisConnection(
      'rediss://x.upstash.io:6379',
      'queue',
    );

    expect(options.tls).toEqual({});
  });

  it('enables TLS for an Upstash host even when the scheme says plaintext', () => {
    // The failure this prevents: plaintext against a TLS-only endpoint reconnects forever
    // on ECONNRESET instead of erroring, which floods the logs and never recovers.
    const warn = jest.fn();
    const logger = { warn } as unknown as Logger;
    const { options } = buildRedisConnection(
      'redis://default:tok@eu1-abc.upstash.io:6379',
      'cache',
      logger,
    );

    expect(options.tls).toEqual({});
    expect(warn).toHaveBeenCalled();
  });

  it('leaves a plain local Redis untouched', () => {
    const { url, options } = buildRedisConnection(undefined, 'cache');

    expect(url).toBe('redis://localhost:6379');
    expect(options.tls).toBeUndefined();
  });

  it('retries forever for queues and finitely for the cache', () => {
    // BullMQ mandates null; the cache must fail fast so requests don't stall behind Redis.
    expect(
      buildRedisConnection(undefined, 'queue').options.maxRetriesPerRequest,
    ).toBeNull();
    expect(
      buildRedisConnection(undefined, 'cache').options.maxRetriesPerRequest,
    ).toBe(3);
  });
});

describe('attachThrottledErrorLogger', () => {
  it('logs once per interval and reports how many it swallowed', () => {
    const handlers: ((err: Error) => void)[] = [];
    const client = {
      on: (_e: 'error', cb: (err: Error) => void) => handlers.push(cb),
    };
    const error = jest.fn<void, [string]>();
    const logger = { error } as unknown as Logger;

    attachThrottledErrorLogger(client, logger, 60_000);
    for (let i = 0; i < 50; i++) handlers[0](new Error('ECONNRESET'));

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('ECONNRESET');
  });
});
