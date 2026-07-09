import { Test, TestingModule } from '@nestjs/testing';
import { BillingService } from './billing.service';
import { StripeService } from '../stripe/stripe.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { TelnyxService } from '../telnyx/telnyx.service';
import { DRIZZLE } from '../database/database.module';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('BillingService', () => {
  let service: BillingService;

  const mockDb = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
    groupBy: jest.fn().mockResolvedValue([]),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([{ id: 'org-1' }]),
  };

  // Shared so individual tests can override cost-rate resolution. Defaults to
  // returning the caller-supplied fallback (i.e. the production defaults).
  const mockConfigService = {
    get: jest.fn((_key: string, def?: unknown) => def),
  };

  const mockStripeService = {
    client: {
      checkout: {
        sessions: {
          create: jest
            .fn()
            .mockResolvedValue({ url: 'http://stripe.checkout' }),
        },
      },
      billingPortal: {
        sessions: {
          create: jest.fn().mockResolvedValue({ url: 'http://stripe.portal' }),
        },
      },
    },
  };

  const mockInvoicePdfService = {
    generateInvoicePdf: jest.fn().mockResolvedValue(Buffer.from('test pdf')),
  };

  const mockTelnyxService = {
    updateAssistantDynamicVariable: jest.fn().mockResolvedValue(undefined),
  };

  const mockCacheManager = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: StripeService, useValue: mockStripeService },
        { provide: InvoicePdfService, useValue: mockInvoicePdfService },
        { provide: TelnyxService, useValue: mockTelnyxService },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRequiredOrg', () => {
    it('should throw NotFoundException if user does not exist', async () => {
      mockDb.limit.mockResolvedValueOnce([]);
      await expect(service.getRequiredOrg('user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return existing organizationId if user has one', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { id: 'user-1', email: 'test@test.com', organizationId: 'org-1' },
      ]);
      const orgId = await service.getRequiredOrg('user-1');
      expect(orgId).toBe('org-1');
    });

    it('should throw ForbiddenException if user has no organization', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { id: 'user-1', email: 'test@test.com', organizationId: null },
      ]);

      await expect(service.getRequiredOrg('user-1')).rejects.toThrow(
        'User does not belong to an organization',
      );
    });
  });

  describe('createCheckoutSession', () => {
    it('should throw BadRequestException if plan is invalid', async () => {
      // Mock user lookup for org creation
      mockDb.limit.mockResolvedValueOnce([
        { id: 'user-1', email: 'test@test.com', organizationId: 'org-1' },
      ]);

      // Mock plan lookup
      mockDb.limit.mockResolvedValueOnce([]);

      await expect(
        service.createCheckoutSession('user-1', {
          planId: 'invalid-plan',
          successUrl: '',
          cancelUrl: '',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getMarginReport — config-driven cost rates (#13)', () => {
    it('applies the configured cost rate instead of a hardcoded constant', async () => {
      // Override just the call-minute rate; everything else falls back to defaults.
      mockConfigService.get.mockImplementation((key: string, def?: unknown) =>
        key === 'COST_RATE_CALL_MINUTE_CENTS' ? 7 : def,
      );

      // Sequenced DB reads inside getMarginReport:
      mockDb.limit
        .mockResolvedValueOnce([{ organizationId: 'org-1' }]) // getRequiredOrg → user lookup
        .mockResolvedValueOnce([{ id: 'loc-1' }]) // location ownership check
        .mockResolvedValueOnce([]); // subscription (none → revenue 0, skip Stripe)
      mockDb.groupBy.mockResolvedValueOnce([
        { eventType: 'call_minutes', totalAmount: 10 },
      ]);

      const report = await service.getMarginReport('user-1', 'loc-1');

      // 10 call minutes * 7 cents (from config) = 70, not the default of 50.
      expect(report.costCents).toBe(70);
      expect(report.revenueCents).toBe(0);
      expect(report.marginCents).toBe(-70);
      expect(report.usageDetails.call_minutes).toBe(10);
      expect(mockConfigService.get).toHaveBeenCalledWith(
        'COST_RATE_CALL_MINUTE_CENTS',
        5,
      );
    });
  });
});
