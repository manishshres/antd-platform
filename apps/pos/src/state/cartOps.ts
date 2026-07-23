/**
 * Pure cart operations — every state transition and derivation the register
 * cart needs, kept out of the React provider so it stays testable and the
 * provider stays a thin wiring layer.
 */
import type {
  CartLine,
  Course,
  Customer,
  DiningTable,
  Discount,
  LocalOrder,
  OrderType,
  Product,
  SelectedModifier,
} from '../types';
import { discountAmountFor, taxFor } from '../utils/money';
import { newId } from '../utils/ids';
import { getDiscounts } from '../db/catalogRepo';

export interface CartTotals {
  subtotal: number;
  discountAmount: number;
  serviceChargeAmount: number;
  taxAmount: number;
  totalAmount: number;
  itemCount: number;
}

// ── Line identity ─────────────────────────────────────────────────────────────

/**
 * Cart lines carry their own immutable `id`. Every operation below targets that
 * id and nothing else — this is the whole invariant.
 *
 * The previous model keyed lines by `productId + course`, which meant a product
 * could only appear once per course. Ordering one Spicy and one Regular of the
 * same dish silently collapsed into a single line of quantity two, keeping
 * whichever modifiers were chosen last: the guest asked for one spicy and the
 * kitchen was told two regular. Identity has to include everything that makes
 * an order line distinct, and once it does, the only stable handle is an id.
 */
export function newLineId(): string {
  return newId();
}

/**
 * Everything that makes two lines interchangeable. A fresh add folds into an
 * existing line only when this matches exactly; any difference — a modifier, a
 * modifier's quantity, a note, a course, an overridden price — earns its own
 * line. Modifiers are sorted so selection order never affects the comparison.
 */
export function mergeSignature(line: {
  product: Product;
  course?: Course;
  notes?: string;
  priceOverride?: number;
  selectedModifiers?: SelectedModifier[];
}): string {
  const mods = (line.selectedModifiers ?? [])
    .map((m) => `${m.optionId}x${m.quantity ?? 1}`)
    .sort((a, b) => a.localeCompare(b))
    .join(',');
  return [
    line.product.id,
    line.course ?? 0,
    line.notes ?? '',
    line.priceOverride ?? '',
    mods,
  ].join('|');
}

/**
 * Identity for a persisted order item.
 *
 * Locally stored orders all carry a `lineId` — migration 17 backfilled the ones
 * written before it existed. The fallback remains for orders mapped down from
 * the server (history detail, reprints), which have no local line identity.
 * Note it reintroduces the old collapsing behaviour for those, so it must not
 * be used as the identity source for anything that fires the kitchen.
 */
export function lineIdForItem(item: {
  lineId?: string;
  menuItemId: string;
  course?: Course;
}): string {
  return item.lineId ?? `${item.menuItemId}:${item.course ?? 0}`;
}

// ── Line transitions ──────────────────────────────────────────────────────────

export function addLine(
  lines: CartLine[],
  product: Product,
  course?: Course,
): CartLine[] {
  return addLineWithOptions(lines, product, 1, undefined, course, undefined);
}

export function addLineWithOptions(
  lines: CartLine[],
  product: Product,
  quantity: number,
  notes?: string,
  course?: Course,
  selectedModifiers?: SelectedModifier[],
): CartLine[] {
  const incoming = { product, notes, course, selectedModifiers };
  const signature = mergeSignature(incoming);
  const idx = lines.findIndex((l) => mergeSignature(l) === signature);
  // Only a line identical in every respect absorbs the new quantity. Anything
  // else — a different spice level, an extra topping, a note — is its own line,
  // so the kitchen ticket and the bill both show exactly what was ordered.
  if (idx === -1) {
    return [
      ...lines,
      { id: newLineId(), product, quantity, notes, course, selectedModifiers },
    ];
  }
  return lines.map((l, i) =>
    i === idx ? { ...l, quantity: l.quantity + quantity } : l,
  );
}

/** Cents added per unit by the line's selected modifiers, counting quantities
 *  (Extra Cheese ×2 charges twice — matching how the server prices repeated
 *  optionIds). */
export function modifierAdjustmentFor(line: CartLine): number {
  return (line.selectedModifiers ?? []).reduce(
    (sum, m) => sum + m.priceAdjustment * (m.quantity ?? 1),
    0,
  );
}

/** Flatten selected modifiers to the wire format: one entry per unit, since
 *  the public API has no modifier-quantity field. */
export function optionIdsFor(modifiers?: SelectedModifier[]): string[] {
  return (modifiers ?? []).flatMap((m) =>
    Array.from({ length: Math.max(1, m.quantity ?? 1) }, () => m.optionId),
  );
}

/**
 * Effective per-unit price: base price plus any selected modifier adjustments, unless a
 * manager has overridden the line price, in which case the override replaces both.
 */
export function lineUnitPrice(line: CartLine): number {
  return line.priceOverride ?? line.product.price + modifierAdjustmentFor(line);
}

/** Set (or clear, with undefined) a manager price override on one cart line. */
export function setLinePriceOverride(
  lines: CartLine[],
  lineId: string,
  priceOverride: number | undefined,
  priceOverrideReason?: string,
): CartLine[] {
  return lines.map((l) =>
    l.id === lineId ? { ...l, priceOverride, priceOverrideReason } : l,
  );
}

export function setLineQuantity(
  lines: CartLine[],
  lineId: string,
  quantity: number,
): CartLine[] {
  return quantity <= 0
    ? lines.filter((l) => l.id !== lineId)
    : lines.map((l) => (l.id === lineId ? { ...l, quantity } : l));
}

/**
 * Edit one line in place, addressed by its id. Editing can make a line
 * identical to another one (drop the note that was the only difference), so
 * the result is folded afterwards — keeping the edited line's id, since that
 * is the one the cashier is looking at.
 */
export function updateLineDetails(
  lines: CartLine[],
  lineId: string,
  quantity: number,
  notes?: string,
  course?: Course,
  selectedModifiers?: SelectedModifier[],
): CartLine[] {
  if (quantity <= 0) return lines.filter((l) => l.id !== lineId);

  const edited = lines.map((l) =>
    l.id === lineId ? { ...l, quantity, notes, course, selectedModifiers } : l,
  );
  const target = edited.find((l) => l.id === lineId);
  if (!target) return edited;

  const signature = mergeSignature(target);
  const twins = edited.filter(
    (l) => l.id !== lineId && mergeSignature(l) === signature,
  );
  if (twins.length === 0) return edited;

  const absorbed = twins.reduce((sum, l) => sum + l.quantity, 0);
  return edited
    .filter((l) => !twins.some((t) => t.id === l.id))
    .map((l) =>
      l.id === lineId ? { ...l, quantity: l.quantity + absorbed } : l,
    );
}

export function removeLineFrom(lines: CartLine[], lineId: string): CartLine[] {
  return lines.filter((l) => l.id !== lineId);
}

// ── Derivations ───────────────────────────────────────────────────────────────

export function cartTotals(
  lines: CartLine[],
  discount: Discount | null,
  taxRateBps: number,
  serviceChargeBps = 0,
  applyServiceCharge = false,
): CartTotals {
  const subtotal = lines.reduce((sum, l) => sum + lineUnitPrice(l) * l.quantity, 0);
  // Same tender math as the backend's createPosOrder: discount reduces the taxable base;
  // service charge is computed off that base and is itself taxable; tax applies last.
  const discountAmount = discountAmountFor(discount, subtotal);
  const taxableBase = subtotal - discountAmount;
  const serviceChargeAmount = applyServiceCharge
    ? Math.round((taxableBase * serviceChargeBps) / 10000)
    : 0;
  const taxAmount = taxFor(taxableBase + serviceChargeAmount, taxRateBps);
  return {
    subtotal,
    discountAmount,
    serviceChargeAmount,
    taxAmount,
    totalAmount: taxableBase + serviceChargeAmount + taxAmount,
    itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
  };
}

// ── LocalOrder ⇄ cart mapping ─────────────────────────────────────────────────

export function linesFromOrder(order: LocalOrder): CartLine[] {
  return order.items.map((item) => ({
    // Persisted identity, so a reloaded tab compares against the same ids it
    // fired under rather than re-firing everything.
    id: lineIdForItem(item),
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
      modifiers: [],
      sku: null,
      isCombo: false,
      taxExempt: false,
      stockQuantity: null,
      lowStockThreshold: null,
    },
    quantity: item.quantity,
    notes: item.notes,
    course: item.course,
    selectedModifiers: item.modifiers,
    priceOverride: item.priceOverride,
    priceOverrideReason: item.priceOverrideReason,
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
    loyaltyPoints: 0,
  };
}

export function tableFromOrder(order: LocalOrder): DiningTable | null {
  if (!order.tableId || !order.tableName) return null;
  return {
    id: order.tableId,
    floorPlanId: '',
    floorPlanName: '',
    floorPlanWidth: 800,
    floorPlanHeight: 600,
    name: order.tableName,
    capacity: order.guests ?? 4,
    shape: 'rectangle',
    status: 'vacant',
    activeOrderId: null,
    activeOrderTotal: 0,
    posX: 0,
    posY: 0,
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

/**
 * Lines added since a tab was loaded — what gets sent as an append.
 *
 * Only positive differences count. Removing a line from a tab that has already
 * fired to the kitchen is a void, not a negative append, and voids are a
 * separate (manager-gated) flow; the cart UI keeps quantities at or above the
 * baseline so a reduction can't silently vanish here.
 */
export function linesDelta(
  baseline: CartLine[],
  current: CartLine[],
): {
  menuItemId: string;
  quantity: number;
  notes?: string;
  course?: Course;
  optionIds?: string[];
  priceOverride?: number;
  priceOverrideReason?: string;
}[] {
  // Keyed by line id, so a second Caesar ordered as a main — or the same dish
  // ordered spicy alongside a regular one — reports as its own new line rather
  // than a quantity bump on an unrelated one.
  const before = new Map(baseline.map((l) => [l.id, l.quantity]));
  const delta: {
    menuItemId: string;
    quantity: number;
    notes?: string;
    course?: Course;
    optionIds?: string[];
    priceOverride?: number;
    priceOverrideReason?: string;
  }[] = [];
  for (const line of current) {
    const added = line.quantity - (before.get(line.id) ?? 0);
    if (added > 0) {
      delta.push({
        menuItemId: line.product.id,
        quantity: added,
        notes: line.notes,
        course: line.course,
        optionIds: optionIdsFor(line.selectedModifiers),
        priceOverride: line.priceOverride,
        priceOverrideReason: line.priceOverrideReason,
      });
    }
  }
  return delta;
}

export interface CartSnapshot {
  lines: CartLine[];
  customer: Customer | null;
  table: DiningTable | null;
  guests: number | null;
  orderType: OrderType;
  discount: Discount | null;
  resumedOrderId: string | null;
  /** When the cart is attached to an open tab, that tab's local order id. */
  tabOrderId?: string | null;
  tabOpenedAt?: string | null;
  fireMode?: LocalOrder['fireMode'];
  /**
   * Fire times for lines already sent to the kitchen, keyed by `lineKey`.
   * The cart itself doesn't track firing — this carries the tab's existing
   * state through a rebuild so saving an edit can't un-fire the starters.
   */
  firedAtByLine?: Record<string, string | null>;
}

/** Snapshot the cart into a LocalOrder (caller decides held vs pending_sync). */
export function buildLocalOrder(
  snapshot: CartSnapshot,
  taxRateBps: number,
  overrides?: Partial<LocalOrder>,
): LocalOrder {
  const {
    lines,
    customer,
    table,
    guests,
    orderType,
    discount,
    resumedOrderId,
    tabOrderId,
    tabOpenedAt,
    fireMode,
    firedAtByLine,
  } = snapshot;
  const t = cartTotals(lines, discount, taxRateBps);
  return {
    id: tabOrderId ?? resumedOrderId ?? newId(),
    serverId: null,
    ticketNumber: null,
    status: 'held',
    items: lines.map((l) => ({
      lineId: l.id,
      menuItemId: l.product.id,
      name: l.product.name,
      unitPrice: l.product.price,
      quantity: l.quantity,
      notes: l.notes,
      course: l.course,
      firedAt: firedAtByLine?.[l.id] ?? null,
      modifiers: l.selectedModifiers,
      priceOverride: l.priceOverride,
      priceOverrideReason: l.priceOverrideReason,
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
    tipAmount: 0,
    serviceChargeAmount: 0,
    loyaltyPointsRedeemed: 0,
    specialInstructions: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    syncedAt: null,
    tabOpenedAt: tabOpenedAt ?? null,
    fireMode: fireMode ?? 'all',
    businessDayId: null,
    ...overrides,
  };
}

// ── Split checks ──────────────────────────────────────────────────────────────

/**
 * Divide cart lines into N checks per an explicit assignment (which checks
 * each line belongs to, by index). A line assigned to more than one check has
 * its quantity divided across them — largest-remainder so nothing is lost to
 * rounding — so a shared appetizer can be split across two checks while a
 * plate ordered for one person stays whole on one check. When there are fewer
 * physical units than checks sharing them (a single dessert split three ways),
 * there's no whole unit to hand anyone, so the COST is split evenly instead via
 * a price override — the alternative (giving the whole item to one check and
 * nothing to the others) would silently make one check pay for the rest.
 *
 * Lines with no assignment (or an assignment matching no check) land on the
 * first check so nothing silently disappears from the bill.
 */
export function splitLines(
  lines: CartLine[],
  assignment: Record<string, boolean[]>,
  checkCount: number,
): CartLine[][] {
  const groups: CartLine[][] = Array.from({ length: checkCount }, () => []);

  for (const line of lines) {
    const flags = assignment[line.id];
    const selected = flags
      ? flags.map((on, i) => (on ? i : -1)).filter((i) => i >= 0)
      : [];
    if (selected.length === 0) {
      groups[0].push(line);
      continue;
    }
    const n = selected.length;
    const base = Math.floor(line.quantity / n);
    if (base === 0) {
      // Fewer physical units than checks sharing them (e.g. one appetizer split
      // three ways) — there's no whole unit to hand any check, so split the
      // COST evenly instead via a price override rather than letting the
      // shortfall silently assign the whole thing to one check for free.
      const totalCost = lineUnitPrice(line) * line.quantity;
      const share = Math.floor(totalCost / n);
      const costRemainder = totalCost - share * n;
      selected.forEach((checkIndex, i) => {
        groups[checkIndex].push({
          ...line,
          // A fragment is its own order line on its own check.
          id: newLineId(),
          quantity: 1,
          priceOverride: share + (i < costRemainder ? 1 : 0),
          priceOverrideReason: 'Split check share',
        });
      });
      continue;
    }
    const remainder = line.quantity - base * n;
    selected.forEach((checkIndex, i) => {
      const quantity = base + (i < remainder ? 1 : 0);
      if (quantity > 0)
        groups[checkIndex].push({ ...line, id: newLineId(), quantity });
    });
  }
  return groups;
}
