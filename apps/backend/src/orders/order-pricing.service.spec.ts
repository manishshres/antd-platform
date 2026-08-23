import { Test, TestingModule } from '@nestjs/testing';
import { DRIZZLE } from '../database/database.module';
import { OrderPricingService } from './order-pricing.service';

/**
 * Tax, discount, and rounding. The cents-math here is what the POS register
 * reads on every printed receipt, so a wrong bucket results in real money
 * drifting between the cashier's till and the nightly close.
 *
 * Originally P12-001 in PRODUCTION_AUDIT.md flagged this module as untested.
 * We start with the pure-function paths that don't need DB fixtures; the
 * DB-touching tests (`nextTicketNumber`, `requireOrgCustomer`, full
 * `priceCartItems` flow) come when a Postgres test fixture lands.
 */
describe('OrderPricingService — ticket numbers', () => {
  let service: OrderPricingService;

  /** Minimal tx: the advisory lock, then the max(ticketNumber) select. */
  const buildTx = (max: number) => ({
    execute: jest.fn().mockResolvedValue(undefined),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([{ max }]),
      }),
    }),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderPricingService, { provide: DRIZZLE, useValue: {} }],
    }).compile();
    service = module.get(OrderPricingService);
  });

  it('continues from the highest number the location has ever used', async () => {
    const tx = buildTx(41);

    await expect(
      service.nextTicketNumber(
        tx as unknown as Parameters<OrderPricingService['nextTicketNumber']>[0],
        'loc-1',
      ),
    ).resolves.toBe(42);
  });

  it('starts at 1 for a location with no orders', async () => {
    const tx = buildTx(0);

    await expect(
      service.nextTicketNumber(
        tx as unknown as Parameters<OrderPricingService['nextTicketNumber']>[0],
        'loc-1',
      ),
    ).resolves.toBe(1);
  });

  it('does not scope the count to a business day', async () => {
    // The counter used to reset at the location's local midnight, so yesterday's #14 and
    // today's #14 were both live: calling a number got two different orders. Resolving the
    // timezone was the only reason this needed the location's clock — if it is never asked
    // for, the day boundary is genuinely gone rather than merely widened.
    const timezoneSpy = jest.spyOn(service, 'getLocationTimezone');
    const tx = buildTx(7);

    await service.nextTicketNumber(tx, 'loc-1');

    expect(timezoneSpy).not.toHaveBeenCalled();
  });

  it('serialises allocation per location', async () => {
    // Postgres cannot take FOR UPDATE on an aggregate, so without the advisory lock two
    // concurrent orders read the same max and collide on the same number.
    const tx = buildTx(3);

    await service.nextTicketNumber(tx, 'loc-1');

    expect(tx.execute).toHaveBeenCalledTimes(1);
  });
});

describe('OrderPricingService — discount math', () => {
  let service: OrderPricingService;
  const db: Record<string, unknown[]> = {};

  beforeEach(async () => {
    db['taxRateBps'] = [];
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderPricingService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    service = module.get(OrderPricingService);
  });

  describe('discountAmountFor', () => {
    it('returns 0 when no discount is supplied', () => {
      expect(service.discountAmountFor(null, 1000)).toBe(0);
    });

    it('caps a fixed-cents discount at the subtotal', () => {
      // subtotal 500, discount 800 → must clamp to 500
      expect(
        service.discountAmountFor({ type: 'fixed', value: 800 }, 500),
      ).toBe(500);
    });

    it('returns the full discount amount when subtotal is greater', () => {
      expect(
        service.discountAmountFor({ type: 'fixed', value: 125 }, 1000),
      ).toBe(125);
    });

    it('returns 0 for non-positive discounts', () => {
      expect(service.discountAmountFor({ type: 'fixed', value: 0 }, 1000)).toBe(
        0,
      );
      expect(
        service.discountAmountFor({ type: 'fixed', value: -50 }, 1000),
      ).toBe(0);
    });

    it('rounds percent discounts consistently with backend createPosOrder', () => {
      // 10% of $16.64 = 1.664 → 166 cents (Math.round banker-style).
      expect(
        service.discountAmountFor({ type: 'percent', value: 10 }, 1664),
      ).toBe(166);
    });

    it('returns 0 for percent=0', () => {
      expect(
        service.discountAmountFor({ type: 'percent', value: 0 }, 1000),
      ).toBe(0);
    });

    it('handles 100% correctly', () => {
      expect(
        service.discountAmountFor({ type: 'percent', value: 100 }, 999),
      ).toBe(999);
    });
  });

  describe('getTaxRate (DB)', () => {
    it('returns 0 when locationId is null', async () => {
      expect(await service.getTaxRate(null)).toBe(0);
      expect(await service.getTaxRate(undefined)).toBe(0);
    });

    it('returns 0 when locationId is the empty string', async () => {
      // getTaxRate treats falsy as 0; guard against regression to NoRows errors.
      // We rely on the null/undefined branch — empty string follows the same path
      // because drizzle's `eq` on `''` would never match a UUID and NoRows is OK.
      expect(await service.getTaxRate('')).toBe(0);
    });

    it('returns taxRateBps when row is found', async () => {
      // Inject a bare mock that mimics drizzle's pg response shape.
      const locations = [{ id: 'loc-1', taxRateBps: 825 }];
      const qb = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(locations),
      };
      const dbMock = {
        ...db,
        select: jest.fn().mockReturnValue(qb),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OrderPricingService,
          { provide: DRIZZLE, useValue: dbMock },
        ],
      }).compile();
      const svc = module.get(OrderPricingService);
      expect(await svc.getTaxRate('loc-1')).toBe(825);
    });
  });

  describe('resolveOrderLocation (DB)', () => {
    it('returns the hinted location unchanged', async () => {
      expect(
        await service.resolveOrderLocation('org-1', 'hinted-loc', []),
      ).toBe('hinted-loc');
    });

    it('infers from a single-item location with no hint', async () => {
      expect(
        await service.resolveOrderLocation('org-1', undefined, ['loc-A']),
      ).toBe('loc-A');
    });

    it("falls back to the org's single location when items disagree", async () => {
      const locations = [{ id: 'only-loc' }];
      const qb = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(locations),
      };
      const dbMock = { ...db, select: jest.fn().mockReturnValue(qb) };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OrderPricingService,
          { provide: DRIZZLE, useValue: dbMock },
        ],
      }).compile();
      const svc = module.get(OrderPricingService);
      expect(
        await svc.resolveOrderLocation('org-1', undefined, [
          'item-loc-1',
          'item-loc-2',
        ]),
      ).toBe('only-loc');
    });

    it('returns null when the org has multiple locations and no hint resolves them', async () => {
      const locations = [{ id: 'a-loc' }, { id: 'b-loc' }];
      const qb = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(locations),
      };
      const dbMock = { ...db, select: jest.fn().mockReturnValue(qb) };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OrderPricingService,
          { provide: DRIZZLE, useValue: dbMock },
        ],
      }).compile();
      const svc = module.get(OrderPricingService);
      // Multiple item locations AND multiple org locations → can't decide.
      expect(
        await svc.resolveOrderLocation('org-1', undefined, [
          'item-loc-1',
          'item-loc-2',
        ]),
      ).toBeNull();
    });
  });
});
