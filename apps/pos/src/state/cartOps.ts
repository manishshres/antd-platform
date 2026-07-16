/**
 * Pure cart operations — every state transition and derivation the register
 * cart needs, kept out of the React provider so it stays testable and the
 * provider stays a thin wiring layer.
 */
import type {
  CartLine,
  Customer,
  DiningTable,
  Discount,
  LocalOrder,
  OrderType,
  Product,
} from '../types';
import { discountAmountFor, taxFor } from '../utils/money';
import { newId } from '../utils/ids';
import { getDiscounts } from '../db/catalogRepo';

export interface CartTotals {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  itemCount: number;
}

// ── Line transitions ──────────────────────────────────────────────────────────

export function addLine(lines: CartLine[], product: Product): CartLine[] {
  const existing = lines.find((l) => l.product.id === product.id);
  if (existing) {
    return lines.map((l) =>
      l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l,
    );
  }
  return [...lines, { product, quantity: 1 }];
}

export function addLineWithOptions(
  lines: CartLine[],
  product: Product,
  quantity: number,
  notes?: string,
): CartLine[] {
  const idx = lines.findIndex((l) => l.product.id === product.id);
  if (idx === -1) {
    return [...lines, { product, quantity, notes }];
  }
  return lines.map((l, i) =>
    i === idx
      ? { ...l, quantity: l.quantity + quantity, notes: notes || l.notes }
      : l,
  );
}

export function setLineQuantity(
  lines: CartLine[],
  productId: string,
  quantity: number,
): CartLine[] {
  return quantity <= 0
    ? lines.filter((l) => l.product.id !== productId)
    : lines.map((l) => (l.product.id === productId ? { ...l, quantity } : l));
}

export function updateLineDetails(
  lines: CartLine[],
  productId: string,
  quantity: number,
  notes?: string,
): CartLine[] {
  return quantity <= 0
    ? lines.filter((l) => l.product.id !== productId)
    : lines.map((l) =>
        l.product.id === productId ? { ...l, quantity, notes } : l,
      );
}

export function removeLineFrom(lines: CartLine[], productId: string): CartLine[] {
  return lines.filter((l) => l.product.id !== productId);
}

// ── Derivations ───────────────────────────────────────────────────────────────

export function cartTotals(
  lines: CartLine[],
  discount: Discount | null,
  taxRateBps: number,
): CartTotals {
  const subtotal = lines.reduce((sum, l) => sum + l.product.price * l.quantity, 0);
  // Same tender math as the backend's createPosOrder: discount reduces
  // the taxable base, tax applies to the discounted subtotal.
  const discountAmount = discountAmountFor(discount, subtotal);
  const taxableBase = subtotal - discountAmount;
  const taxAmount = taxFor(taxableBase, taxRateBps);
  return {
    subtotal,
    discountAmount,
    taxAmount,
    totalAmount: taxableBase + taxAmount,
    itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
  };
}

// ── LocalOrder ⇄ cart mapping ─────────────────────────────────────────────────

export function linesFromOrder(order: LocalOrder): CartLine[] {
  return order.items.map((item) => ({
    product: {
      id: item.menuItemId,
      categoryId: '',
      name: item.name,
      description: null,
      price: item.unitPrice,
      imageUrl: null,
      isAvailable: true,
      isFavorite: false,
      sortOrder: 0,
    },
    quantity: item.quantity,
    notes: item.notes,
  }));
}

export function customerFromOrder(order: LocalOrder): Customer | null {
  if (!order.customerId && order.customerName === 'Walk-in') return null;
  return {
    id: order.customerId ?? '',
    name: order.customerName,
    phone: order.customerPhone || null,
    email: null,
    notes: null,
    dirty: false,
    updatedAt: order.createdAt,
  };
}

export function tableFromOrder(order: LocalOrder): DiningTable | null {
  if (!order.tableId || !order.tableName) return null;
  return {
    id: order.tableId,
    floorPlanId: '',
    floorPlanName: '',
    name: order.tableName,
    capacity: order.guests ?? 4,
    shape: 'rectangle',
    status: 'vacant',
    activeOrderId: null,
    activeOrderTotal: 0,
  };
}

/**
 * Prefer the live cached discount (percent discounts keep scaling when the
 * resumed cart is edited); fall back to a fixed snapshot of the amount if
 * it disappeared from the cache while the order was held.
 */
export function discountFromOrder(order: LocalOrder): Discount | null {
  if (!order.discountId) return null;
  return (
    getDiscounts().find((d) => d.id === order.discountId) ?? {
      id: order.discountId,
      name: order.discountName ?? 'Discount',
      code: null,
      type: 'fixed',
      value: order.discountAmount,
      requiresManager: false,
    }
  );
}

export interface CartSnapshot {
  lines: CartLine[];
  customer: Customer | null;
  table: DiningTable | null;
  guests: number | null;
  orderType: OrderType;
  discount: Discount | null;
  resumedOrderId: string | null;
}

/** Snapshot the cart into a LocalOrder (caller decides held vs pending_sync). */
export function buildLocalOrder(
  snapshot: CartSnapshot,
  taxRateBps: number,
  overrides?: Partial<LocalOrder>,
): LocalOrder {
  const { lines, customer, table, guests, orderType, discount, resumedOrderId } =
    snapshot;
  const t = cartTotals(lines, discount, taxRateBps);
  return {
    id: resumedOrderId ?? newId(),
    serverId: null,
    ticketNumber: null,
    status: 'held',
    items: lines.map((l) => ({
      menuItemId: l.product.id,
      name: l.product.name,
      unitPrice: l.product.price,
      quantity: l.quantity,
      notes: l.notes,
    })),
    customerId: customer?.id || null,
    customerName: customer?.name || 'Walk-in',
    customerPhone: customer?.phone || '',
    tableId: table?.id ?? null,
    tableName: table?.name ?? null,
    guests,
    orderType,
    subtotal: t.subtotal,
    discountId: discount?.id ?? null,
    discountName: discount?.name ?? null,
    discountAmount: t.discountAmount,
    taxAmount: t.taxAmount,
    totalAmount: t.totalAmount,
    paymentMethod: null,
    tenderedAmount: null,
    changeAmount: null,
    specialInstructions: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    syncedAt: null,
    ...overrides,
  };
}
