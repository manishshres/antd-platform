import { NormalizedOrder, NormalizedMenu } from '../models/aggregator.models';

// ── Split Provider Interfaces ────────────────────────────────────────────
// Not every provider supports everything. KitchenHub implements all three;
// a future DoorDash adapter may only implement OrderProvider + WebhookProvider.
// The core never force-casts — it checks providerCapabilities at runtime.

/**
 * Order-related operations against a marketplace.
 */
export interface OrderProvider {
  readonly providerName: string;

  /** Fetch a page of orders from the marketplace */
  getOrders(
    connectionId: string,
    params?: Record<string, any>,
  ): Promise<NormalizedOrder[]>;

  /** Accept / confirm an order on the marketplace side */
  acceptOrder(connectionId: string, externalOrderId: string): Promise<void>;

  /** Reject an incoming order (e.g. out of stock) */
  rejectOrder(
    connectionId: string,
    externalOrderId: string,
    reason?: string,
  ): Promise<void>;

  /** Cancel a previously accepted order */
  cancelOrder(
    connectionId: string,
    externalOrderId: string,
    reason?: string,
  ): Promise<void>;
}

/**
 * Menu synchronization — push Coneeko's menu outward to the marketplace.
 */
export interface MenuProvider {
  readonly providerName: string;

  /** Full menu push (replaces the menu on the marketplace) */
  syncMenu(connectionId: string, menu: NormalizedMenu): Promise<void>;

  /** Partial / incremental menu update */
  updateMenu(
    connectionId: string,
    menu: Partial<NormalizedMenu>,
  ): Promise<void>;
}

/**
 * Inbound webhook handling for a marketplace.
 */
export interface WebhookProvider {
  readonly providerName: string;

  /** Validate the webhook signature/HMAC. Throws WebhookSignatureInvalidError on failure. */
  validateWebhook(
    payload: any,
    headers: Record<string, string>,
    secret: string,
  ): boolean;

  /** Parse the raw webhook body into a normalized event envelope. */
  parseEvent(payload: any): NormalizedWebhookEvent;
}

/**
 * Optional capability: reconstruct a NormalizedOrder directly from a webhook body
 * (for providers like KitchenHub that embed the full order in the webhook, avoiding
 * a follow-up fetch). Returns null when the payload carries no order.
 */
export interface WebhookOrderExtractor {
  orderFromWebhook(payload: any): NormalizedOrder | null;
}

// ── Shared Types ─────────────────────────────────────────────────────────

export interface NormalizedWebhookEvent {
  externalEventId: string;
  eventType:
    | 'order.created'
    | 'order.updated'
    | 'order.canceled'
    | 'delivery.status'
    | 'menu.sync.status'
    | 'unknown';
  externalOrderId?: string;
  rawPayload: any;
}
