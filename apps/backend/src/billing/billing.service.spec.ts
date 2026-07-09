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
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([{ id: 'org-1' }]),
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
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_key: string, def?: unknown) => def) },
        },
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
});
