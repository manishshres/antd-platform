import { formatMoney } from '../utils/money';
import { paymentMethodLabel, type LocalOrder, type LocalOrderItem } from '../types';

/** One line of receipt text plus how it should be rendered on an ESC/POS printer. */
export interface ReceiptLine {
  text: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  size?: 'normal' | 'double';
}

function money(cents: number): string {
  return formatMoney(cents);
}

/** Right-pad/truncate a label and right-align a value within `width` columns. */
function twoCol(label: string, value: string, width: number): string {
  const gap = Math.max(1, width - label.length - value.length);
  const truncatedLabel =
    label.length + value.length + 1 > width
      ? label.slice(0, Math.max(0, width - value.length - 1))
      : label;
  return `${truncatedLabel}${' '.repeat(Math.max(1, width - truncatedLabel.length - value.length))}${value}`;
}

function rule(width: number, char = '-'): string {
  return char.repeat(width);
}

/** Where the order was sold — printed as the receipt header. */
export interface BusinessInfo {
  /** Trading name of the business, e.g. "Ekta Indian Cuisine". */
  organizationName?: string | null;
  /** Branch, e.g. "Manayunk". Shown under the business name when they differ. */
  locationName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  phoneNumber?: string | null;
}

/** "391 Lyceum Ave" / "Philadelphia, PA 19128" — blank parts dropped, not left as gaps. */
function addressLines(business: BusinessInfo): string[] {
  const lines: string[] = [];
  if (business.address) lines.push(business.address);

  const cityState = [business.city, business.state].filter(Boolean).join(', ');
  const locality = [cityState, business.postalCode].filter(Boolean).join(' ');
  if (locality) lines.push(locality);

  return lines;
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: 'DINE IN',
  pickup: 'PICKUP',
  delivery: 'DELIVERY',
};

/** Customer-facing receipt: itemization, totals, tender, change. */
export function buildReceiptLines(
  order: LocalOrder,
  business: BusinessInfo | string,
  width: number,
): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const push = (text: string, opts?: Partial<ReceiptLine>) =>
    lines.push({ text, align: 'left', ...opts });

  // Callers used to pass a bare location name; keep that working rather than break
  // every print site at once.
  const info: BusinessInfo =
    typeof business === 'string' ? { locationName: business } : business;

  // ── Who sold it ──
  const heading = info.organizationName || info.locationName || 'Receipt';
  push(heading, { align: 'center', bold: true, size: 'double' });
  // Only worth a second line when the branch adds information the heading lacks.
  if (info.locationName && info.locationName !== heading) {
    push(info.locationName, { align: 'center' });
  }
  for (const line of addressLines(info)) push(line, { align: 'center' });
  if (info.phoneNumber) push(info.phoneNumber, { align: 'center' });

  push(rule(width));

  // ── What kind of order ──
  push(ORDER_TYPE_LABELS[order.orderType] ?? order.orderType.toUpperCase(), {
    align: 'center',
    bold: true,
  });
  if (order.ticketNumber) {
    push(`Order #${order.ticketNumber}`, { align: 'center' });
  }
  push(new Date(order.createdAt).toLocaleString(), { align: 'center' });
  if (order.tableName) push(`Table ${order.tableName}`, { align: 'center' });

  // ── Who ordered it ──
  // "Walk-in" is the placeholder for an anonymous counter sale; printing it back at the
  // customer is noise, so only a real name earns a line.
  const hasCustomer =
    (order.customerName && order.customerName !== 'Walk-in') || order.customerPhone;
  if (hasCustomer) {
    push(rule(width));
    if (order.customerName && order.customerName !== 'Walk-in') {
      push(order.customerName);
    }
    if (order.customerPhone) push(order.customerPhone);
  }

  push(rule(width));

  for (const item of order.items) {
    // Price sits on the item's own line, the way a till receipt reads. twoCol truncates
    // the label when a long name would collide with the amount, so the column stays put.
    push(
      twoCol(
        `${item.quantity} x ${item.name}`,
        money(item.unitPrice * item.quantity),
        width,
      ),
    );
    if (item.modifiers?.length) {
      for (const m of item.modifiers) push(`   + ${m.name}`);
    }
    if (item.notes) push(`   * ${item.notes}`);
  }

  push(rule(width));
  push(twoCol('Subtotal', money(order.subtotal), width));
  if (order.discountAmount > 0) {
    push(twoCol(order.discountName ? `Discount (${order.discountName})` : 'Discount', `-${money(order.discountAmount)}`, width));
  }
  if (order.serviceChargeAmount > 0) {
    push(twoCol('Service Charge', money(order.serviceChargeAmount), width));
  }
  push(twoCol('Tax', money(order.taxAmount), width));
  if (order.tipAmount > 0) {
    push(twoCol('Tip', money(order.tipAmount), width));
  }
  if (order.loyaltyPointsRedeemed > 0) {
    push(twoCol('Loyalty Redeemed', `-${money(order.loyaltyPointsRedeemed)}`, width));
  }
  push(rule(width));
  push(
    twoCol('Total', money(order.totalAmount + order.tipAmount - order.loyaltyPointsRedeemed), width),
    { bold: true },
  );

  // ── Settled or not ──
  // An unpaid ticket printed for a delivery driver or a tab looked identical to a paid
  // one: the tender block was simply absent, which reads as "nothing to see" rather than
  // "money still owed". Say it either way.
  push(rule(width));
  if (order.paymentMethod) {
    push('*** PAID ***', { align: 'center', bold: true });
    push(twoCol('Paid via', paymentMethodLabel(order.paymentMethod), width));
    if (order.tenderedAmount !== null && order.paymentMethod === 'cash') {
      push(twoCol('Tendered', money(order.tenderedAmount), width));
      push(twoCol('Change', money(order.changeAmount ?? 0), width));
    }
  } else {
    push('*** NOT PAID ***', { align: 'center', bold: true, size: 'double' });
    push(
      twoCol(
        'Balance Due',
        money(order.totalAmount + order.tipAmount - order.loyaltyPointsRedeemed),
        width,
      ),
      { bold: true },
    );
  }

  push(rule(width));
  push('Thank you!', { align: 'center' });
  return lines;
}

export interface KitchenTicketOptions {
  /** Print only this subset of the order's items (station routing) instead of order.items. */
  items?: LocalOrderItem[];
  /** Kitchen station this ticket is for, e.g. "Grill" — printed as its own header line. */
  stationName?: string;
  /** Restaurant/location name — printed above the table/order-type line. */
  businessName?: string;
  /** Employee who entered the order, if known. */
  employeeName?: string | null;
}

/** Kitchen ticket: no prices, just what to make — bigger text, one course fired at a time. */
export function buildKitchenTicketLines(
  order: LocalOrder,
  width: number,
  opts?: KitchenTicketOptions,
): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const push = (text: string, lineOpts?: Partial<ReceiptLine>) =>
    lines.push({ text, align: 'left', ...lineOpts });

  if (opts?.businessName) push(opts.businessName, { align: 'center', bold: true });
  push(order.tableName ? `TABLE ${order.tableName}` : order.orderType.toUpperCase(), {
    align: 'center',
    bold: true,
    size: 'double',
  });
  if (opts?.stationName) {
    push(`STATION: ${opts.stationName.toUpperCase()}`, { align: 'center', bold: true });
  }
  if (order.ticketNumber) push(`Order #${order.ticketNumber}`, { align: 'center' });
  if (order.customerName && order.customerName !== 'Walk-in') {
    push(order.customerName, { align: 'center' });
  }
  push(new Date(order.createdAt).toLocaleTimeString(), { align: 'center' });
  push(rule(width));

  const items = opts?.items ?? order.items;
  for (const item of items) {
    push(`${item.quantity} x ${item.name}`, { bold: true, size: 'double' });
    if (item.modifiers?.length) {
      for (const m of item.modifiers) push(`   + ${m.name}`);
    }
    if (item.notes) push(`   * ${item.notes}`);
  }

  if (order.specialInstructions) {
    push(rule(width));
    push(`NOTE: ${order.specialInstructions}`);
  }

  push(rule(width));
  push(`Printed ${new Date().toLocaleTimeString()}`);
  if (opts?.employeeName) push(`Server: ${opts.employeeName}`);
  return lines;
}
