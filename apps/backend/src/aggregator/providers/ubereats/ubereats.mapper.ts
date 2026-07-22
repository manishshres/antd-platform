import {
  NormalizedOrder,
  NormalizedOrderItem,
} from '../../core/models/aggregator.models';
import { NormalizedWebhookEvent } from '../../core/interfaces/provider-adapter.interface';
import {
  UberCartItem,
  UberEatsWebhookBody,
  UberMoney,
  UberOrder,
} from './ubereats.types';

/**
 * Pure Uber Eats ↔ normalized-model translation. No network, no DB. Uber money is
 * already in integer cents, so moneyToCents does not scale (contrast KitchenHub's
 * decimal dollars). Exact order field paths are best-effort until confirmed against a
 * real test order; centralizing them here keeps that a one-file change.
 */

export function moneyToCents(m: UberMoney | undefined): number {
  const amount = m?.amount;
  return typeof amount === 'number' && Number.isFinite(amount)
    ? Math.round(amount)
    : 0;
}

function itemQuantity(item: UberCartItem): number {
  if (typeof item.quantity === 'number') return item.quantity;
  return item.quantity?.amount ?? 1;
}

export function mapCartItem(item: UberCartItem): NormalizedOrderItem {
  const modifiers = (item.selected_modifier_groups ?? []).flatMap((g) =>
    (g.selected_items ?? []).map((sel) => ({
      externalModifierId: sel.id ?? '',
      name: sel.title ?? '',
      priceAdjustment: moneyToCents(
        sel.price?.total_price ?? sel.price?.unit_price,
      ),
    })),
  );
  // Prefer Uber's line total; else unit price + modifier adjustments.
  const inclusiveUnitPrice = item.price?.total_price
    ? moneyToCents(item.price.total_price)
    : moneyToCents(item.price?.unit_price) +
      modifiers.reduce((sum, m) => sum + m.priceAdjustment, 0);

  return {
    externalItemId: item.id ?? item.instance_id ?? '',
    name: item.title ?? 'Item',
    quantity: itemQuantity(item),
    price: inclusiveUnitPrice,
    modifiers: modifiers.length ? modifiers : undefined,
    specialInstructions: item.special_instructions,
  };
}

export function mapOrder(order: UberOrder): NormalizedOrder {
  const charges = order.payment?.charges;
  const eater = order.eater ?? order.eaters?.[0];
  const name = eater
    ? [eater.first_name, eater.last_name].filter(Boolean).join(' ').trim() ||
      undefined
    : undefined;

  return {
    externalOrderId: order.id ?? order.display_id ?? '',
    externalStatus: order.current_state ?? 'CREATED',
    externalCreatedAt: order.placed_at,
    sourceChannel: 'ubereats',
    totalAmount: moneyToCents(charges?.total),
    subtotal: charges?.sub_total ? moneyToCents(charges.sub_total) : undefined,
    taxAmount: charges?.tax ? moneyToCents(charges.tax) : undefined,
    tipAmount: charges?.tip ? moneyToCents(charges.tip) : undefined,
    orderType: order.type,
    specialInstructions: order.special_instructions ?? order.store_instructions,
    items: (order.cart?.items ?? []).map(mapCartItem),
    customerInfo: { name, phone: eater?.phone },
    rawPayload: order,
  };
}

/** Map an Uber webhook event_type to our normalized event type. */
export function mapEventType(
  eventType: string | undefined,
): NormalizedWebhookEvent['eventType'] {
  switch ((eventType ?? '').toLowerCase()) {
    case 'orders.notification':
    case 'orders.scheduled.notification':
      return 'order.created';
    case 'orders.cancel':
      return 'order.canceled';
    case 'orders.release':
      return 'order.updated';
    default:
      return 'unknown';
  }
}

/** Extract the order id from meta.resource_id or the trailing segment of resource_href. */
export function webhookOrderId(body: UberEatsWebhookBody): string | undefined {
  if (body.meta?.resource_id) return body.meta.resource_id;
  if (body.resource_href) {
    const parts = body.resource_href.split('/').filter(Boolean);
    return parts[parts.length - 1];
  }
  return undefined;
}

export function parseWebhook(
  body: UberEatsWebhookBody,
): NormalizedWebhookEvent {
  const orderId = webhookOrderId(body);
  return {
    externalEventId: body.event_id ?? (orderId ? `order:${orderId}` : ''),
    eventType: mapEventType(body.event_type),
    externalOrderId: orderId,
    rawPayload: body,
  };
}
