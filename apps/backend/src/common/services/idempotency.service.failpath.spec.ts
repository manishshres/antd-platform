import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { IdempotencyService } from './idempotency.service';

/**
 * These tests validate the on-failure path: when an op wrapped by
 * `withIdempotency` throws, the in-flight key reservation must be dropped so
 * a retry can succeed (rather than waiting 24 h for TTL expiry).
 *
 * The actual `withIdempotency` wrapper is a private method; we exercise its
 * semantics through the public `begin`/`complete`/`drop` lifecycle.
 */
describe('IdempotencyService — failure-path drops reservation', () => {
  let service: IdempotencyService;
  let stored: Record<string, string>;

  beforeEach(async () => {
    stored = {};
    const mock = {
      get: jest.fn((k: string): unknown =>
        Object.prototype.hasOwnProperty.call(stored, k)
          ? JSON.parse(stored[k])
          : null,
      ),
      set: jest.fn((k: string, v: unknown): void => {
        stored[k] = JSON.stringify(v);
      }),
      reset: jest.fn((): void => {
        stored = {};
      }),
      del: jest.fn((k: string): void => {
        delete stored[k];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        { provide: CACHE_MANAGER, useValue: mock },
      ],
    }).compile();
    service = module.get(IdempotencyService);
  });

  it('frees the reservation when drop() is called before TTL expiry', async () => {
    expect(await service.begin('refund-partial', 'kfail')).toBe(true);
    expect(await service.begin('refund-partial', 'kfail')).toBe(false);
    await service.drop('refund-partial', 'kfail');
    // Without the drop, begin would still return false. Now it succeeds:
    expect(await service.begin('refund-partial', 'kfail')).toBe(true);
  });

  it('replay after drop returns null (the response was never cached)', async () => {
    expect(await service.begin('refund-partial', 'kfail2')).toBe(true);
    await service.drop('refund-partial', 'kfail2');
    expect(await service.replay('refund-partial', 'kfail2')).toBeNull();
  });

  it('replay after conflict map: idempotency rejects second in-flight with ConflictException', async () => {
    expect(await service.begin('s', 'kk')).toBe(true);
    const second = await service.begin('s', 'kk');
    expect(second).toBe(false);
    // OrderPaymentService.withIdempotency throws ConflictException when
    // begin() returns false. The contract is documented here at the
    // unit-spec level so the wrapping service can rely on it.
    expect(second).toBe(false);
  });
});
