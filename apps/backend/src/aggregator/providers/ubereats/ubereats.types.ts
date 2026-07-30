/**
 * Minimal shapes for the Uber Eats Marketplace/Integration API payloads we consume.
 * Uber's money objects carry an integer `amount` in the currency's minor unit (cents)
 * plus a currency_code — unlike KitchenHub's decimal dollars. Fields are permissive
 * (optional) so a novel field never throws; tighten against a real test order once
 * credentials are wired.
 *
 * Docs: https://developer.uber.com/docs/eats
 */

export interface UberEatsCredentials {
  clientId: string;
  /** Used for BOTH OAuth (client_credentials) and webhook HMAC (X-Uber-Signature). */
  clientSecret: string;
  /** The Uber store UUID this account maps to (also mirrored on integration_accounts). */
  storeId?: string;
}

export interface UberEatsTokenResponse {
  access_token: string;
  token_type?: string;
  /** Seconds until expiry (Uber returns ~2,592,000 = 30 days). */
  expires_in?: number;
  scope?: string;
}

/** Uber money object: amount is an integer in the minor unit (cents). */
export interface UberMoney {
  amount?: number;
  currency_code?: string;
  formatted_amount?: string;
}

export interface UberSelectedModifierItem {
  id?: string;
  title?: string;
  price?: { total_price?: UberMoney; unit_price?: UberMoney };
  quantity?: { amount?: number };
}

export interface UberSelectedModifierGroup {
  selected_items?: UberSelectedModifierItem[];
}

export interface UberCartItem {
  id?: string;
  instance_id?: string;
  title?: string;
  quantity?: number | { amount?: number };
  price?: { unit_price?: UberMoney; total_price?: UberMoney };
  selected_modifier_groups?: UberSelectedModifierGroup[];
  special_instructions?: string;
}

export interface UberEater {
  first_name?: string;
  last_name?: string;
  phone?: string;
  phone_code?: string;
}

export interface UberCart {
  items?: UberCartItem[];
  /** Order-level customer note. This — not a top-level field — is where Uber puts it. */
  special_instructions?: string;
}

export interface UberOrder {
  id?: string;
  display_id?: string;
  external_reference_id?: string;
  current_state?: string; // CREATED | ACCEPTED | DENIED | FINISHED | CANCELED ...
  placed_at?: string;
  type?: string; // e.g. DELIVERY_BY_UBER, PICK_UP
  eater?: UberEater;
  eaters?: UberEater[];
  /** v1 (`webhooks_version: "1.0.0"`) names the customer list `customers`. */
  customers?: UberEater[];
  cart?: UberCart;
  /** v1 returns a cart list rather than a single cart. */
  carts?: UberCart[];
  payment?: {
    charges?: {
      total?: UberMoney;
      sub_total?: UberMoney;
      tax?: UberMoney;
      tip?: UberMoney;
    };
  };
  special_instructions?: string;
  store_instructions?: string;
}

/** Uber wraps the fetched order under `order`, or returns it at the top level. */
export interface UberOrderResponse {
  order?: UberOrder;
}

// ── Order fulfillment request bodies ─────────────────────────────────────────
// POST /v1/eats/orders/{order_id}/{accept_pos_order,deny_pos_order,cancel}.
// All three are v1 — the surrounding Marketplace order *read* API is still v2.

/**
 * Which Eats features our integration actually relays to the kitchen. Uber gates
 * customer-facing affordances on this: claim a field here only if the printed ticket
 * really carries it, otherwise customers are promised something the kitchen never sees.
 */
export interface UberFieldsRelayed {
  order_special_instructions?: boolean;
  item_special_instructions?: boolean;
  item_special_requests?: boolean;
  promotions?: boolean;
}

export interface UberAcceptOrderBody {
  /** Required by Uber — a human-readable note recorded against the acceptance. */
  reason: string;
  /** Our own order id, so Uber Eats Manager and support can cross-reference. */
  external_reference_id?: string;
  /** Unix seconds. */
  pickup_time?: number;
  fields_relayed?: UberFieldsRelayed;
  order_pickup_instructions?: string;
}

/** Deny (before acceptance) reason codes. */
export type UberDenyReasonCode =
  | 'STORE_CLOSED'
  | 'POS_NOT_READY'
  | 'POS_OFFLINE'
  | 'ITEM_AVAILABILITY'
  | 'MISSING_ITEM'
  | 'MISSING_INFO'
  | 'PRICING'
  | 'CAPACITY'
  | 'ADDRESS'
  | 'SPECIAL_INSTRUCTIONS'
  | 'OTHER';

export interface UberDenyOrderBody {
  reason: {
    code: UberDenyReasonCode;
    explanation: string;
    out_of_stock_items?: { instance_id?: string; id?: string }[];
    invalid_items?: { instance_id?: string; id?: string }[];
  };
}

/** Cancel (after acceptance) reason codes — a different enum from deny. */
export type UberCancelReasonCode =
  | 'OUT_OF_ITEMS'
  | 'KITCHEN_CLOSED'
  | 'CUSTOMER_CALLED_TO_CANCEL'
  | 'RESTAURANT_TOO_BUSY'
  | 'CANNOT_COMPLETE_CUSTOMER_NOTE'
  | 'OTHER';

export interface UberCancelOrderBody {
  reason: UberCancelReasonCode;
  /** Free text; Uber expects it when reason is OTHER. */
  details?: string;
}

// ── Store discovery (GET /v1/eats/stores) ────────────────────────────────────

export interface UberStore {
  store_id?: string;
  name?: string;
  merchant_store_id?: string;
  timezone?: string;
  status?: string;
  web_url?: string;
  contact_emails?: string[];
  location?: {
    address?: string;
    city?: string;
    country?: string;
    postal_code?: string;
    latitude?: number;
    longitude?: number;
  };
  /** Present when some app is already integrated with the store. */
  pos_data?: {
    integration_enabled?: boolean;
    integrator_store_id?: string;
    store_configuration_data?: string;
  };
}

export interface UberStoresResponse {
  stores?: UberStore[];
  /** Empty/absent on the last page. */
  next_key?: string;
}

// ── Integration Activation & Configuration API ───────────────────────────────
// {POST,GET,PATCH,DELETE} /v1/eats/stores/{store_id}/pos_data.
// POST/DELETE need a *merchant user* token (authorization_code grant,
// `eats.pos_provisioning`); GET/PATCH use our developer token (`eats.store`).

export interface UberWebhooksConfig {
  order_release_webhooks?: { is_enabled: boolean };
  schedule_order_webhooks?: { is_enabled: boolean };
  delivery_status_webhooks?: { is_enabled: boolean };
  /**
   * "1.0.0" opts the store into the v1 webhook/resource_href generation (and the
   * `orders.failure` cancellation event). Omit for Uber's legacy v2 behaviour.
   */
  webhooks_version?: string;
}

export interface UberPosDataBody {
  allowed_customer_requests?: {
    allow_single_use_items_requests?: boolean;
    allow_special_instruction_requests?: boolean;
  };
  integrator_brand_id?: string;
  integrator_store_id?: string;
  is_order_manager?: boolean;
  merchant_store_id?: string;
  require_manual_acceptance?: boolean;
  /** Arbitrary config blob echoed back on GET. Never put PII in here. */
  store_configuration_data?: string;
  webhooks_config?: UberWebhooksConfig;
}

/** PATCH additionally toggles order-fulfillment webhooks on/off. */
export interface UberPosDataPatchBody extends UberPosDataBody {
  integration_enabled?: boolean;
}

export interface UberPosDataResponse extends UberPosDataBody {
  store_id?: string;
  pos_integration_enabled?: boolean;
  online_status?: 'offline' | 'online' | 'unknown';
  partner_store_id?: string;
  order_release_enabled?: boolean;
  auto_accept_enabled?: boolean;
  pos_metadata?: {
    pos_provider?: string;
    pos_version?: string;
    last_sync_time?: string;
  };
  order_manager_client_id?: string;
  is_order_manager_pending?: boolean;
  integration_enabled?: boolean;
}

// ── Menu upload (PUT /v2/eats/stores/{store_id}/menus) ───────────────────────
// Uber's v2 menu is four flat, cross-referencing entity lists. Titles/descriptions are
// localized maps; prices are integer cents. Modifier *options* are themselves items
// (so they carry their own price), referenced from a modifier group by id.

export interface UberLocalizedText {
  translations: Record<string, string>;
}

export interface UberTimePeriod {
  start_time: string; // "HH:MM"
  end_time: string; // "HH:MM"
}

export interface UberServiceAvailability {
  day_of_week:
    | 'monday'
    | 'tuesday'
    | 'wednesday'
    | 'thursday'
    | 'friday'
    | 'saturday'
    | 'sunday';
  time_periods: UberTimePeriod[];
}

export interface UberEntityRef {
  id: string;
  type: 'ITEM' | 'MODIFIER_GROUP';
}

export interface UberMenuEntry {
  id: string;
  title: UberLocalizedText;
  service_availability: UberServiceAvailability[];
  category_ids: string[];
}

export interface UberCategoryEntry {
  id: string;
  title: UberLocalizedText;
  entities: UberEntityRef[];
}

export interface UberItemEntry {
  id: string;
  title: UberLocalizedText;
  description?: UberLocalizedText;
  price_info: { price: number }; // cents
  modifier_group_ids?: { ids: string[] };
}

export interface UberModifierGroupEntry {
  id: string;
  title: UberLocalizedText;
  quantity_info: {
    quantity: { min_permitted: number; max_permitted: number };
  };
  modifier_options: UberEntityRef[];
}

export interface UberMenuPayload {
  menus: UberMenuEntry[];
  categories: UberCategoryEntry[];
  items: UberItemEntry[];
  modifier_groups: UberModifierGroupEntry[];
}

/** Notification-only webhook envelope (no order body — fetch via resource_href). */
export interface UberEatsWebhookBody {
  event_id?: string;
  event_type?: string; // orders.notification | orders.cancel | store.status.changed | ...
  event_time?: number;
  resource_href?: string;
  meta?: {
    resource_id?: string; // the order id
    status?: string;
    user_id?: string;
    store_id?: string;
  };
}
