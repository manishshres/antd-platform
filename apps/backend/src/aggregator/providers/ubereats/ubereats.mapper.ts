import {
  NormalizedMenu,
  NormalizedOrder,
  NormalizedOrderItem,
} from '../../core/models/aggregator.models';
import { NormalizedWebhookEvent } from '../../core/interfaces/provider-adapter.interface';
import {
  UberAcceptOrderBody,
  UberCancelOrderBody,
  UberCancelReasonCode,
  UberCartItem,
  UberCategoryEntry,
  UberDenyOrderBody,
  UberDenyReasonCode,
  UberEatsWebhookBody,
  UberFieldsRelayed,
  UberItemEntry,
  UberLocalizedText,
  UberMenuPayload,
  UberModifierGroupEntry,
  UberMoney,
  UberOrder,
  UberPosDataBody,
  UberServiceAvailability,
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
  // v2 sends `eater`/`cart`; the v1 (`webhooks_version: "1.0.0"`) shape sends
  // `customers`/`carts`. Accept both so a version flip doesn't silently drop lines.
  const eater = order.eater ?? order.eaters?.[0] ?? order.customers?.[0];
  const cart = order.cart ?? order.carts?.[0];
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
    // Uber puts the customer's order-level note on the *cart*; the top-level fields are
    // legacy fallbacks. Reading only those dropped every order note onto the floor.
    specialInstructions:
      cart?.special_instructions ??
      order.special_instructions ??
      order.store_instructions,
    items: (cart?.items ?? []).map(mapCartItem),
    customerInfo: { name, phone: eater?.phone },
    rawPayload: order,
  };
}

// ── Accept / deny / cancel bodies ────────────────────────────────────────────
// Uber validates these strictly: `reason` is required on accept, an object with an
// enum `code` on deny, and a bare enum on cancel — and the deny/cancel enums differ.
// Our internal APIs take free text, so translate here rather than at each call site.

const DENY_REASON_CODES: UberDenyReasonCode[] = [
  'STORE_CLOSED',
  'POS_NOT_READY',
  'POS_OFFLINE',
  'ITEM_AVAILABILITY',
  'MISSING_ITEM',
  'MISSING_INFO',
  'PRICING',
  'CAPACITY',
  'ADDRESS',
  'SPECIAL_INSTRUCTIONS',
  'OTHER',
];

const CANCEL_REASON_CODES: UberCancelReasonCode[] = [
  'OUT_OF_ITEMS',
  'KITCHEN_CLOSED',
  'CUSTOMER_CALLED_TO_CANCEL',
  'RESTAURANT_TOO_BUSY',
  'CANNOT_COMPLETE_CUSTOMER_NOTE',
  'OTHER',
];

/** What our tickets actually carry through to the kitchen. */
export const CONEEKO_FIELDS_RELAYED: UberFieldsRelayed = {
  order_special_instructions: true,
  item_special_instructions: true,
  item_special_requests: false,
  promotions: false,
};

export function toAcceptBody(options?: {
  externalReferenceId?: string;
  reason?: string;
}): UberAcceptOrderBody {
  return {
    reason: options?.reason ?? 'Accepted by Coneeko POS',
    external_reference_id: options?.externalReferenceId,
    fields_relayed: CONEEKO_FIELDS_RELAYED,
  };
}

/**
 * A caller-supplied reason is used as the enum when it already *is* one of Uber's codes
 * (case-insensitive); anything else becomes OTHER with the text kept as the explanation.
 */
export function toDenyBody(reason?: string): UberDenyOrderBody {
  const code = matchCode(reason, DENY_REASON_CODES);
  return {
    reason: {
      code: code ?? 'OTHER',
      explanation: reason?.trim() || 'Denied by the restaurant',
    },
  };
}

export function toCancelBody(reason?: string): UberCancelOrderBody {
  const code = matchCode(reason, CANCEL_REASON_CODES);
  if (code) return { reason: code };
  // Uber expects the free text in `details` when the code is OTHER.
  return {
    reason: 'OTHER',
    details: reason?.trim() || 'Cancelled by the restaurant',
  };
}

function matchCode<T extends string>(
  reason: string | undefined,
  codes: T[],
): T | undefined {
  if (!reason) return undefined;
  const normalized = reason
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return codes.find((code) => code === normalized);
}

// ── Store integration config (pos_data) ──────────────────────────────────────

/**
 * Pins `resource_href` generation and the event set to the v1 contract this adapter
 * parses (notably `orders.failure` instead of `orders.cancel`).
 */
export const UBER_WEBHOOKS_VERSION = '1.0.0';

/**
 * The config we assert for a Coneeko-managed Uber store. `integration_enabled` is the
 * master switch for order-fulfillment webhooks (`orders.notification` and friends), and
 * `require_manual_acceptance` must stay false — true means the merchant has to tap accept
 * in Uber's own Order Manager app before we ever see the webhook, which defeats the POS
 * integration. Manual acceptance in *our* flow is the per-account `autoAcceptOrders`
 * toggle instead. Webhooks are pinned to "1.0.0" so `resource_href` and the event set
 * (including `orders.failure`) match what this adapter parses.
 */
export function toPosDataBody(options: {
  integratorStoreId?: string;
  merchantStoreId?: string;
  storeConfigurationData?: string;
}): UberPosDataBody {
  return {
    allowed_customer_requests: {
      allow_single_use_items_requests: true,
      allow_special_instruction_requests: true,
    },
    integrator_store_id: options.integratorStoreId,
    merchant_store_id: options.merchantStoreId,
    is_order_manager: true,
    require_manual_acceptance: false,
    store_configuration_data: options.storeConfigurationData,
    webhooks_config: {
      order_release_webhooks: { is_enabled: true },
      schedule_order_webhooks: { is_enabled: true },
      // Courier-tracking events (delivery.state_changed) have no handler yet, so we
      // don't ask for them — flip this on together with a 'delivery.status' handler.
      delivery_status_webhooks: { is_enabled: false },
      webhooks_version: UBER_WEBHOOKS_VERSION,
    },
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
    // orders.failure is the v1.0.0 stores' cancellation event.
    case 'orders.cancel':
    case 'orders.failure':
      return 'order.canceled';
    // fulfillment_issues.resolved means the customer accepted a change — refetch & continue.
    case 'orders.release':
    case 'order.fulfillment_issues.resolved':
      return 'order.updated';
    case 'store.provisioned':
      return 'store.provisioned';
    case 'store.deprovisioned':
      return 'store.deprovisioned';
    case 'store.status.changed':
      return 'store.status';
    default:
      return 'unknown';
  }
}

/**
 * The store id an Uber webhook targets. Uber sends every store's events to one Primary
 * Webhook URL, so this (meta.user_id, which "corresponds to store_id" per the docs, with
 * meta.store_id as a fallback) is how the receiver resolves the tenant.
 */
export function webhookStoreId(body: UberEatsWebhookBody): string | undefined {
  return body.meta?.user_id ?? body.meta?.store_id ?? undefined;
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

// ── Menu: NormalizedMenu → Uber Eats PUT /menus payload ──────────────────────

const DEFAULT_LOCALE = 'en_us';
const ALL_DAYS: UberServiceAvailability['day_of_week'][] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

function text(value: string): UberLocalizedText {
  return { translations: { [DEFAULT_LOCALE]: value } };
}

/**
 * All-day availability for every day. The store's real hours live in Coneeko's
 * `locations.businessHours`; wiring those through is a follow-up (it needs the hours
 * threaded into NormalizedMenu). All-day keeps the test store visible/open, which is what
 * Uber requires for a menu-integrated store to appear (docs: hidden if outside
 * service_availability).
 */
function allDayAvailability(): UberServiceAvailability[] {
  return ALL_DAYS.map((day) => ({
    day_of_week: day,
    time_periods: [{ start_time: '00:00', end_time: '23:59' }],
  }));
}

/**
 * Build Uber's four cross-referencing entity lists from Coneeko's NormalizedMenu.
 *
 * Coneeko ids are published verbatim as Uber entity ids so an inbound order line
 * reverse-maps 1:1 (matches MenuSyncService's `upsertMenuMapping` contract). Modifier
 * *options* become items too — in Uber's model an option references an item that carries
 * its price — so an option's `priceAdjustment` is emitted as that item's `price_info.price`
 * (cents). Prices are integer cents throughout (no dollar scaling).
 */
export function toUberMenu(menu: NormalizedMenu): UberMenuPayload {
  const items: UberItemEntry[] = [];
  const modifierGroups: UberModifierGroupEntry[] = [];
  const seenModifierGroups = new Set<string>();
  const seenOptionItems = new Set<string>();

  const categories: UberCategoryEntry[] = menu.categories.map((cat) => {
    const entities = cat.items.map((item) => {
      const modifierGroupIds = item.modifierGroups.map(
        (g) => g.internalModifierGroupId,
      );

      // Product item.
      items.push({
        id: item.internalItemId,
        title: text(item.name),
        description: item.description ? text(item.description) : undefined,
        price_info: { price: item.price },
        modifier_group_ids: modifierGroupIds.length
          ? { ids: modifierGroupIds }
          : undefined,
      });

      // Modifier groups + their option-items (deduped — groups/options can be shared).
      for (const group of item.modifierGroups) {
        for (const opt of group.modifiers) {
          if (seenOptionItems.has(opt.internalModifierId)) continue;
          seenOptionItems.add(opt.internalModifierId);
          items.push({
            id: opt.internalModifierId,
            title: text(opt.name),
            price_info: { price: opt.priceAdjustment },
          });
        }
        if (seenModifierGroups.has(group.internalModifierGroupId)) continue;
        seenModifierGroups.add(group.internalModifierGroupId);
        modifierGroups.push({
          id: group.internalModifierGroupId,
          title: text(group.name),
          quantity_info: {
            quantity: {
              min_permitted: group.isRequired ? 1 : 0,
              // Single-select groups cap at 1; multi-select uses maxSelections or all options.
              max_permitted: group.multiSelect
                ? (group.maxSelections ?? group.modifiers.length)
                : 1,
            },
          },
          modifier_options: group.modifiers.map((opt) => ({
            id: opt.internalModifierId,
            type: 'ITEM' as const,
          })),
        });
      }

      return { id: item.internalItemId, type: 'ITEM' as const };
    });

    return { id: cat.internalCategoryId, title: text(cat.name), entities };
  });

  return {
    menus: [
      {
        id: 'coneeko-menu',
        title: text('Menu'),
        service_availability: allDayAvailability(),
        category_ids: categories.map((c) => c.id),
      },
    ],
    categories,
    items,
    modifier_groups: modifierGroups,
  };
}
