import Keyv from 'keyv';
import { createCache } from 'cache-manager';
import type Redis from 'ioredis';
import { IoRedisKeyvStore } from './ioredis-keyv.store';

/** Minimal in-memory stand-in for the ioredis surface this adapter uses. */
class FakeRedis {
  readonly store = new Map<string, string>();
  readonly expiries = new Map<string, number>();
  readonly commands: string[] = [];

  on() {
    return this;
  }

  get(key: string) {
    this.commands.push('get');
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string, mode?: string, ttl?: number) {
    this.commands.push(mode === 'PX' ? `set:px:${ttl}` : 'set');
    this.store.set(key, value);
    if (ttl) this.expiries.set(key, ttl);
    return Promise.resolve('OK');
  }

  del(...keys: string[]) {
    const hits = keys.filter((k) => this.store.delete(k)).length;
    return Promise.resolve(hits);
  }

  exists(key: string) {
    return Promise.resolve(this.store.has(key) ? 1 : 0);
  }

  scan(_cursor: string, _match: string, pattern: string) {
    const prefix = pattern.replace(/\*$/, '');
    const keys = [...this.store.keys()].filter((k) => k.startsWith(prefix));
    return Promise.resolve(['0', keys] as [string, string[]]);
  }

  quit() {
    return Promise.resolve('OK');
  }
}

const buildCache = () => {
  const redis = new FakeRedis();
  const keyv = new Keyv({
    store: new IoRedisKeyvStore(redis as unknown as Redis),
    namespace: 'antd-cache',
  });
  return { redis, cache: createCache({ stores: [keyv], ttl: 3_600_000 }) };
};

describe('IoRedisKeyvStore wired into cache-manager', () => {
  it('round-trips a value through Redis rather than process memory', async () => {
    // The bug this covers: @nestjs/cache-manager v3 ignores the v2 `{ store, redisInstance }`
    // options, so the cache silently ran in-memory and nothing reached Redis at all.
    const { redis, cache } = buildCache();

    await cache.set('org_status:org-1', 'active');

    expect(await cache.get('org_status:org-1')).toBe('active');
    expect(redis.commands.filter((c) => c.startsWith('set'))).toHaveLength(1);
    expect([...redis.store.keys()][0]).toContain('org_status:org-1');
  });

  it('applies the module TTL in milliseconds', async () => {
    // `ttl: 3600` was written for the v4 seconds API; under v7 that is 3.6 seconds.
    const { redis, cache } = buildCache();

    await cache.set('k', 'v');

    const [key] = [...redis.expiries.keys()];
    expect(redis.expiries.get(key)).toBe(3_600_000);
  });

  it('honours a per-call TTL', async () => {
    const { redis, cache } = buildCache();

    await cache.set('k', 'v', 30_000);

    const [key] = [...redis.expiries.keys()];
    expect(redis.expiries.get(key)).toBe(30_000);
  });

  it('deletes and reports misses', async () => {
    const { cache } = buildCache();
    await cache.set('k', 'v');

    await cache.del('k');

    expect(await cache.get('k')).toBeUndefined();
  });

  it('clear() scans its namespace instead of flushing the shared database', async () => {
    // A FLUSHDB here would wipe the BullMQ queues sharing this Redis.
    const { redis, cache } = buildCache();
    await cache.set('k', 'v');
    redis.store.set('bull:print-queue:1', 'job');

    await cache.clear();

    expect(redis.store.has('bull:print-queue:1')).toBe(true);
  });
});
