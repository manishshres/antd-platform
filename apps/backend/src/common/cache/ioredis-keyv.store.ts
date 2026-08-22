import { EventEmitter } from 'events';
import type Redis from 'ioredis';

/**
 * Keyv store adapter backed by the app's existing ioredis client.
 *
 * `@nestjs/cache-manager` v3 builds its cache from `stores` (Keyv instances) and ignores
 * the `store` / `redisInstance` options that older versions took. Passing the legacy shape
 * silently produced an in-memory cache — see AppModule — so every cached value lived in one
 * process only. This adapter puts the cache back on Redis without pulling in a second Redis
 * client stack: `@keyv/redis` speaks node-redis, while BullMQ and the rest of the app are
 * ioredis.
 *
 * Keyv owns serialization and namespacing; this only moves opaque strings.
 */
export class IoRedisKeyvStore extends EventEmitter {
  /** Keyv reads `opts` for its own bookkeeping; nothing here needs configuring. */
  readonly opts: Record<string, unknown> = {};

  namespace?: string;

  constructor(private readonly client: Redis) {
    super();
    // Surface connection failures to Keyv rather than leaving them unhandled.
    this.client.on('error', (err: Error) => this.emit('error', err));
  }

  async get<Value>(key: string): Promise<Value | undefined> {
    const value = await this.client.get(key);
    return (value ?? undefined) as Value | undefined;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl && ttl > 0) {
      // TTLs arrive in milliseconds throughout cache-manager v7.
      await this.client.set(key, value, 'PX', Math.ceil(ttl));
      return;
    }
    await this.client.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return (await this.client.del(key)) > 0;
  }

  /**
   * Clears only this namespace's keys. A FLUSHDB here would wipe the BullMQ queues sharing
   * the database, so the keys are scanned and deleted in batches instead.
   */
  async clear(): Promise<void> {
    const pattern = this.namespace ? `${this.namespace}:*` : '*';
    let cursor = '0';

    do {
      const [next, keys] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = next;
      if (keys.length > 0) await this.client.del(...keys);
    } while (cursor !== '0');
  }

  async has(key: string): Promise<boolean> {
    return (await this.client.exists(key)) > 0;
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }
}
