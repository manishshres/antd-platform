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

/** Customer-facing receipt: itemization, totals, tender, change. */
export function buildReceiptLines(
  order: LocalOrder,
  locationName: string,
  width: number,
): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const push = (text: string, opts?: Partial<ReceiptLine>) =>
    lines.push({ text, align: 'left', ...opts });

  push(locationName || 'Receipt', { align: 'center', bold: true, size: 'double' });
  if (order.ticketNumber) {
    push(`Order #${order.ticketNumber}`, { align: 'center' });
  }
  push(new Date(order.createdAt).toLocaleString(), { align: 'center' });
  if (order.tableName) push(`Table ${order.tableName}`, { align: 'center' });
  push(rule(width));

  for (const item of order.items) {
    push(`${item.quantity} x ${item.name}`);
    if (item.modifiers?.length) {
      for (const m of item.modifiers) push(`   + ${m.name}`);
    }
    if (item.notes) push(`   * ${item.notes}`);
    push(twoCol('', money(item.unitPrice * item.quantity), width));
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

  if (order.paymentMethod) {
    push(rule(width));
    push(twoCol('Paid via', paymentMethodLabel(order.paymentMethod), width));
    if (order.tenderedAmount !== null && order.paymentMethod === 'cash') {
      push(twoCol('Tendered', money(order.tenderedAmount), width));
      push(twoCol('Change', money(order.changeAmount ?? 0), width));
    }
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
