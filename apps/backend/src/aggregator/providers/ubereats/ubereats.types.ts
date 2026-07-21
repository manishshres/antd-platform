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

export interface UberOrder {
  id?: string;
  display_id?: string;
  current_state?: string; // CREATED | ACCEPTED | DENIED | FINISHED | CANCELED ...
  placed_at?: string;
  type?: string; // e.g. DELIVERY_BY_UBER, PICK_UP
  eater?: UberEater;
  eaters?: UberEater[];
  cart?: { items?: UberCartItem[] };
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
