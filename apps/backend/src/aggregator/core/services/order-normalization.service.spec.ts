/* eslint-disable @typescript-eslint/unbound-method -- jest mock fns are asserted directly, not called */
import { OrderNormalizationService } from './order-normalization.service';
import { OrderProcessingError } from '../errors/aggregator.errors';
import { NormalizedOrder } from '../models/aggregator.models';
import { AggregatorRepository } from '../../database/aggregator.repository';
import { OrdersService } from '../../../orders/orders.service';

function normalizedOrder(
  overrides?: Partial<NormalizedOrder>,
): NormalizedOrder {
  return {
    externalOrderId: 'EXT-1',
    externalStatus: 'new',
    totalAmount: 1150,
    subtotal: 1000,
    taxAmount: 150,
    items: [
      { externalItemId: 'kh-item-1', name: 'Burger', quantity: 1, price: 1150 },
    ],
    customerInfo: { name: 'Ada', phone: '555' },
    rawPayload: { id: 'EXT-1' },
    ...overrides,
  };
}

const ctx = {
  providerId: 'prov-1',
  providerName: 'kitchenhub',
  integrationAccountId: 'acct-1',
  organizationId: 'org-1',
  locationId: 'loc-1',
};

describe('OrderNormalizationService.importOrder', () => {
  let repo: jest.Mocked<AggregatorRepository>;
  let orders: jest.Mocked<OrdersService>;
  let service: OrderNormalizationService;

  beforeEach(() => {
    repo = {
      upsertExternalOrder: jest.fn(),
      resolveMenuItemIds: jest.fn(),
      findOrderSourceId: jest.fn(),
      markExternalOrderImported: jest.fn(),
      markExternalOrderFailed: jest.fn(),
    } as unknown as jest.Mocked<AggregatorRepository>;
    orders = {
      createMarketplaceOrder: jest.fn(),
    } as unknown as jest.Mocked<OrdersService>;
    service = new OrderNormalizationService(repo, orders);
  });

  it('persists external order, creates native order, and links them', async () => {
    repo.upsertExternalOrder.mockResolvedValue({
      row: { id: 'ext-row-1', internalOrderId: null } as never,
      created: true,
    });
    repo.resolveMenuItemIds.mockResolvedValue(
      new Map([['kh-item-1', 'menu-item-1']]),
    );
    repo.findOrderSourceId.mockResolvedValue('src-1');
    orders.createMarketplaceOrder.mockResolvedValue({ id: 'order-1' } as never);

    const result = await service.importOrder(normalizedOrder(), ctx);

    expect(result).toEqual({
      externalOrderRowId: 'ext-row-1',
      internalOrderId: 'order-1',
      imported: true,
      order: { id: 'order-1' },
    });
    const arg = orders.createMarketplaceOrder.mock.calls[0][0];
    expect(arg.clientOrderId).toBe('kitchenhub:EXT-1');
    expect(arg.source).toBe('kitchenhub');
    expect(arg.sourceId).toBe('src-1');
    expect(arg.items[0].menuItemId).toBe('menu-item-1');
    expect(repo.markExternalOrderImported).toHaveBeenCalledWith(
      'ext-row-1',
      'order-1',
    );
  });

  it('attributes the order to the underlying marketplace (sourceChannel)', async () => {
    repo.upsertExternalOrder.mockResolvedValue({
      row: { id: 'ext-row-1', internalOrderId: null } as never,
      created: true,
    });
    repo.resolveMenuItemIds.mockResolvedValue(
      new Map([['kh-item-1', 'menu-item-1']]),
    );
    repo.findOrderSourceId.mockResolvedValue('src-doordash');
    orders.createMarketplaceOrder.mockResolvedValue({ id: 'order-2' } as never);

    // A DoorDash order relayed via KitchenHub reports as 'doordash'.
    await service.importOrder(normalizedOrder({ sourceChannel: 'doordash' }), {
      ...ctx,
      providerName: 'kitchenhub',
    });

    expect(repo.findOrderSourceId).toHaveBeenCalledWith('doordash');
    expect(orders.createMarketplaceOrder.mock.calls[0][0].source).toBe(
      'doordash',
    );
  });

  it('is a no-op when the external order is already imported', async () => {
    repo.upsertExternalOrder.mockResolvedValue({
      row: { id: 'ext-row-1', internalOrderId: 'order-existing' } as never,
      created: false,
    });

    const result = await service.importOrder(normalizedOrder(), ctx);

    expect(result.imported).toBe(false);
    expect(result.internalOrderId).toBe('order-existing');
    expect(orders.createMarketplaceOrder).not.toHaveBeenCalled();
  });

  it('fails the import (replayably) when a line item is unmapped', async () => {
    repo.upsertExternalOrder.mockResolvedValue({
      row: { id: 'ext-row-1', internalOrderId: null } as never,
      created: true,
    });
    repo.resolveMenuItemIds.mockResolvedValue(new Map()); // nothing mapped

    await expect(service.importOrder(normalizedOrder(), ctx)).rejects.toThrow(
      OrderProcessingError,
    );
    expect(orders.createMarketplaceOrder).not.toHaveBeenCalled();
    expect(repo.markExternalOrderFailed).toHaveBeenCalledWith(
      'ext-row-1',
      expect.stringContaining('Unmapped'),
    );
  });
});
