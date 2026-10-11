/**
 * The billing calendar — pure, no I/O, no `server-only`.
 *
 * Every date here is a `YYYY-MM-DD` string in the CLIENT's own timezone and every month a
 * `YYYY-MM`; both compare lexicographically, so there is no Date arithmetic on the hot path and
 * no process timezone can leak in. The only place a Date meets a timezone is `localDate`.
 */
import type { MonthKey } from "@/lib/usage";

export type { MonthKey };

/**
 * The calendar date in an IANA timezone. An unknown zone falls back to UTC rather than
 * throwing: one bad client timezone must not abort the billing run for every client.
 */
export function localDate(now: Date, tz: string): string {
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  try {
    return fmt(tz);
  } catch {
    return fmt("UTC");
  }
}

export function monthOf(ymd: string): MonthKey {
  return ymd.slice(0, 7);
}

export function dayOfMonth(ymd: string): number {
  return Number(ymd.slice(8, 10));
}

function shiftMonth(m: MonthKey, delta: number): MonthKey {
  const y = Number(m.slice(0, 4));
  const zeroBased = Number(m.slice(5, 7)) - 1 + delta;
  const yy = y + Math.floor(zeroBased / 12);
  const mm = ((zeroBased % 12) + 12) % 12 + 1;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}

export function prevMonth(m: MonthKey): MonthKey {
  return shiftMonth(m, -1);
}

export function nextMonth(m: MonthKey): MonthKey {
  return shiftMonth(m, 1);
}

/** Inclusive, ascending. Empty when `from` is after `to`. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let m = from; m <= to; m = nextMonth(m)) out.push(m);
  return out;
}

export interface DueArgs {
  /** Today in the client's timezone. */
  today: string;
  anchorDay: number;
  billFromMonth: MonthKey;
  /** Months that already have a `billing_invoices` row, in any status. */
  invoicedMonths: Iterable<MonthKey>;
}

/**
 * The months owed right now, oldest first.
 *
 * The most recent closed month waits for the anchor day so upstream usage can settle. Older
 * months (catch-up after enabling billing with an earlier bill-from, or after a missed run)
 * are past that window and are due immediately. The current month is never included.
 */
export function dueMonths({ today, anchorDay, billFromMonth, invoicedMonths }: DueArgs): MonthKey[] {
  const prev = prevMonth(monthOf(today));
  const done = new Set(invoicedMonths);
  const anchorPassed = dayOfMonth(today) >= anchorDay;
  return monthRange(billFromMonth, prev).filter((m) => !done.has(m) && (m < prev || anchorPassed));
}

/** Closed months with no row yet — the choices for an admin's "Charge now". Ignores the anchor. */
export function closedMonthsWithoutInvoice(
  today: string,
  billFromMonth: MonthKey,
  invoicedMonths: Iterable<MonthKey>,
): MonthKey[] {
  const done = new Set(invoicedMonths);
  return monthRange(billFromMonth, prevMonth(monthOf(today))).filter((m) => !done.has(m));
}

/** The first date on or after `today` whose day-of-month is the anchor day. */
export function nextChargeDate(today: string, anchorDay: number): string {
  const day = String(anchorDay).padStart(2, "0");
  const m = monthOf(today);
  return dayOfMonth(today) <= anchorDay ? `${m}-${day}` : `${nextMonth(m)}-${day}`;
}
