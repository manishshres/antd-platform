/**
 * Single source of truth for order statuses and their legal transitions (N1).
 *
 * Previously this was duplicated: `orders.service.ts` used `completed` as the terminal
 * status while the aggregator (`order-status-transition.service.ts`) used `delivered`,
 * and the `orders_status_check` DB constraint allowed only the latter. Any
 * `ready → completed` transition therefore violated the constraint and 500'd.
 *
 * `completed` is canonical — it is what the dashboard's status label/colour maps and the
 * POS understand. Migration `0027` rewrites legacy `delivered` rows and the constraint.
 * Anything role-, DB- or transition-related must reference these constants.
 */

/** Canonical status set — must stay in sync with the `orders_status_check` constraint. */
export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'completed',
  'cancelled',
  'refunded',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Allowed transitions. Anything not listed here is illegal.
 *
 * `completed → refunded` is legal at the domain level, but it must go through the refund
 * flow (which writes the reversing `payments` rows) — see `MANUAL_ORDER_STATUSES` for what
 * the plain status endpoint is permitted to set.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'preparing', 'cancelled'],
  confirmed: ['preparing', 'cancelled', 'refunded'],
  preparing: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: ['refunded'],
  cancelled: [], // terminal
  refunded: [], // terminal
};

/**
 * Statuses a client may set directly via `PATCH /orders/:id/status`.
 *
 * `refunded` is deliberately excluded: reaching it through the status endpoint would move
 * the order without creating the negative `payments` rows, silently desyncing reported
 * revenue from the payments ledger. Refunds go through the refund endpoint.
 */
export const MANUAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'completed',
  'cancelled',
];

export function canTransitionOrderStatus(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
