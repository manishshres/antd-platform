/**
 * Minimal shapes for the KitchenHub v2 payloads we consume. KitchenHub's exact
 * schema is only fully visible once we have API access; these are intentionally
 * permissive (optional fields, string|number money) so a novel field never throws.
 * When we see real payloads, tighten here + the mapper — nothing else changes.
 */

export interface KitchenHubCredentials {
  clientId: string;
  clientSecret: string;
  /** Shared secret we configure as KitchenHub's webhook Authorization header. */
  webhookSecret?: string;
  /** KitchenHub store id this account maps to (also mirrored on integration_accounts). */
  storeId?: string;
}

export interface KitchenHubTokenResponse {
  access_token: string;
  refresh_token: string;
  /** Seconds until the access token expires (KitchenHub returns this; default assumed if absent). */
  expires_in?: number;
}

export interface KitchenHubModifier {
  id?: string;
  name?: string;
  price?: number | string;
}

export interface KitchenHubOrderItem {
  id?: string;
  external_id?: string;
  name?: string;
  quantity?: number;
  price?: number | string;
  modifiers?: KitchenHubModifier[];
  notes?: string;
}

export interface KitchenHubCustomer {
  name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
}

export interface KitchenHubOrder {
  /** KitchenHub's own order id. */
  id?: string;
  /** The marketplace's order id / number (DoorDash/UberEats side). */
  external_id?: string;
  order_number?: string;
  /** Which marketplace this order came from. */
  provider?: string;
  source?: string;
  status?: string;
  created_at?: string;
  type?: string; // 'pickup' | 'delivery' | 'dine_in'
  customer?: KitchenHubCustomer;
  items?: KitchenHubOrderItem[];
  subtotal?: number | string;
  tax?: number | string;
  tip?: number | string;
  total?: number | string;
  notes?: string;
}

/** Webhook envelope KitchenHub POSTs to our endpoint. */
export interface KitchenHubWebhookBody {
  /** Unique event id (used for idempotency); some payloads nest it under data. */
  id?: string;
  event_id?: string;
  /** Webhook type: Order | Menu | IntegrationStatus | Delivery | Cook | ... */
  type?: string;
  event?: string;
  /** For Order webhooks, the order payload (may be the body itself or nested). */
  order?: KitchenHubOrder;
  data?: KitchenHubOrder & { id?: string };
}
