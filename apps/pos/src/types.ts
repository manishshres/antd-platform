/** Shared domain types. All money amounts are integer cents, mirroring the backend. */

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
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
}

export interface DiningTable {
  id: string;
  floorPlanId: string;
  floorPlanName: string;
  name: string;
  capacity: number;
  shape: string;
  status: 'vacant' | 'occupied' | 'billed' | 'reserved';
  activeOrderId: string | null;
  activeOrderTotal: number;
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
  taxRateBps: number;
}

export interface CartLine {
  product: Product;
  quantity: number;
  notes?: string;
}

export type OrderType = 'dine_in' | 'pickup' | 'delivery';
export type PaymentMethod = 'cash' | 'card';

/** Lifecycle of a locally created order. */
export type LocalOrderStatus =
  | 'held' // parked on this device, not yet placed
  | 'pending_sync' // placed (paid or fired) but not yet accepted by the server
  | 'synced' // accepted by the server
  | 'failed'; // server rejected it (needs attention)

export interface LocalOrderItem {
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  notes?: string;
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
  specialInstructions: string | null;
  errorMessage: string | null;
  createdAt: string;
  syncedAt: string | null;
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
  syncIntervalSec: number;
}
