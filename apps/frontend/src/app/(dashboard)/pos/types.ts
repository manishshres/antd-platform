/** Shared types + tiny helpers for the POS register and its components. */

export interface ModifierOption {
  id: string;
  name: string;
  priceAdjustment: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  isRequired: boolean;
  multiSelect?: boolean;
  maxSelections?: number | null;
  options: ModifierOption[];
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  categoryId: string;
  isAvailable: boolean;
  isFavorite?: boolean;
  deletedAt?: string | null;
  modifiers?: ModifierGroup[];
}

export interface Category {
  id: string;
  name: string;
  isAvailable: boolean;
  deletedAt?: string | null;
  items?: MenuItem[];
}

export interface CartOption {
  id: string;
  name: string;
  priceAdjustment: number;
  groupName: string;
}

export interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  unitPrice: number; // cents, incl. selected options
  quantity: number;
  options: CartOption[];
  notes?: string;
  course?: number;
}

export interface Discount {
  id: string;
  name: string;
  code?: string | null;
  type: string; // 'percent' | 'fixed'
  value: number; // percent (10 = 10%) or cents
  requiresManager: boolean;
}

/** Row in the Open Orders drawer — unpaid orders waiting to be settled/edited. */
export interface OpenOrderRow {
  id: string;
  ticketNumber?: number | null;
  customerName: string;
  customerPhone: string;
  status: string;
  source?: string | null;
  paidAt?: string | null;
  totalAmount: number;
  createdAt: string;
}

/** Table on a floor plan, with live status from the tables endpoint. */
export interface FloorTable {
  id: string;
  name: string;
  capacity?: number | null;
  shape?: string | null; // 'circle' | 'rect'
  posX?: number | null;
  posY?: number | null;
  status?: string | null; // 'available' | 'occupied' | 'billed'
  activeOrderId?: string | null;
  activeOrderTotal?: number | null;
}

export interface FloorPlan {
  id: string;
  name: string;
  tables?: FloorTable[];
}

/** Customer profile row from GET /customers/search. */
export interface CustomerRow {
  id: string;
  name: string;
  phone?: string | null;
  notes?: string | null;
}

/** Shape of the order returned by GET /orders/:id (fields the register needs). */
export interface ExistingOrder {
  id: string;
  ticketNumber?: number | null;
  customerName: string;
  customerId?: string | null;
  status: string;
  source?: string | null;
  paidAt?: string | null;
  orderType?: string | null;
  tableId?: string | null;
  specialInstructions?: string | null;
  discountId?: string | null;
  tipAmount?: number | null;
  items: {
    menuItemId: string;
    menuItemName: string;
    quantity: number;
    price: number;
    notes?: string | null;
    modifiers?: {
      optionId?: string;
      modifier: string;
      option: string;
      priceAdjustment: number;
    }[];
  }[];
}

export const FAVORITES_ID = "__favorites__";

export const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const orderLabel = (o: { ticketNumber?: number | null; id: string }) =>
  o.ticketNumber != null ? `#${o.ticketNumber}` : `#${o.id.slice(0, 8)}`;

/** InputNumber can surface NaN mid-edit; only ever keep finite values. */
export const finiteOrNull = (v: number | string | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
