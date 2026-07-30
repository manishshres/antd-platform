import {
  mapCartItem,
  mapEventType,
  mapOrder,
  moneyToCents,
  parseWebhook,
  toAcceptBody,
  toCancelBody,
  toDenyBody,
  toPosDataBody,
  toUberMenu,
  webhookOrderId,
  webhookStoreId,
} from './ubereats.mapper';
import { NormalizedMenu } from '../../core/models/aggregator.models';

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

    it('reads the order note off the cart, where Uber actually puts it', () => {
      const order = mapOrder({
        id: 'uber-order-2',
        cart: { items: [], special_instructions: 'no cutlery' },
      });
      expect(order.specialInstructions).toBe('no cutlery');
    });

    it('maps the v1 shape (carts[] / customers[]) as well as v2', () => {
      const order = mapOrder({
        id: 'uber-order-3',
        customers: [{ first_name: 'Ada', phone: '555' }],
        carts: [
          {
            items: [
              {
                id: 'i1',
                title: 'Soup',
                quantity: 2,
                price: { total_price: { amount: 500 } },
              },
            ],
            special_instructions: 'extra napkins',
          },
        ],
      });

      expect(order.customerInfo?.name).toBe('Ada');
      expect(order.items).toHaveLength(1);
      expect(order.specialInstructions).toBe('extra napkins');
    });
  });

  describe('accept / deny / cancel bodies', () => {
    it('always sends the required accept reason plus our order id', () => {
      const body = toAcceptBody({ externalReferenceId: 'order-1' });
      expect(body.reason).toBeTruthy();
      expect(body.external_reference_id).toBe('order-1');
      expect(body.fields_relayed?.order_special_instructions).toBe(true);
    });

    it('wraps a deny reason in Uber’s code/explanation object', () => {
      expect(toDenyBody('STORE_CLOSED')).toEqual({
        reason: { code: 'STORE_CLOSED', explanation: 'STORE_CLOSED' },
      });
      // Free text isn't a code — it survives as the explanation under OTHER.
      expect(toDenyBody('fryer is down')).toEqual({
        reason: { code: 'OTHER', explanation: 'fryer is down' },
      });
      expect(toDenyBody()).toEqual({
        reason: { code: 'OTHER', explanation: 'Denied by the restaurant' },
      });
    });

    it('uses the cancel enum (a different set from deny) and puts free text in details', () => {
      expect(toCancelBody('out of items')).toEqual({ reason: 'OUT_OF_ITEMS' });
      expect(toCancelBody('customer walked in')).toEqual({
        reason: 'OTHER',
        details: 'customer walked in',
      });
      // A deny-only code must not leak into a cancel call.
      expect(toCancelBody('STORE_CLOSED')).toEqual({
        reason: 'OTHER',
        details: 'STORE_CLOSED',
      });
    });
  });

  describe('toPosDataBody', () => {
    it('claims order manager, never manual acceptance, and pins the webhook version', () => {
      const body = toPosDataBody({ integratorStoreId: 'acct-1' });
      expect(body.is_order_manager).toBe(true);
      // True would make the merchant tap accept in Uber's app before we see a webhook.
      expect(body.require_manual_acceptance).toBe(false);
      expect(body.integrator_store_id).toBe('acct-1');
      expect(body.webhooks_config?.webhooks_version).toBe('1.0.0');
      expect(
        body.allowed_customer_requests?.allow_special_instruction_requests,
      ).toBe(true);
    });
  });

  describe('mapEventType', () => {
    it('maps order event types', () => {
      expect(mapEventType('orders.notification')).toBe('order.created');
      expect(mapEventType('orders.scheduled.notification')).toBe(
        'order.created',
      );
      expect(mapEventType('orders.cancel')).toBe('order.canceled');
      // v1.0.0 stores cancel via orders.failure.
      expect(mapEventType('orders.failure')).toBe('order.canceled');
      expect(mapEventType('orders.release')).toBe('order.updated');
      expect(mapEventType('order.fulfillment_issues.resolved')).toBe(
        'order.updated',
      );
    });

    it('maps store lifecycle event types', () => {
      expect(mapEventType('store.provisioned')).toBe('store.provisioned');
      expect(mapEventType('store.deprovisioned')).toBe('store.deprovisioned');
      expect(mapEventType('store.status.changed')).toBe('store.status');
    });

    it('falls back to unknown for unrecognized types', () => {
      expect(mapEventType('something.else')).toBe('unknown');
      expect(mapEventType(undefined)).toBe('unknown');
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

  describe('webhookStoreId', () => {
    it('resolves the tenant store from meta.user_id, then store_id', () => {
      expect(webhookStoreId({ meta: { user_id: 'store-a' } })).toBe('store-a');
      expect(webhookStoreId({ meta: { store_id: 'store-b' } })).toBe('store-b');
      // user_id wins when both are present (docs: user_id corresponds to store_id).
      expect(
        webhookStoreId({ meta: { user_id: 'store-a', store_id: 'store-b' } }),
      ).toBe('store-a');
      expect(webhookStoreId({})).toBeUndefined();
    });
  });

  describe('toUberMenu', () => {
    const menu: NormalizedMenu = {
      categories: [
        {
          internalCategoryId: 'cat-1',
          name: 'Mains',
          sortOrder: 0,
          items: [
            {
              internalItemId: 'item-1',
              name: 'Burger',
              description: 'Juicy',
              price: 1299,
              sortOrder: 0,
              modifierGroups: [
                {
                  internalModifierGroupId: 'mg-1',
                  name: 'Choose a side',
                  isRequired: true,
                  multiSelect: false,
                  modifiers: [
                    {
                      internalModifierId: 'opt-1',
                      name: 'Fries',
                      priceAdjustment: 200,
                    },
                    {
                      internalModifierId: 'opt-2',
                      name: 'Salad',
                      priceAdjustment: 0,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    it('emits Uber cents pricing (no dollar scaling)', () => {
      const out = toUberMenu(menu);
      const burger = out.items.find((i) => i.id === 'item-1');
      expect(burger?.price_info.price).toBe(1299);
      const fries = out.items.find((i) => i.id === 'opt-1');
      expect(fries?.price_info.price).toBe(200); // modifier option carries its own price
    });

    it('publishes Coneeko ids so inbound orders reverse-map 1:1', () => {
      const out = toUberMenu(menu);
      expect(out.categories[0].id).toBe('cat-1');
      expect(out.categories[0].entities).toEqual([
        { id: 'item-1', type: 'ITEM' },
      ]);
      expect(
        out.items.find((i) => i.id === 'item-1')?.modifier_group_ids,
      ).toEqual({
        ids: ['mg-1'],
      });
      expect(out.menus[0].category_ids).toEqual(['cat-1']);
    });

    it('translates required single-select into min 1 / max 1 quantity', () => {
      const group = toUberMenu(menu).modifier_groups.find(
        (g) => g.id === 'mg-1',
      );
      expect(group?.quantity_info.quantity).toEqual({
        min_permitted: 1,
        max_permitted: 1,
      });
      expect(group?.modifier_options).toEqual([
        { id: 'opt-1', type: 'ITEM' },
        { id: 'opt-2', type: 'ITEM' },
      ]);
    });

    it('advertises an all-day service_availability so the store shows open', () => {
      const out = toUberMenu(menu);
      expect(out.menus[0].service_availability).toHaveLength(7);
      expect(out.menus[0].service_availability[0].time_periods[0]).toEqual({
        start_time: '00:00',
        end_time: '23:59',
      });
    });
  });
});
