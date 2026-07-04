/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { StripeWebhookService } from './stripe-webhook.service';
import { StripeService } from './stripe.service';
import { DRIZZLE } from '../database/database.module';

describe('StripeWebhookService', () => {
  let service: StripeWebhookService;
  let dbMock: any;
  let stripeServiceMock: any;

  beforeEach(async () => {
    let qb: any;
    const mockQueryBuilder = (result: any) => {
      qb = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve(result),
      };
      return qb;
    };

    dbMock = {
      select: jest.fn(() => mockQueryBuilder([])),
      insert: jest.fn(() => mockQueryBuilder([])),
      update: jest.fn(() => mockQueryBuilder([])),
      get qb() {
        return qb;
      },
    };

    stripeServiceMock = {
      client: {
        subscriptions: {
          retrieve: jest.fn(),
        },
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        { provide: DRIZZLE, useValue: dbMock },
        { provide: StripeService, useValue: stripeServiceMock },
      ],
    }).compile();

    service = module.get<StripeWebhookService>(StripeWebhookService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleEvent', () => {
    it('checkout.session.completed should create new subscription if not exists', async () => {
      const session = {
        client_reference_id: 'org-1',
        subscription: 'sub_123',
        customer: 'cus_123',
      };

      stripeServiceMock.client.subscriptions.retrieve.mockResolvedValueOnce({
        status: 'active',
        cancel_at_period_end: false,
        current_period_end: 1672531200,
        items: { data: [{ price: { id: 'price_growth_placeholder' } }] },
      });

      // Plans table lookup
      dbMock.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          then: (resolve: any) => resolve([]), // No plan found, fallback to map
        })
        // Subscriptions table lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          then: (resolve: any) => resolve([]), // No existing sub
        });

      const insertValuesMock = jest.fn().mockResolvedValueOnce([]);
      dbMock.insert.mockReturnValueOnce({
        values: insertValuesMock,
      });

      await service.handleEvent({
        type: 'checkout.session.completed',
        data: { object: session },
      } as any);

      expect(
        stripeServiceMock.client.subscriptions.retrieve,
      ).toHaveBeenCalledWith('sub_123');
      expect(dbMock.insert).toHaveBeenCalled();
      // Should fallback to 'growth' plan based on price_growth_placeholder
      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({ planId: 'growth' }),
      );
    });

    it('checkout.session.completed should update subscription if exists', async () => {
      const session = {
        client_reference_id: 'org-1',
        subscription: 'sub_123',
        customer: 'cus_123',
      };

      stripeServiceMock.client.subscriptions.retrieve.mockResolvedValueOnce({
        status: 'active',
        cancel_at_period_end: false,
        current_period_end: 1672531200,
        items: { data: [{ price: { id: 'price_enterprise_placeholder' } }] },
      });

      // Plans table lookup
      dbMock.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          then: (resolve: any) => resolve([{ id: 'enterprise-custom' }]), // Found plan in DB
        })
        // Subscriptions table lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          then: (resolve: any) => resolve([{ id: 'existing-sub' }]), // Sub exists
        });

      const updateSetMock = jest.fn().mockReturnThis();
      dbMock.update.mockReturnValueOnce({
        set: updateSetMock,
        where: jest.fn().mockResolvedValueOnce([]),
      });

      await service.handleEvent({
        type: 'checkout.session.completed',
        data: { object: session },
      } as any);

      expect(dbMock.update).toHaveBeenCalled();
      expect(updateSetMock).toHaveBeenCalledWith(
        expect.objectContaining({ planId: 'enterprise-custom' }),
      );
    });

    it('customer.subscription.updated should update existing subscription by sub id', async () => {
      const subscription = {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'past_due',
        cancel_at_period_end: true,
        current_period_end: 1672531200,
        items: { data: [{ price: { id: 'price_growth_placeholder' } }] },
      };

      dbMock.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          then: (resolve: any) => resolve([]), // Plan not found
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          then: (resolve: any) => resolve([{ id: 'existing-sub' }]), // Sub found by sub_id
        });

      const updateSetMock = jest.fn().mockReturnThis();
      dbMock.update.mockReturnValueOnce({
        set: updateSetMock,
        where: jest.fn().mockResolvedValueOnce([]),
      });

      await service.handleEvent({
        type: 'customer.subscription.updated',
        data: { object: subscription },
      } as any);

      expect(dbMock.update).toHaveBeenCalled();
      expect(updateSetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'past_due',
          cancelAtPeriodEnd: true,
        }),
      );
    });

    it('customer.subscription.deleted should downgrade to free', async () => {
      const subscription = {
        id: 'sub_123',
      };

      const updateSetMock = jest.fn().mockReturnThis();
      dbMock.update.mockReturnValueOnce({
        set: updateSetMock,
        where: jest.fn().mockResolvedValueOnce([]),
      });

      await service.handleEvent({
        type: 'customer.subscription.deleted',
        data: { object: subscription },
      } as any);

      expect(dbMock.update).toHaveBeenCalled();
      expect(updateSetMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'canceled', planId: 'free' }),
      );
    });
  });
});
