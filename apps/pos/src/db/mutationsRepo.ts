import { db } from './database';
import { newId } from '../utils/ids';
import type { MutationKind, OrderMutation } from '../types';

interface MutationRow {
  id: string;
  order_id: string;
  kind: string;
  payload_json: string;
  created_at: string;
  attempts: number;
  last_error: string | null;
}

function toMutation(row: MutationRow): OrderMutation {
  let payload: unknown = {};
  try {
    payload = JSON.parse(row.payload_json) as unknown;
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    orderId: row.order_id,
    kind: row.kind as MutationKind,
    payload,
    createdAt: row.created_at,
    attempts: row.attempts,
    lastError: row.last_error,
  };
}

/**
 * Queue an operation for the sync engine. The returned id doubles as the
 * server-side idempotency key (clientMutationId) for appends, so a retry after
 * a dropped response is a no-op rather than a double-add.
 */
export function enqueue(
  orderId: string,
  kind: MutationKind,
  payload: unknown,
): string {
  const id = newId();
  db.runSync(
    `INSERT INTO order_mutations(id, order_id, kind, payload_json, created_at, attempts)
     VALUES(?, ?, ?, ?, ?, 0)`,
    [id, orderId, kind, JSON.stringify(payload), new Date().toISOString()],
  );
  return id;
}

/** Everything still owed to the server, oldest first (global FIFO). */
export function listPending(): OrderMutation[] {
  return db
    .getAllSync<MutationRow>(
      'SELECT * FROM order_mutations ORDER BY created_at ASC, rowid ASC',
    )
    .map(toMutation);
}

/** Distinct orders with work outstanding — the sidebar's "pending" badge. */
export function countPendingOrders(): number {
  const row = db.getFirstSync<{ n: number }>(
    'SELECT COUNT(DISTINCT order_id) AS n FROM order_mutations WHERE last_error IS NULL',
  );
  return row?.n ?? 0;
}

export function countFailed(): number {
  const row = db.getFirstSync<{ n: number }>(
    'SELECT COUNT(DISTINCT order_id) AS n FROM order_mutations WHERE last_error IS NOT NULL',
  );
  return row?.n ?? 0;
}

/** Done — the server has it. */
export function remove(id: string): void {
  db.runSync('DELETE FROM order_mutations WHERE id = ?', [id]);
}

/** Park a mutation the server actively rejected (4xx) for operator review. */
export function markFailed(id: string, message: string): void {
  db.runSync(
    'UPDATE order_mutations SET last_error = ?, attempts = attempts + 1 WHERE id = ?',
    [message, id],
  );
}

/** Count an attempt that failed for transport reasons; stays queued. */
export function bumpAttempts(id: string): void {
  db.runSync(
    'UPDATE order_mutations SET attempts = attempts + 1 WHERE id = ?',
    [id],
  );
}

/** Clear the error so a parked mutation is picked up by the next run. */
export function requeueForOrder(orderId: string): void {
  db.runSync(
    'UPDATE order_mutations SET last_error = NULL WHERE order_id = ?',
    [orderId],
  );
}

export function removeForOrder(orderId: string): void {
  db.runSync('DELETE FROM order_mutations WHERE order_id = ?', [orderId]);
}
