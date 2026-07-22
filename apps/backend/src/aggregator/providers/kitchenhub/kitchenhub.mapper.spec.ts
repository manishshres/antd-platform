import {
  mapEventType,
  mapOrder,
  mapOrderItem,
  normalizeMarketplace,
  parseWebhook,
  toCents,
} from './kitchenhub.mapper';

describe('kitchenhub.mapper', () => {
  describe('toCents', () => {
    it('converts decimal dollars (number and string) to integer cents', () => {
      expect(toCents(12.99)).toBe(1299);
      expect(toCents('12.99')).toBe(1299);
      expect(toCents('0.05')).toBe(5);
    });

    it('is defensive about missing / non-numeric values', () => {
      expect(toCents(undefined)).toBe(0);
      expect(toCents(null)).toBe(0);
      expect(toCents('')).toBe(0);
      expect(toCents('abc')).toBe(0);
    });
  });

  describe('mapOrderItem', () => {
    it('folds modifier adjustments into an inclusive unit price', () => {
      const item = mapOrderItem({
        external_id: 'ext-1',
        name: 'Burger',
        quantity: 2,
        price: '8.00',
        modifiers: [
          { id: 'm1', name: 'Extra cheese', price: '1.50' },
          { id: 'm2', name: 'Bacon', price: 2 },
        ],
      });

      expect(item.externalItemId).toBe('ext-1');
      expect(item.quantity).toBe(2);
      // 800 + 150 + 200 = 1150 (inclusive unit price)
      expect(item.price).toBe(1150);
      expect(item.modifiers).toHaveLength(2);
      expect(item.modifiers?.[0]).toEqual({
        externalModifierId: 'm1',
        name: 'Extra cheese',
        priceAdjustment: 150,
      });
    });

    it('falls back through id fields and defaults quantity', () => {
      const item = mapOrderItem({ id: 'only-id', name: 'Fries' });
      expect(item.externalItemId).toBe('only-id');
      expect(item.quantity).toBe(1);
      expect(item.price).toBe(0);
      expect(item.modifiers).toBeUndefined();
    });
  });

  describe('mapOrder', () => {
    it('maps totals, customer, and line items', () => {
      const normalized = mapOrder({
        id: 'kh-123',
        status: 'new',
        created_at: '2026-07-17T10:00:00Z',
        type: 'delivery',
        customer: { first_name: 'Ada', last_name: 'Lovelace', phone: '555' },
        items: [{ external_id: 'i1', name: 'Pie', quantity: 1, price: '5.00' }],
        subtotal: '5.00',
        tax: '0.50',
        tip: '1.00',
        total: '6.50',
        notes: 'no nuts',
      });

      expect(normalized.externalOrderId).toBe('kh-123');
      expect(normalized.externalStatus).toBe('new');
      expect(normalized.totalAmount).toBe(650);
      expect(normalized.subtotal).toBe(500);
      expect(normalized.taxAmount).toBe(50);
      expect(normalized.tipAmount).toBe(100);
      expect(normalized.orderType).toBe('delivery');
      expect(normalized.specialInstructions).toBe('no nuts');
      expect(normalized.customerInfo?.name).toBe('Ada Lovelace');
      expect(normalized.customerInfo?.phone).toBe('555');
      expect(normalized.items).toHaveLength(1);
    });

    it('reconstructs total from parts when absent', () => {
      const normalized = mapOrder({
        id: 'kh-1',
        subtotal: '10.00',
        tax: '1.00',
        items: [],
      });
      expect(normalized.totalAmount).toBe(1100);
    });
  });

  describe('normalizeMarketplace', () => {
    it('canonicalizes the underlying marketplace label', () => {
      expect(normalizeMarketplace('DoorDash')).toBe('doordash');
      expect(normalizeMarketplace('Uber Eats')).toBe('ubereats');
      expect(normalizeMarketplace('grub_hub')).toBe('grubhub');
    });

    it('returns undefined for unknown/empty so it falls back to the transport', () => {
      expect(normalizeMarketplace('something')).toBeUndefined();
      expect(normalizeMarketplace(undefined)).toBeUndefined();
    });
  });

  describe('sourceChannel attribution', () => {
    it('tags the underlying marketplace on the normalized order', () => {
      const order = mapOrder({ id: 'k1', provider: 'DoorDash', items: [] });
      expect(order.sourceChannel).toBe('doordash');
    });
  });

  describe('mapEventType', () => {
    it('maps KitchenHub webhook types to normalized event types', () => {
      expect(mapEventType('Order')).toBe('order.created');
      expect(mapEventType('OrderStatus')).toBe('order.updated');
      expect(mapEventType('order.cancelled')).toBe('order.canceled');
      expect(mapEventType('Delivery')).toBe('delivery.status');
      expect(mapEventType('Menu')).toBe('menu.sync.status');
      expect(mapEventType('something-else')).toBe('unknown');
    });
  });

  describe('parseWebhook', () => {
    it('extracts the envelope and falls back to an order-scoped event id', () => {
      const event = parseWebhook({
        type: 'Order',
        order: { id: 'kh-9', status: 'new' },
      });
      expect(event.eventType).toBe('order.created');
      expect(event.externalOrderId).toBe('kh-9');
      // No explicit event_id → derives one from the order so redeliveries dedupe.
      expect(event.externalEventId).toBe('order:kh-9');
    });

    it('prefers an explicit event id', () => {
      const event = parseWebhook({
        event_id: 'evt-1',
        type: 'OrderStatus',
        data: { id: 'kh-9', status: 'accepted' },
      });
      expect(event.externalEventId).toBe('evt-1');
      expect(event.eventType).toBe('order.updated');
    });
  });
});
