import { Job } from 'bullmq';
import { AggregatorWebhookProcessor } from './aggregator-webhook.processor';
import { OrderStatusTransitionService } from '../core/services/order-status-transition.service';
import { AggregatorWebhookJob } from './aggregator-webhook.types';

/**
 * Focused coverage of the order-created path's auto-accept gate (the per-store toggle) and
 * the store lifecycle handlers. The DB/order pipeline is mocked (plain-object mocks so the
 * unbound-method lint rule stays quiet) — reverse-mapping and normalization have their own
 * specs.
 */
describe('AggregatorWebhookProcessor', () => {
  let processor: AggregatorWebhookProcessor;
  let db: { update: jest.Mock; select: jest.Mock };
  let registry: {
    getOrderExtractor: jest.Mock;
    getOrderProvider: jest.Mock;
  };
  let normalization: { importOrder: jest.Mock };
  let statusTransition: OrderStatusTransitionService;
  let ordersService: { updateStatusForAggregator: jest.Mock };
  let repo: {
    findIntegrationAccountById: jest.Mock;
    setIntegrationAccountStatus: jest.Mock;
  };
  let orderProvider: { getOrder: jest.Mock; acceptOrder: jest.Mock };

  const normalizedOrder = {
    externalOrderId: 'ord-1',
    externalStatus: 'CREATED',
    sourceChannel: 'ubereats',
    totalAmount: 1299,
    items: [],
    rawPayload: {},
  };

  function makeJob(
    overrides: Partial<AggregatorWebhookJob> = {},
  ): Job<AggregatorWebhookJob> {
    return {
      data: {
        provider: 'ubereats',
        providerId: 'prov-uber',
        integrationAccountId: 'acct-1',
        organizationId: 'org-1',
        locationId: 'loc-1',
        eventType: 'order.created',
        externalOrderId: 'ord-1',
        resourceHref: 'https://api.uber.com/v2/eats/order/ord-1',
        webhookEventId: 'ubereats:evt-1',
        rawPayload: { meta: {} },
        ...overrides,
      },
    } as unknown as Job<AggregatorWebhookJob>;
  }

  beforeEach(() => {
    orderProvider = {
      getOrder: jest.fn().mockResolvedValue(normalizedOrder),
      acceptOrder: jest.fn().mockResolvedValue(undefined),
    };
    const updateChain: { set: jest.Mock; where: jest.Mock } = {
      set: jest.fn(() => updateChain),
      where: jest.fn(() => Promise.resolve()),
    };
    db = {
      update: jest.fn(() => updateChain),
      select: jest.fn(),
    };
    registry = {
      getOrderExtractor: jest
        .fn()
        .mockReturnValue({ orderFromWebhook: () => null }),
      getOrderProvider: jest.fn().mockReturnValue(orderProvider),
    };
    normalization = {
      importOrder: jest
        .fn()
        .mockResolvedValue({ imported: true, internalOrderId: 'order-1' }),
    };
    statusTransition = new OrderStatusTransitionService();
    ordersService = {
      updateStatusForAggregator: jest.fn().mockResolvedValue(undefined),
    };
    repo = {
      findIntegrationAccountById: jest.fn(),
      setIntegrationAccountStatus: jest.fn().mockResolvedValue(null),
    };

    processor = new AggregatorWebhookProcessor(
      db as never,
      registry as never,
      normalization as never,
      statusTransition,
      ordersService as never,
      repo as never,
    );
  });

  describe('order.created auto-accept gate', () => {
    it('auto-accepts on the provider when the store has auto-accept on', async () => {
      repo.findIntegrationAccountById.mockResolvedValue({
        autoAcceptOrders: true,
      });

      const result = (await processor.process(makeJob())) as {
        autoAccepted: boolean;
      };

      // Our order id rides along as Uber's external_reference_id.
      expect(orderProvider.acceptOrder).toHaveBeenCalledWith(
        'acct-1',
        'ord-1',
        {
          externalReferenceId: 'order-1',
        },
      );
      expect(result.autoAccepted).toBe(true);
    });

    it('leaves the order pending when auto-accept is disabled', async () => {
      repo.findIntegrationAccountById.mockResolvedValue({
        autoAcceptOrders: false,
      });

      const result = (await processor.process(makeJob())) as {
        autoAccepted: boolean;
      };

      expect(orderProvider.acceptOrder).not.toHaveBeenCalled();
      expect(result.autoAccepted).toBe(false);
    });

    it('fetches the order via resource_href for notification-only providers', async () => {
      repo.findIntegrationAccountById.mockResolvedValue({
        autoAcceptOrders: true,
      });

      await processor.process(makeJob());

      expect(orderProvider.getOrder).toHaveBeenCalledWith(
        'acct-1',
        'https://api.uber.com/v2/eats/order/ord-1',
      );
    });
  });

  describe('store lifecycle', () => {
    it('marks the account connected on store.provisioned', async () => {
      await processor.process(makeJob({ eventType: 'store.provisioned' }));
      expect(repo.setIntegrationAccountStatus).toHaveBeenCalledWith('acct-1', {
        status: 'connected',
      });
    });

    it('disables the account on store.deprovisioned', async () => {
      await processor.process(makeJob({ eventType: 'store.deprovisioned' }));
      expect(repo.setIntegrationAccountStatus).toHaveBeenCalledWith('acct-1', {
        status: 'disabled',
        isOnline: false,
      });
    });

    it('mirrors online status on store.status', async () => {
      await processor.process(
        makeJob({
          eventType: 'store.status',
          rawPayload: { meta: { status: 'ONLINE' } },
        }),
      );
      expect(repo.setIntegrationAccountStatus).toHaveBeenCalledWith('acct-1', {
        isOnline: true,
      });
    });
  });
});
