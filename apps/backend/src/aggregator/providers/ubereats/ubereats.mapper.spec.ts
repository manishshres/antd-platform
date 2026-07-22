import {
  mapCartItem,
  mapEventType,
  mapOrder,
  moneyToCents,
  parseWebhook,
  webhookOrderId,
} from './ubereats.mapper';

describe('ubereats.mapper', () => {
  describe('moneyToCents', () => {
    it('treats Uber amounts as integer cents (no scaling)', () => {
      expect(moneyToCents({ amount: 1099, currency_code: 'USD' })).toBe(1099);
      expect(moneyToCents(undefined)).toBe(0);
      expect(moneyToCents({})).toBe(0);
    });
  });

  describe('mapCartItem', () => {
    it('uses the line total and flattens selected modifiers', () => {
      const item = mapCartItem({
        id: 'i-1',
        title: 'Burrito',
        quantity: { amount: 2 },
        price: { total_price: { amount: 1450 } },
        selected_modifier_groups: [
          {
            selected_items: [
              {
                id: 'm-1',
                title: 'Guac',
                price: { total_price: { amount: 200 } },
              },
            ],
          },
        ],
      });
      expect(item.externalItemId).toBe('i-1');
      expect(item.quantity).toBe(2);
      expect(item.price).toBe(1450);
      expect(item.modifiers).toEqual([
        { externalModifierId: 'm-1', name: 'Guac', priceAdjustment: 200 },
      ]);
    });

    it('falls back to unit price + modifiers when no line total', () => {
      const item = mapCartItem({
        id: 'i-2',
        title: 'Taco',
        quantity: 1,
        price: { unit_price: { amount: 300 } },
        selected_modifier_groups: [
          {
            selected_items: [
              {
                id: 'm',
                title: 'Cheese',
                price: { unit_price: { amount: 50 } },
              },
            ],
          },
        ],
      });
      expect(item.price).toBe(350);
    });
  });

  describe('mapOrder', () => {
    it('maps charges, eater, type, and tags source as ubereats', () => {
      const order = mapOrder({
        id: 'uber-order-1',
        current_state: 'CREATED',
        placed_at: '2026-07-17T10:00:00Z',
        type: 'DELIVERY_BY_UBER',
        eater: { first_name: 'Grace', last_name: 'Hopper', phone: '555' },
        cart: {
          items: [
            {
              id: 'i1',
              title: 'Bowl',
              quantity: 1,
              price: { total_price: { amount: 999 } },
            },
          ],
        },
        payment: {
          charges: {
            total: { amount: 1163 },
            sub_total: { amount: 999 },
            tax: { amount: 84 },
            tip: { amount: 80 },
          },
        },
        special_instructions: 'ring bell',
      });

      expect(order.externalOrderId).toBe('uber-order-1');
      expect(order.sourceChannel).toBe('ubereats');
      expect(order.totalAmount).toBe(1163);
      expect(order.subtotal).toBe(999);
      expect(order.taxAmount).toBe(84);
      expect(order.tipAmount).toBe(80);
      expect(order.orderType).toBe('DELIVERY_BY_UBER');
      expect(order.customerInfo?.name).toBe('Grace Hopper');
      expect(order.items).toHaveLength(1);
    });
  });

  describe('mapEventType', () => {
    it('maps Uber event types', () => {
      expect(mapEventType('orders.notification')).toBe('order.created');
      expect(mapEventType('orders.cancel')).toBe('order.canceled');
      expect(mapEventType('store.status.changed')).toBe('unknown');
    });
  });

  describe('webhookOrderId / parseWebhook', () => {
    it('reads the order id from meta.resource_id', () => {
      const body = {
        event_id: 'evt-1',
        event_type: 'orders.notification',
        meta: { resource_id: 'ord-9' },
      };
      expect(webhookOrderId(body)).toBe('ord-9');
      const event = parseWebhook(body);
      expect(event.eventType).toBe('order.created');
      expect(event.externalOrderId).toBe('ord-9');
      expect(event.externalEventId).toBe('evt-1');
    });

    it('falls back to the trailing segment of resource_href', () => {
      expect(
        webhookOrderId({
          resource_href: 'https://api.uber.com/v2/eats/order/ord-77',
        }),
      ).toBe('ord-77');
    });
  });
});
