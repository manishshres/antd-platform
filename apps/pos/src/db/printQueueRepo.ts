import { db } from './database';
import { newId } from '../utils/ids';
import type { OrderPrintStatus, PrintJob, PrintJobStatus } from '../types';
import type { ReceiptLine } from '../printing/receiptFormatter';

interface JobRow {
  id: string;
  order_id: string;
  station_name: string;
  target: string;
  lines_json: string;
  status: PrintJobStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function toJob(row: JobRow): PrintJob {
  return {
    id: row.id,
    orderId: row.order_id,
    stationName: row.station_name,
    target: row.target,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function enqueue(input: {
  orderId: string;
  stationName: string;
  target: string;
  lines: ReceiptLine[];
}): PrintJob {
  const now = new Date().toISOString();
  const id = newId();
  db.runSync(
    `INSERT INTO print_jobs
       (id, order_id, station_name, target, lines_json, status, attempts, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', 0, NULL, ?, ?)`,
    [id, input.orderId, input.stationName, input.target, JSON.stringify(input.lines), now, now],
  );
  return {
    id,
    orderId: input.orderId,
    stationName: input.stationName,
    target: input.target,
    status: 'queued',
    attempts: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** The rendered ticket to replay. Null if the row vanished or can't be parsed. */
export function linesFor(jobId: string): ReceiptLine[] | null {
  const row = db.getFirstSync<{ lines_json: string }>(
    'SELECT lines_json FROM print_jobs WHERE id = ?',
    [jobId],
  );
  if (!row) return null;
  try {
    return JSON.parse(row.lines_json) as ReceiptLine[];
  } catch {
    return null;
  }
}

/** Jobs eligible for a print attempt, oldest first. */
export function claimable(): PrintJob[] {
  return db
    .getAllSync<JobRow>(
      `SELECT * FROM print_jobs
        WHERE status IN ('queued', 'failed')
        ORDER BY created_at ASC`,
    )
    .map(toJob);
}

export function markStatus(
  jobId: string,
  status: PrintJobStatus,
  opts?: { incrementAttempts?: boolean; error?: string | null },
): void {
  const now = new Date().toISOString();
  db.runSync(
    `UPDATE print_jobs
        SET status = ?,
            attempts = attempts + ?,
            last_error = ?,
            updated_at = ?
      WHERE id = ?`,
    [status, opts?.incrementAttempts ? 1 : 0, opts?.error ?? null, now, jobId],
  );
}

/**
 * A job left mid-flight when the app died. Nothing is actually printing after a
 * cold start, so anything still marked 'printing' is stranded and has to become
 * retryable again — otherwise the ticket is lost with no trace in the UI.
 */
export function recoverStranded(): number {
  const now = new Date().toISOString();
  const res = db.runSync(
    `UPDATE print_jobs
        SET status = 'failed',
            last_error = 'Interrupted — the app closed mid-print.',
            updated_at = ?
      WHERE status = 'printing'`,
    [now],
  );
  return res.changes ?? 0;
}

export function listForOrder(orderId: string): PrintJob[] {
  return db
    .getAllSync<JobRow>(
      'SELECT * FROM print_jobs WHERE order_id = ? ORDER BY created_at ASC',
      [orderId],
    )
    .map(toJob);
}

export function failedCount(): number {
  const row = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM print_jobs WHERE status = 'failed'",
  );
  return row?.n ?? 0;
}

/** Worst-case roll-up: one failed station makes the whole order failed, because
 *  that is the state the expeditor needs to see. */
export function statusForOrder(orderId: string): OrderPrintStatus {
  const jobs = listForOrder(orderId);
  if (jobs.length === 0) return 'none';
  if (jobs.some((j) => j.status === 'failed')) return 'failed';
  if (jobs.some((j) => j.status === 'printing')) return 'printing';
  if (jobs.some((j) => j.status === 'queued')) return 'queued';
  return 'printed';
}

/** Roll-ups for many orders in one pass — the Orders list would otherwise run a
 *  query per row. */
export function statusesForOrders(
  orderIds: string[],
): Record<string, OrderPrintStatus> {
  if (orderIds.length === 0) return {};
  const placeholders = orderIds.map(() => '?').join(',');
  const rows = db.getAllSync<{ order_id: string; status: PrintJobStatus }>(
    `SELECT order_id, status FROM print_jobs WHERE order_id IN (${placeholders})`,
    orderIds,
  );
  const byOrder: Record<string, PrintJobStatus[]> = {};
  for (const r of rows) (byOrder[r.order_id] ??= []).push(r.status);

  const out: Record<string, OrderPrintStatus> = {};
  for (const id of orderIds) {
    const statuses = byOrder[id];
    if (!statuses?.length) {
      out[id] = 'none';
    } else if (statuses.includes('failed')) {
      out[id] = 'failed';
    } else if (statuses.includes('printing')) {
      out[id] = 'printing';
    } else if (statuses.includes('queued')) {
      out[id] = 'queued';
    } else {
      out[id] = 'printed';
    }
  }
  return out;
}

/** Put a finished-but-failed job back in line for a manual reprint. */
export function requeue(jobId: string): void {
  markStatus(jobId, 'queued', { error: null });
}

export function requeueAllFailed(): number {
  const now = new Date().toISOString();
  const res = db.runSync(
    `UPDATE print_jobs SET status = 'queued', last_error = NULL, updated_at = ?
      WHERE status = 'failed'`,
    [now],
  );
  return res.changes ?? 0;
}
