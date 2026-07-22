import * as mutationsRepo from './mutationsRepo';
import * as ordersRepo from './ordersRepo';
import type { Course, LocalOrder, PaymentMethod } from '../types';

/**
 * Open-tab lifecycle. Every one of these writes the local order row AND queues
 * the matching outbox mutation in the same call, so the two can't drift — the
 * register never shows a tab the server will not eventually hear about.
 */

/** Seat a party: save the tab locally and queue its create. */
export function openTab(order: LocalOrder): LocalOrder {
  const tab: LocalOrder = {
    ...order,
    status: 'open_tab',
    // No payment method — this is what keeps paidAt null server-side, which is
    // what keeps the table reading as occupied on every other register.
    paymentMethod: null,
    tabOpenedAt: order.tabOpenedAt ?? new Date().toISOString(),
  };
  ordersRepo.saveOrder(tab);
  mutationsRepo.enqueue(tab.id, 'create', {});
  return tab;
}

/**
 * Add items to an open tab. `delta` is what the cart gained since the tab was
 * loaded; the full merged order is saved locally for display while only the
 * delta is queued, so a concurrent append from another register survives.
 */
export function appendToTab(
  merged: LocalOrder,
  delta: {
    menuItemId: string;
    quantity: number;
    notes?: string;
    course?: Course;
    optionIds?: string[];
  }[],
): void {
  ordersRepo.saveOrder({ ...merged, status: 'open_tab' });
  if (delta.length > 0) {
    mutationsRepo.enqueue(merged.id, 'append', { items: delta });
  }
}

/** Close out a tab: record the tender locally and queue the settle. */
export function settleTab(
  merged: LocalOrder,
  delta: {
    menuItemId: string;
    quantity: number;
    notes?: string;
    course?: Course;
    optionIds?: string[];
  }[],
  payment: {
    paymentMethod: PaymentMethod;
    tenderedAmount?: number | null;
    changeAmount?: number | null;
    tipAmount?: number;
  },
): void {
  ordersRepo.saveOrder({
    ...merged,
    status: 'pending_sync',
    paymentMethod: payment.paymentMethod,
    tenderedAmount: payment.tenderedAmount ?? null,
    changeAmount: payment.changeAmount ?? null,
  });
  // Any last-round items must reach the server before the tender does, or the
  // settle prices a tab that is missing lines. The outbox is FIFO, so ordering
  // these two enqueues correctly is the whole guarantee.
  if (delta.length > 0) {
    mutationsRepo.enqueue(merged.id, 'append', { items: delta });
  }
  mutationsRepo.enqueue(merged.id, 'settle', {
    paymentMethod: payment.paymentMethod,
    tipAmount: payment.tipAmount,
  });
}

/**
 * Send a course to the kitchen. Stamps the local lines so the tab detail shows
 * them fired immediately — even offline — and queues the mutation that makes
 * it real. The server is the one that actually prints; a double-tap is
 * absorbed there by the mutation id.
 */
export function fireCourse(order: LocalOrder, course: Course): void {
  const firedAt = new Date().toISOString();
  const items = order.items.map((i) =>
    i.course === course && !i.firedAt ? { ...i, firedAt } : i,
  );
  ordersRepo.saveOrder({ ...order, items });
  mutationsRepo.enqueue(order.id, 'fire', { course });
}

/** Courses on this tab that still have unfired lines, in serving order. */
export function unfiredCourses(order: LocalOrder): Course[] {
  const pending = new Set<Course>();
  for (const item of order.items) {
    if (item.course && !item.firedAt) pending.add(item.course);
  }
  return [...pending].sort((a, b) => a - b);
}

export function listOpenTabs(): LocalOrder[] {
  return ordersRepo.listOpenTabs();
}

export function findOpenTabForTable(tableId: string): LocalOrder | null {
  return ordersRepo.findOpenTabForTable(tableId);
}
