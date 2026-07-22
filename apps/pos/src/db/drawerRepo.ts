import { db } from './database';
import { newId } from '../utils/ids';
import type { DrawerSession, LocalOrder } from '../types';

interface SessionRow {
  id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  cash_sales: number;
  other_sales: number;
  expected_amount: number | null;
  counted_amount: number | null;
  difference: number | null;
  remarks: string | null;
}

function toSession(row: SessionRow): DrawerSession {
  return {
    id: row.id,
    status: row.status as DrawerSession['status'],
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    openingAmount: row.opening_amount,
    cashSales: row.cash_sales,
    otherSales: row.other_sales,
    expectedAmount: row.expected_amount,
    countedAmount: row.counted_amount,
    difference: row.difference,
    remarks: row.remarks,
  };
}

export function getOpenSession(): DrawerSession | null {
  const row = db.getFirstSync<SessionRow>(
    `SELECT * FROM drawer_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1`,
  );
  return row ? toSession(row) : null;
}

export function openSession(openingAmount: number): DrawerSession {
  const session: DrawerSession = {
    id: newId(),
    status: 'open',
    openedAt: new Date().toISOString(),
    closedAt: null,
    openingAmount,
    cashSales: 0,
    otherSales: 0,
    expectedAmount: null,
    countedAmount: null,
    difference: null,
    remarks: null,
  };
  db.runSync(
    `INSERT INTO drawer_sessions(id, status, opened_at, opening_amount)
     VALUES(?, 'open', ?, ?)`,
    [session.id, session.openedAt, session.openingAmount],
  );
  return session;
}

/**
 * Cash vs non-cash takings for paid orders placed since `sinceIso`.
 * Paid = anything that went through the payment flow (queued, synced, or
 * failed-but-collected); held orders haven't been paid yet.
 */
export function salesSince(sinceIso: string): { cashSales: number; otherSales: number } {
  const row = db.getFirstSync<{ cash: number | null; other: number | null }>(
    `SELECT
       SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END) AS cash,
       SUM(CASE WHEN payment_method != 'cash' THEN total_amount ELSE 0 END) AS other
     FROM orders
     WHERE status IN ('pending_sync', 'synced', 'failed')
       AND payment_method IS NOT NULL
       AND created_at >= ?`,
    [sinceIso],
  );
  return { cashSales: row?.cash ?? 0, otherSales: row?.other ?? 0 };
}

/**
 * Cash vs non-cash takings for a whole business day, keyed by
 * orders.business_day_id rather than a timestamp. A drawer session only
 * spans one open→close cash-custody window, but a business day can span
 * several (End Day, then Start Day again the same day starts a fresh drawer
 * session) — scoping "today's sales" to the current session's openedAt, as
 * salesSince() does, silently drops every order placed before a reopen.
 */
export function salesForBusinessDay(businessDayId: string): { cashSales: number; otherSales: number } {
  const row = db.getFirstSync<{ cash: number | null; other: number | null }>(
    `SELECT
       SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END) AS cash,
       SUM(CASE WHEN payment_method != 'cash' THEN total_amount ELSE 0 END) AS other
     FROM orders
     WHERE status IN ('pending_sync', 'synced', 'failed')
       AND payment_method IS NOT NULL
       AND business_day_id = ?`,
    [businessDayId],
  );
  return { cashSales: row?.cash ?? 0, otherSales: row?.other ?? 0 };
}

/** Close the open session, snapshotting sales and the counted-vs-expected difference. */
export function closeSession(
  id: string,
  countedAmount: number,
  remarks: string | null,
): DrawerSession | null {
  const open = getOpenSession();
  if (!open || open.id !== id) return null;
  const { cashSales, otherSales } = salesSince(open.openedAt);
  const expectedAmount = open.openingAmount + cashSales;
  const difference = countedAmount - expectedAmount;
  const closedAt = new Date().toISOString();
  db.runSync(
    `UPDATE drawer_sessions SET
       status = 'closed', closed_at = ?, cash_sales = ?, other_sales = ?,
       expected_amount = ?, counted_amount = ?, difference = ?, remarks = ?
     WHERE id = ?`,
    [closedAt, cashSales, otherSales, expectedAmount, countedAmount, difference, remarks, id],
  );
  return {
    ...open,
    status: 'closed',
    closedAt,
    cashSales,
    otherSales,
    expectedAmount,
    countedAmount,
    difference,
    remarks,
  };
}

export function listClosedSessions(limit = 30): DrawerSession[] {
  return db
    .getAllSync<SessionRow>(
      `SELECT * FROM drawer_sessions WHERE status = 'closed'
       ORDER BY closed_at DESC LIMIT ?`,
      [limit],
    )
    .map(toSession);
}

interface PaidOrderRow {
  id: string;
  ticket_number: number | null;
  customer_name: string;
  total_amount: number;
  payment_method: string | null;
  created_at: string;
}

export interface PaidOrderSummary {
  id: string;
  ticketNumber: number | null;
  customerName: string;
  totalAmount: number;
  paymentMethod: LocalOrder['paymentMethod'];
  createdAt: string;
}

/** Paid orders since `sinceIso`, newest first — the drawer's sale history. */
export function paidOrdersSince(sinceIso: string): PaidOrderSummary[] {
  return db
    .getAllSync<PaidOrderRow>(
      `SELECT id, ticket_number, customer_name, total_amount, payment_method, created_at
       FROM orders
       WHERE status IN ('pending_sync', 'synced', 'failed')
         AND payment_method IS NOT NULL
         AND created_at >= ?
       ORDER BY created_at DESC`,
      [sinceIso],
    )
    .map((r) => ({
      id: r.id,
      ticketNumber: r.ticket_number,
      customerName: r.customer_name,
      totalAmount: r.total_amount,
      paymentMethod: r.payment_method as LocalOrder['paymentMethod'],
      createdAt: r.created_at,
    }));
}

/** Paid orders for a whole business day (see salesForBusinessDay for why). */
export function paidOrdersForBusinessDay(businessDayId: string): PaidOrderSummary[] {
  return db
    .getAllSync<PaidOrderRow>(
      `SELECT id, ticket_number, customer_name, total_amount, payment_method, created_at
       FROM orders
       WHERE status IN ('pending_sync', 'synced', 'failed')
         AND payment_method IS NOT NULL
         AND business_day_id = ?
       ORDER BY created_at DESC`,
      [businessDayId],
    )
    .map((r) => ({
      id: r.id,
      ticketNumber: r.ticket_number,
      customerName: r.customer_name,
      totalAmount: r.total_amount,
      paymentMethod: r.payment_method as LocalOrder['paymentMethod'],
      createdAt: r.created_at,
    }));
}
