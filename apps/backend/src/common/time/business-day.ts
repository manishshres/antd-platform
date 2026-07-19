/**
 * Business-day boundary helpers.
 *
 * Reports, "today" summaries, and daily ticket-number resets must bucket by the
 * *location's* business day, not the server's local day. A UTC-hosted server
 * running `new Date().setHours(0,0,0,0)` computes midnight UTC, which for a NY
 * restaurant lands at 8 PM local — so late-evening orders leak into the next
 * day's numbers and ticket counters reset mid-service (P2-008 / P2-009).
 *
 * These helpers take an IANA timezone (e.g. `America/New_York`, from
 * `locations.timezone`) and return the UTC `Date` instants that bound a wall-
 * clock day in that zone. Implemented with `Intl.DateTimeFormat` so no extra
 * dependency is needed.
 */

/** Fallback when a location has no timezone set. Matches the schema default. */
export const DEFAULT_TIMEZONE = 'America/New_York';

interface CalendarDay {
  year: number;
  month: number; // 1-based
  day: number;
}

/**
 * The offset in milliseconds such that `utcInstant + offset` equals the wall-
 * clock time shown in `timeZone` at that instant. EDT (UTC-4) → -14_400_000.
 */
function tzOffsetMs(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  // Compare at whole-second granularity: formatToParts has no millisecond field,
  // so the sub-second part of `at` must be dropped or it leaks into the offset.
  const atWholeSeconds = Math.floor(at.getTime() / 1000) * 1000;
  const parts = dtf.formatToParts(new Date(atWholeSeconds));
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  // `hour` can come back as 24 at midnight in some engines; normalise to 0.
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUtc = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    hour,
    map.minute,
    map.second,
  );
  return asUtc - atWholeSeconds;
}

/** The calendar day (Y/M/D) that `input` falls on, read in `timeZone`. */
function calendarDayInZone(
  input: Date | string,
  timeZone: string,
): CalendarDay {
  if (typeof input === 'string') {
    // A bare date string ("2026-07-19") is already a calendar day — parse it
    // directly rather than through `new Date()`, which would apply the server's
    // zone and can shift the day.
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
    if (m) {
      return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    }
  }
  const at = typeof input === 'string' ? new Date(input) : input;
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(at)) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  return { year: map.year, month: map.month, day: map.day };
}

/** UTC instant of a wall-clock moment in `timeZone`, resolving DST via two passes. */
function zonedWallClockToUtc(
  day: CalendarDay,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timeZone: string,
): Date {
  const naiveUtc = Date.UTC(
    day.year,
    day.month - 1,
    day.day,
    hour,
    minute,
    second,
    ms,
  );
  // First approximation using the offset at the naive instant, then refine once
  // so DST transitions land on the correct side.
  const firstOffset = tzOffsetMs(timeZone, new Date(naiveUtc));
  const refinedOffset = tzOffsetMs(timeZone, new Date(naiveUtc - firstOffset));
  return new Date(naiveUtc - refinedOffset);
}

/**
 * Start of `input`'s business day (00:00:00.000 local) as a UTC `Date`.
 * `input` may be a `YYYY-MM-DD` string or a `Date`; `Date` inputs are resolved
 * to their calendar day in `timeZone` first.
 */
export function startOfBusinessDay(
  input: Date | string,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const day = calendarDayInZone(input, timeZone);
  return zonedWallClockToUtc(day, 0, 0, 0, 0, timeZone);
}

/** End of `input`'s business day (23:59:59.999 local) as a UTC `Date`. */
export function endOfBusinessDay(
  input: Date | string,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const day = calendarDayInZone(input, timeZone);
  return zonedWallClockToUtc(day, 23, 59, 59, 999, timeZone);
}
