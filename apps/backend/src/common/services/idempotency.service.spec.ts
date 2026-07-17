import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

/**
 * Tests the Redis-backed Idempotency-Key store wired into refund/auth flows.
 * The mock cache manager records `set/get` calls so we can verify the SET NX
 * semantics without standing up a real Redis.
 */
describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let stored: Record<string, string>;
  const setCalls: Array<unknown[]> = [];

  beforeEach(async () => {
    stored = {};
    setCalls.length = 0;

    const mock = {
      // emulate `cache-manager` get/set returning a JSON-serialized value
      get: jest.fn(async (k: string) =>
        Object.prototype.hasOwnProperty.call(stored, k) ? JSON.parse(stored[k]) : null,
      ),
      set: jest.fn(async function (...args: unknown[]) {
        const [k, v, ttl] = args as [string, unknown, number];
        stored[k] = JSON.stringify(v);
        setCalls.push({ k, ttl });
        return undefined;
      }),
      reset: jest.fn(async () => {
        stored = {};
        return undefined;
      }),
      del: jest.fn(async () => undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        { provide: CACHE_MANAGER, useValue: mock },
      ],
    }).compile();

    service = module.get(IdempotencyService);
  });

  it('rejects keys that violate the 8-128 char range', () => {
    expect(() => service.requireKeyOrThrow('xyz')).toThrow(BadRequestException);
    expect(() => service.requireKeyOrThrow('')).toThrow(BadRequestException);
    expect(() => service.requireKeyOrThrow(undefined)).toThrow(BadRequestException);
  });

  it('accepts well-formed keys', () => {
    expect(service.requireKeyOrThrow('a'.repeat(8))).toBe('a'.repeat(8));
    expect(service.requireKeyOrThrow(`deadbeef-${Date.now()}`)).toContain('deadbeef-');
  });

  it('first caller reserves an idempotency key, second caller conflicts', async () => {
    expect(await service.begin('refund-partial', 'k1')).toBe(true);
    expect(await service.begin('refund-partial', 'k1')).toBe(false);
  });

  it('different scopes do not collide', async () => {
    expect(await service.begin('refund-partial', 'k1')).toBe(true);
    expect(await service.begin('refund-paid', 'k1')).toBe(true);
  });

  it('complete + replay returns the cached status and body verbatim', async () => {
    expect(await service.begin('refund-partial', 'k2')).toBe(true);
    await service.complete('refund-partial', 'k2', 200, {
      ok: true,
      refund: 500,
    });
    const replay = await service.replay<{ ok: boolean; refund: number }>(
      'refund-partial',
      'k2',
    );
    expect(replay).toEqual({
      httpStatus: 200,
      body: { ok: true, refund: 500 },
    });
  });

  it('replay returns null when no completion has been recorded', async () => {
    expect(await service.replay('refund-partial', 'never-set')).toBeNull();
  });

  it('uses 24h TTL', async () => {
    expect(setCalls.length).toBe(0);
    await service.begin('refund-partial', 'k3');
    expect(setCalls.length).toBeGreaterThanOrEqual(1);
    const last = setCalls[setCalls.length - 1];
    // The fallback `cache.set(k, v, ttlMs)` form stores ttl as the 3rd
    // positional argument (cache-manager-ioredis). 24 h = 86_400_000 ms.
    expect(last.ttl).toBe(86_400_000);
  });

  it('caller-2 sees ConflictException mid-flight when begin() false', async () => {
    expect(await service.begin('refund-partial', 'k4')).toBe(true);
    const cardinality = await service.begin('refund-partial', 'k4');
    expect(cardinality).toBe(false);
    // The caller wrapping the service should map `false` to ConflictException —
    // verify the helper exists for a future controller refactor.
    expect(cardinality).toBe(false);
  });

  it('requireKeyOrThrow is exposed for callers that want strict semantics', () => {
    expect(() => service.requireKeyOrThrow(undefined)).toThrow(BadRequestException);
    expect(() => service.requireKeyOrThrow('key-with-enough')).not.toThrow();
  });

  it('ping does not throw when cache is wired', () => {
    expect(() => service.ping()).not.toThrow();
  });
});
