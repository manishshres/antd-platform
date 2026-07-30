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

  /**
   * Fetch a single order by its marketplace id. Needed for providers whose webhooks
   * are notification-only (e.g. Uber Eats sends a resource_href, not the order body).
   * Returns null if the order can't be found.
   */
  getOrder(
    connectionId: string,
    externalOrderId: string,
  ): Promise<NormalizedOrder | null>;

  /**
   * Accept / confirm an order on the marketplace side. `options.externalReferenceId`
   * is our own order id, which providers surface to merchant support tooling
   * (Uber: `external_reference_id` on accept_pos_order).
   */
  acceptOrder(
    connectionId: string,
    externalOrderId: string,
    options?: AcceptOrderOptions,
  ): Promise<void>;

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

  /**
   * Validate the webhook against the account's decrypted credentials. `rawBody` is the
   * exact bytes received — required for HMAC-signed providers (Uber Eats, keyed on
   * clientSecret) where re-serializing the parsed body would change the signature.
   * Shared-secret providers (KitchenHub) ignore rawBody and compare a header to
   * credentials.webhookSecret. Each adapter reads the credential field it needs.
   * Returns false on mismatch.
   */
  validateWebhook(
    rawBody: string | Buffer,
    headers: Record<string, string>,
    credentials: Record<string, unknown>,
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

export interface AcceptOrderOptions {
  /** Coneeko's internal order id, passed through to the marketplace for reconciliation. */
  externalReferenceId?: string;
}

export interface NormalizedWebhookEvent {
  externalEventId: string;
  eventType:
    | 'order.created'
    | 'order.updated'
    | 'order.canceled'
    | 'delivery.status'
    | 'menu.sync.status'
    // Store lifecycle (Uber Eats): a store granting/removing app access, or toggling
    // its online status. These carry a store id in the payload, not an order id.
    | 'store.provisioned'
    | 'store.deprovisioned'
    | 'store.status'
    | 'unknown';
  externalOrderId?: string;
  rawPayload: any;
}
