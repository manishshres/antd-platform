import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../../database/schema';
import {
  MANUAL_ORDER_STATUSES,
  ORDER_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  canTransitionOrderStatus,
  type OrderStatus,
} from './order-status';

/**
 * N1 regression guard. The bug was a silent drift: the transition map allowed
 * `ready → completed` while `orders_status_check` only permitted `delivered`, so the
 * transition threw a Postgres 42601 at runtime and 500'd. Nothing in CI compared the two.
 */
describe('order status constants', () => {
  /** Pull the status list straight out of the Drizzle CHECK constraint. */
  const statusesInDbConstraint = (): string[] => {
    const check = getTableConfig(schema.orders).checks.find(
      (c) => c.name === 'orders_status_check',
    );
    if (!check) throw new Error('orders_status_check constraint not found');
    const chunks = (check.value as unknown as { queryChunks: unknown[] })
      .queryChunks;
    // Literal SQL arrives as StringChunk ({ value: string[] }); columns/params as objects.
    const sqlText = chunks
      .map((chunk) => {
        const value = (chunk as { value?: unknown }).value;
        return Array.isArray(value) ? value.join('') : '';
      })
      .join('');
    return [...sqlText.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  };

  it('matches the orders_status_check DB constraint exactly', () => {
    expect(statusesInDbConstraint().sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it('only ever transitions to statuses the DB will accept', () => {
    for (const [from, targets] of Object.entries(ORDER_STATUS_TRANSITIONS)) {
      for (const to of targets) {
        expect(ORDER_STATUSES).toContain(to);
      }
      expect(ORDER_STATUSES).toContain(from);
    }
  });

  it('allows the counter-service lifecycle through to completed', () => {
    expect(canTransitionOrderStatus('pending', 'preparing')).toBe(true);
    expect(canTransitionOrderStatus('preparing', 'ready')).toBe(true);
    // The exact transition that used to violate the CHECK constraint.
    expect(canTransitionOrderStatus('ready', 'completed')).toBe(true);
  });

  it('treats cancelled and refunded as terminal', () => {
    expect(ORDER_STATUS_TRANSITIONS.cancelled).toEqual([]);
    expect(ORDER_STATUS_TRANSITIONS.refunded).toEqual([]);
  });

  it('never lets the status endpoint reach refunded directly', () => {
    // Refunds must go through the refund flow so the reversing payments rows are written.
    expect(MANUAL_ORDER_STATUSES).not.toContain<OrderStatus>('refunded');
  });
});
