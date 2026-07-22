import { db } from './database';
import { newId } from '../utils/ids';
import type { BusinessDay } from '../types';

interface BusinessDayRow {
  id: string;
  date: string;
  opened_at: string;
  closed_at: string | null;
  opened_by: string;
  closed_by: string | null;
}

function toBusinessDay(row: BusinessDayRow): BusinessDay {
  return {
    id: row.id,
    date: row.date,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    openedBy: row.opened_by,
    closedBy: row.closed_by,
  };
}

/** Returns the currently open business day, or null if no day is open. */
export function getOpenDay(): BusinessDay | null {
  const row = db.getFirstSync<BusinessDayRow>(
    `SELECT * FROM business_days WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1`,
  );
  return row ? toBusinessDay(row) : null;
}

/** Today's date label in YYYY-MM-DD format (local time). */
function todayLabel(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Open a new business day. Throws if a day is already open. */
export function startDay(openedBy: string): BusinessDay {
  const existing = getOpenDay();
  if (existing) {
    throw new Error(`A business day is already open (${existing.date}). Close it first.`);
  }

  const today = todayLabel();

  // Check if there is already a closed business day for today
  const recentClosed = db.getFirstSync<BusinessDayRow>(
    `SELECT * FROM business_days WHERE date = ? ORDER BY opened_at DESC LIMIT 1`,
    [today]
  );

  if (recentClosed) {
    // Reopen it
    db.runSync(
      `UPDATE business_days SET closed_at = NULL, closed_by = NULL WHERE id = ?`,
      [recentClosed.id]
    );
    return {
      ...toBusinessDay(recentClosed),
      closedAt: null,
      closedBy: null,
    };
  }

  const day: BusinessDay = {
    id: newId(),
    date: today,
    openedAt: new Date().toISOString(),
    closedAt: null,
    openedBy,
    closedBy: null,
  };
  db.runSync(
    `INSERT INTO business_days(id, date, opened_at, opened_by)
     VALUES(?, ?, ?, ?)`,
    [day.id, day.date, day.openedAt, day.openedBy],
  );
  return day;
}

/** Close the currently open business day. Returns the closed day or null if not found. */
export function endDay(id: string, closedBy: string): BusinessDay | null {
  const open = getOpenDay();
  if (!open || open.id !== id) return null;
  const closedAt = new Date().toISOString();
  db.runSync(
    `UPDATE business_days SET closed_at = ?, closed_by = ? WHERE id = ?`,
    [closedAt, closedBy, id],
  );
  return {
    ...open,
    closedAt,
    closedBy,
  };
}

/** List recent business days, newest first. */
export function listRecentDays(limit = 14): BusinessDay[] {
  return db
    .getAllSync<BusinessDayRow>(
      `SELECT * FROM business_days ORDER BY opened_at DESC LIMIT ?`,
      [limit],
    )
    .map(toBusinessDay);
}
