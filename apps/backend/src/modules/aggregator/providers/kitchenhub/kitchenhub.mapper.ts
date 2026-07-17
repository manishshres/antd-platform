import {
  NormalizedOrder,
  NormalizedOrderItem,
} from '../../core/models/aggregator.models';
import { NormalizedWebhookEvent } from '../../core/interfaces/provider-adapter.interface';
import { KitchenHubOrder, KitchenHubWebhookBody } from './kitchenhub.types';

/**
 * Pure KitchenHub ↔ normalized-model translation. No network, no DB — unit-testable
 * in isolation. KitchenHub returns decimal (dollar) amounts; we store cents, so all
 * money flows through toCents(). If real payloads turn out to be in cents already,
 * this is the single place to change.
 */

export function toCents(value: number | string | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Canonicalize KitchenHub's marketplace label to a Coneeko order source
 * (doordash / ubereats / grubhub). Returns undefined for anything unrecognized so
 * normalization falls back to the transport provider name ('kitchenhub').
 */
export function normalizeMarketplace(raw?: string): string | undefined {
  if (!raw) return undefined;
  const key = raw.toLowerCase().replace(/[\s_-]/g, '');
  if (key.includes('doordash')) return 'doordash';
  if (key.includes('ubereats') || key === 'uber') return 'ubereats';
  if (key.includes('grubhub')) return 'grubhub';
  return undefined;
}

function customerName(order: KitchenHubOrder): string | undefined {
  const c = order.customer;
  if (!c) return undefined;
  if (c.name) return c.name;
  const joined = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  return joined || undefined;
}

/** The order lives either at the top level, under `order`, or under `data`. */
export function extractOrder(body: KitchenHubWebhookBody): KitchenHubOrder {
  return body.order ?? body.data ?? body;
}

/** KitchenHub's id for the order (falls back through the common id fields). */
export function orderExternalId(order: KitchenHubOrder): string {
  return order.id ?? order.external_id ?? order.order_number ?? '';
}

export function mapOrderItem(item: {
  id?: string;
  external_id?: string;
  name?: string;
  quantity?: number;
  price?: number | string;
  modifiers?: { id?: string; name?: string; price?: number | string }[];
  notes?: string;
}): NormalizedOrderItem {
  const modifiers = (item.modifiers ?? []).map((m) => ({
    externalModifierId: m.id ?? '',
    name: m.name ?? '',
    priceAdjustment: toCents(m.price),
  }));
  // Provider unit price + modifier adjustments = the inclusive unit price we persist.
  const inclusiveUnitPrice =
    toCents(item.price) +
    modifiers.reduce((sum, m) => sum + m.priceAdjustment, 0);

  return {
    externalItemId: item.external_id ?? item.id ?? '',
    name: item.name ?? 'Item',
    quantity: item.quantity ?? 1,
    price: inclusiveUnitPrice,
    modifiers: modifiers.length ? modifiers : undefined,
    specialInstructions: item.notes,
  };
}

export function mapOrder(order: KitchenHubOrder): NormalizedOrder {
  const items = (order.items ?? []).map(mapOrderItem);
  const subtotal =
    order.subtotal !== undefined ? toCents(order.subtotal) : undefined;
  const taxAmount = order.tax !== undefined ? toCents(order.tax) : undefined;
  const tipAmount = order.tip !== undefined ? toCents(order.tip) : undefined;
  // Prefer the provider total; else reconstruct from parts.
  const total =
    order.total !== undefined
      ? toCents(order.total)
      : (subtotal ?? 0) + (taxAmount ?? 0) + (tipAmount ?? 0);

  return {
    externalOrderId: orderExternalId(order),
    externalStatus: order.status ?? 'new',
    externalCreatedAt: order.created_at,
    // Attribute to the underlying marketplace (KitchenHub relays DoorDash/Grubhub/etc).
    sourceChannel: normalizeMarketplace(order.provider ?? order.source),
    totalAmount: total,
    subtotal,
    taxAmount,
    tipAmount,
    orderType: order.type,
    specialInstructions: order.notes,
    items,
    customerInfo: {
      name: customerName(order),
      phone: order.customer?.phone,
      email: order.customer?.email,
    },
    rawPayload: order,
  };
}

/** Map a KitchenHub webhook `type` to our normalized event type. */
export function mapEventType(
  type: string | undefined,
): NormalizedWebhookEvent['eventType'] {
  switch ((type ?? '').toLowerCase()) {
    case 'order':
    case 'order.created':
    case 'neworder':
      return 'order.created';
    case 'order.updated':
    case 'orderstatus':
      return 'order.updated';
    case 'order.canceled':
    case 'order.cancelled':
      return 'order.canceled';
    case 'delivery':
      return 'delivery.status';
    case 'menu':
      return 'menu.sync.status';
    default:
      return 'unknown';
  }
}

export function parseWebhook(
  body: KitchenHubWebhookBody,
): NormalizedWebhookEvent {
  const order = extractOrder(body);
  const externalEventId =
    body.event_id ??
    body.id ??
    body.data?.id ??
    // Fall back to a per-order id so redeliveries of the same order still dedupe.
    (orderExternalId(order) ? `order:${orderExternalId(order)}` : '');

  return {
    externalEventId,
    eventType: mapEventType(body.type ?? body.event),
    externalOrderId: orderExternalId(order) || undefined,
    rawPayload: body,
  };
}
