/** Shared domain types. All money amounts are integer cents, mirroring the backend. */

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
}

/**
 * A Bluetooth kitchen printer paired with this register, grouped under a
 * named station (Grill, Fry, Bar, ...). Local-only — Bluetooth pairing is
 * per-tablet, so this never syncs with the backend.
 */
export interface PrinterStation {
  id: string;
  name: string;
  enabled: boolean;
  /** Bluetooth MAC address of this station's paired printer. */
  printerTarget: string;
  printerDeviceName: string;
  sortOrder: number;
}

export interface ModifierOption {
  id: string;
  name: string;
  /** Cents added to the item's base price when selected. */
  priceAdjustment: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  isRequired: boolean;
  multiSelect: boolean;
  maxSelections: number | null;
  options: ModifierOption[];
}

export interface Product {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: number; // cents
  imageUrl: string | null;
  isAvailable: boolean;
  isFavorite: boolean;
  sortOrder: number;
  modifiers: ModifierGroup[];
  sku: string | null;
  isCombo: boolean;
  taxExempt: boolean;
  stockQuantity: number | null;
  lowStockThreshold: number | null;
}

/** An option chosen on a cart line — the modifierId ties it back to its group. */
export interface SelectedModifier {
  modifierId: string;
  optionId: string;
  name: string;
  priceAdjustment: number;
  /**
   * How many of this option the line carries ("Extra Cheese ×2"). Absent means
   * one. The server has no quantity field — `order-pricing.service.ts` maps over
   * `optionIds` and charges per entry — so a quantity of N is sent as the same
   * optionId repeated N times.
   */
  quantity?: number;
}

export interface Customer {
  /** Local row id — equals the server id once synced. */
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  /** 1 when created/edited offline and not yet pushed. */
  dirty: boolean;
  updatedAt: string;
  /** Cash-back-style balance; 1 point = 1 cent redeemable. Server-authoritative. */
  loyaltyPoints: number;
}

export interface DiningTable {
  id: string;
  floorPlanId: string;
  floorPlanName: string;
  /** Floor plan canvas size, in the same units as posX/posY — denormalized onto each table row. */
  floorPlanWidth: number;
  floorPlanHeight: number;
  name: string;
  capacity: number;
  shape: string;
  status: 'vacant' | 'occupied' | 'billed' | 'reserved';
  activeOrderId: string | null;
  activeOrderTotal: number;
  /** Position on the floor plan canvas; (0, 0) until placed in the layout editor. */
  posX: number;
  posY: number;
}

export interface Discount {
  id: string;
  name: string;
  /** Promo code cashiers/customers can type ("LUNCH10"); null = button-only. */
  code: string | null;
  type: 'percent' | 'fixed';
  /** percent: whole percent (10 = 10%); fixed: cents off the subtotal. */
  value: number;
  requiresManager: boolean;
}

export interface Location {
  id: string;
  name: string;
  /** Owning business, printed as the receipt header above the branch name. */
  organizationName: string | null;
  taxRateBps: number;
  /** 0/unset = the register doesn't offer a service-charge toggle at checkout. */
  serviceChargeBps: number;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phoneNumber: string | null;
}

/** 1 Apps, 2 Mains, 3 Dessert. Undefined = uncoursed. */
export type Course = 1 | 2 | 3;

export const COURSE_LABELS: Record<Course, string> = {
  1: 'Apps',
  2: 'Mains',
  3: 'Dessert',
};

export interface CartLine {
  /**
   * Stable per-line identity, minted when the line is created and never reused.
   * Every cart operation targets this rather than `product.id` — two lines of
   * the same product differing only by modifiers (one Spicy, one Regular) are
   * genuinely different order lines and must be addressable independently.
   */
  id: string;
  product: Product;
  quantity: number;
  notes?: string;
  course?: Course;
  selectedModifiers?: SelectedModifier[];
  /** Manager-authorized replacement unit price (cents, 0 = comped). Overrides the product
   *  price and any modifier price adjustments for this line only. */
  priceOverride?: number;
  /** Free-text reason for the override, shown in the server-side audit log. */
  priceOverrideReason?: string;
}

export type OrderType = 'dine_in' | 'pickup' | 'delivery';
export type PaymentMethod =
  | 'cash'
  | 'card'
  | 'gift_card'
  | 'store_credit'
  | 'other';

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  gift_card: 'Gift Card',
  store_credit: 'Store Credit',
  other: 'Other',
};

/** Human-readable tender label, falling back to the raw value for unknown methods (e.g. 'split'). */
export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return '—';
  return PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method;
}

/** Lifecycle of a locally created order. */
export type LocalOrderStatus =
  | 'held' // parked on this device, not yet placed
  | 'open_tab' // seated at a table, fired to the kitchen, still taking items
  | 'pending_sync' // placed (paid or fired) but not yet accepted by the server
  | 'synced' // accepted by the server
  | 'failed'; // server rejected it (needs attention)

/**
 * A unit of work owed to the server. `orders.status` is what the cashier sees;
 * this is how it gets there. FIFO per order — 'create' must land before the
 * 'append'/'settle' rows that address the server id it returns.
 */
export type MutationKind = 'create' | 'append' | 'settle' | 'fire';

export interface OrderMutation {
  id: string;
  orderId: string;
  kind: MutationKind;
  /** Kind-specific body; shape is owned by the sync engine's dispatch. */
  payload: unknown;
  createdAt: string;
  attempts: number;
  lastError: string | null;
}

export interface LocalOrderItem {
  /**
   * Mirrors `CartLine.id`. Persisted (inside `items_json`) so reloading a tab
   * rebuilds the baseline with the same identities the cart had when the items
   * were fired — without it, a resumed tab couldn't tell which lines the
   * kitchen already has. Optional so orders written before this existed still
   * parse; those fall back to a derived key.
   */
  lineId?: string;
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  notes?: string;
  course?: Course;
  /** ISO timestamp this line went to the kitchen; null/undefined = not fired. */
  firedAt?: string | null;
  /** Manager-authorized replacement unit price (cents, 0 = comped), if any. */
  priceOverride?: number;
  /** Free-text reason for the override, shown in the server-side audit log. */
  priceOverrideReason?: string;
  /** Selected modifier options; unitPrice above is the base item price only. */
  modifiers?: SelectedModifier[];
}

export interface LocalOrder {
  /** UUID minted on-device; doubles as the server idempotency key (clientOrderId). */
  id: string;
  serverId: string | null;
  ticketNumber: number | null;
  status: LocalOrderStatus;
  items: LocalOrderItem[];
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  tableId: string | null;
  tableName: string | null;
  guests: number | null;
  orderType: OrderType;
  subtotal: number;
  discountId: string | null;
  discountName: string | null;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paymentMethod: PaymentMethod | null;
  tenderedAmount: number | null;
  changeAmount: number | null;
  /** Cents; added on top of totalAmount when the tender is confirmed. */
  tipAmount: number;
  /** Cents; locally-estimated auto-gratuity, added when the tender is confirmed. The
   *  server recomputes the authoritative amount from the location's configured rate. */
  serviceChargeAmount: number;
  /** Cents; loyalty points redeemed toward this order (1 point = 1 cent). */
  loyaltyPointsRedeemed: number;
  specialInstructions: string | null;
  errorMessage: string | null;
  createdAt: string;
  syncedAt: string | null;
  /** Set when this order is an open tab; drives the "open for 40m" display. */
  tabOpenedAt: string | null;
  /**
   * 'by_course' holds the kitchen ticket until each course is fired; 'all'
   * (the default, and what every non-dine-in ticket uses) prints on save.
   */
  fireMode: 'all' | 'by_course';
  /** The business day this order belongs to, set when the order is created. */
  businessDayId: string | null;
}

/** A cash-drawer shift on this device: opened with a float, closed with a count. */
export interface DrawerSession {
  id: string;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt: string | null;
  /** Cash float counted into the drawer at open. */
  openingAmount: number;
  /** Snapshots taken at close; zero/null while the session is open. */
  cashSales: number;
  otherSales: number;
  expectedAmount: number | null;
  countedAmount: number | null;
  difference: number | null;
  remarks: string | null;
}

/** A named business day opened/closed by a manager. Gates order-taking. */
export interface BusinessDay {
  id: string;
  /** Human-readable label, e.g. "2026-07-20". */
  date: string;
  openedAt: string;
  closedAt: string | null;
  openedBy: string;
  closedBy: string | null;
}

/** Server order row as returned by GET /api/v2/orders. */
export interface ServerOrder {
  id: string;
  ticketNumber: number | null;
  customerName: string;
  customerPhone: string;
  status: string;
  subtotal: number | null;
  taxAmount: number | null;
  totalAmount: number;
  paymentMethod: string | null;
  orderType: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface ServerOrderDetailItem {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  notes: string | null;
  course: Course | null;
  firedAt: string | null;
}

/** Full order detail returned by GET /api/v2/orders/:id */
export interface ServerOrderDetail extends ServerOrder {
  specialInstructions: string | null;
  discountAmount: number | null;
  tableId: string | null;
  tableName: string | null;
  tenderedAmount: number | null;
  changeAmount: number | null;
  items: ServerOrderDetailItem[];
  customer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
  } | null;
  table: { id: string; name: string } | null;
}

export interface PosSettings {
  apiUrl: string;
  apiKey: string;
  locationId: string;
  locationName: string;
  taxRateBps: number;
  serviceChargeBps: number;
  syncIntervalSec: number;
  /** Whether a thermal printer is configured and should be used. */
  printerEnabled: boolean;
  /** Bluetooth MAC address of the paired ESC/POS printer (e.g. "AA:BB:CC:DD:EE:FF"). */
  printerTarget: string;
  printerDeviceName: string;
  /** Characters per line at the printer's configured font — 32 for 58mm paper, 48 for 80mm. */
  printerCharsPerLine: 32 | 48;
  /**
   * Print text size, from XSmall to Max. 0 is Font A at normal width/height;
   * 1-3 step Font A's ESC/POS width/height multiplier up (capped at 3); -1/-2
   * switch to the printer's condensed Font B instead, since width/height can't
   * go below 1x — -2 additionally tightens line spacing for the most compact ticket.
   */
  printerFontScale: -2 | -1 | 0 | 1 | 2 | 3;
  /** Print a kitchen ticket automatically when an order is fired/held. */
  printerAutoKitchen: boolean;
  /** Print a customer receipt automatically when a payment is confirmed. */
  printerAutoReceipt: boolean;
}

export type PrintJobStatus = 'queued' | 'printing' | 'printed' | 'failed';

/** One kitchen ticket bound for one station's printer. */
export interface PrintJob {
  id: string;
  orderId: string;
  stationName: string;
  /** Bluetooth MAC. Empty when no printer is paired for this station — the job
   *  is still recorded so the failure is visible rather than silent. */
  target: string;
  status: PrintJobStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Roll-up of an order's tickets, for the badge on the Orders screen. */
export type OrderPrintStatus = 'none' | 'queued' | 'printing' | 'printed' | 'failed';

export interface Employee {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  role: string;
  isManager: boolean;
  organizationId: string | null;
  locationId: string | null;
}
