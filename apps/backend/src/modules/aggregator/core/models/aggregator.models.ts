// ── Normalized Order ──────────────────────────────────────────────────────
// Provider-agnostic representation produced by each adapter.
// The Order Normalization Service maps this into a Coneeko Order + External Order.

export interface NormalizedOrder {
  externalOrderId: string;
  /** Marketplace-side status string (preserved as-is in external_orders.external_status) */
  externalStatus: string;
  /**
   * The underlying marketplace this order originated from (doordash / ubereats /
   * grubhub), used as the Coneeko order `source` for reporting. May differ from the
   * transport adapter: a DoorDash order relayed through KitchenHub has
   * sourceChannel='doordash' but arrives via the KitchenHub integration account.
   * Falls back to the adapter's provider name when the marketplace is unknown.
   */
  sourceChannel?: string;
  /** ISO-8601 timestamp from the marketplace (may differ from Coneeko receivedAt) */
  externalCreatedAt?: string;
  totalAmount: number; // cents
  subtotal?: number; // cents
  taxAmount?: number; // cents
  tipAmount?: number; // cents
  currency?: string;
  orderType?: string; // 'pickup' | 'delivery' | 'dine_in'
  specialInstructions?: string;
  items: NormalizedOrderItem[];
  customerInfo?: {
    name?: string;
    phone?: string;
    email?: string;
  };
  /** The full raw JSON from the marketplace — stored in external_orders.raw_payload */
  rawPayload: any;
}

export interface NormalizedOrderItem {
  externalItemId: string;
  name: string;
  quantity: number;
  // Unit price in cents the customer paid, INCLUSIVE of modifier adjustments — matches
  // Coneeko order_items.price semantics. `modifiers[].priceAdjustment` is informational.
  price: number;
  modifiers?: {
    externalModifierId: string;
    name: string;
    priceAdjustment: number; // cents
  }[];
  specialInstructions?: string;
}

// ── Normalized Menu ───────────────────────────────────────────────────────
// Coneeko is the source of truth. This is the format pushed outward to adapters.

export interface NormalizedMenu {
  categories: NormalizedMenuCategory[];
}

export interface NormalizedMenuCategory {
  /** Coneeko category ID */
  internalCategoryId: string;
  name: string;
  sortOrder: number;
  items: NormalizedMenuItem[];
}

export interface NormalizedMenuItem {
  /** Coneeko menu_items.id — the adapter uses menu_provider_mappings to find the external ID */
  internalItemId: string;
  name: string;
  description?: string;
  price: number; // cents
  imageUrl?: string;
  sortOrder: number;
  modifierGroups: NormalizedModifierGroup[];
}

export interface NormalizedModifierGroup {
  internalModifierGroupId: string;
  name: string;
  isRequired: boolean;
  multiSelect: boolean;
  maxSelections?: number;
  modifiers: {
    internalModifierId: string;
    name: string;
    priceAdjustment: number; // cents
  }[];
}
