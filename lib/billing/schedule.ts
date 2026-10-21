/**
 * The billing calendar — pure, no I/O, no `server-only`.
 *
 * Every date here is a `YYYY-MM-DD` string in the CLIENT's own timezone and every month a
 * `YYYY-MM`; both compare lexicographically, so there is no Date arithmetic on the hot path and
 * no process timezone can leak in. The only place a Date meets a timezone is `localDate`.
 */
import { shiftDay, type MonthKey } from "@/lib/usage";

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

/**
 * Whether to send the "no card on file" alert for `month`. `runBilling` walks due months oldest
 * first, so alerting only on a month newer than the last alerted one gives one alert per client
 * per newly-due month, and none on repeat runs.
 */
export function shouldAlertNoCard(month: MonthKey, alertedMonth: MonthKey | null): boolean {
  return alertedMonth == null || month > alertedMonth;
}

export interface ReenableArgs {
  wasEnabled: boolean;
  nowEnabled: boolean;
  storedBillFrom: MonthKey | null;
  submittedBillFrom: MonthKey | null;
  currentMonth: MonthKey;
}

/**
 * Re-enabling a client with its old (past) bill-from month unchanged would back-charge every month
 * billing was off. True means the admin must pick the bill-from month explicitly before saving.
 */
export function reenableNeedsBillFrom({
  wasEnabled,
  nowEnabled,
  storedBillFrom,
  submittedBillFrom,
  currentMonth,
}: ReenableArgs): boolean {
  return (
    !wasEnabled &&
    nowEnabled &&
    submittedBillFrom != null &&
    submittedBillFrom === storedBillFrom &&
    submittedBillFrom < currentMonth
  );
}

// ---- Stream A: AI Power Credits, weekly ----
// A credits period is a run of whole, closed days in the client's timezone. The regular period is
// Monday–Sunday, charged on the first run on or after the following Monday; a low-balance early
// charge closes a period mid-week, and the next period starts the day after it. Periods are
// contiguous by construction: each starts at the "cursor", the day after the last billed one.

export interface DayPeriod {
  from: string;
  to: string;
}

/** 0 = Monday … 6 = Sunday, for a `YYYY-MM-DD`. */
export function isoWeekday(ymd: string): number {
  return (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The Monday on or before `ymd`. */
export function weekStart(ymd: string): string {
  return shiftDay(ymd, -isoWeekday(ymd));
}

/** The first Monday strictly after `ymd`. */
export function nextMonday(ymd: string): string {
  return shiftDay(weekStart(ymd), 7);
}

/** The first Monday on or after `ymd`: the regular credits charge date. */
export function creditsChargeDate(today: string): string {
  return isoWeekday(today) === 0 ? today : nextMonday(today);
}

/**
 * The closed credits weeks owed right now, oldest first, each clipped to start at the cursor.
 * A week is closed once its Sunday is before `today`. Catch-up after a missed run or a late
 * enable yields one period per week, never one giant invoice.
 */
export function dueCreditPeriods(today: string, cursor: string): DayPeriod[] {
  const lastClosedSunday = shiftDay(weekStart(today), -1);
  const out: DayPeriod[] = [];
  for (let from = cursor; from <= lastClosedSunday; ) {
    const sunday = shiftDay(weekStart(from), 6);
    out.push({ from, to: sunday });
    from = shiftDay(sunday, 1);
  }
  return out;
}

/**
 * The period a low-balance early charge bills: cursor → yesterday. Only whole closed days are
 * billable (today's usage is still accruing), so `null` when no closed day is unbilled.
 */
export function earlyCreditPeriod(today: string, cursor: string): DayPeriod | null {
  const yesterday = shiftDay(today, -1);
  return cursor <= yesterday ? { from: cursor, to: yesterday } : null;
}

/**
 * Whether unbilled usage has crossed the client's threshold. `null` usage (could not be loaded)
 * never triggers; a 0 / null threshold is off.
 */
export function thresholdCrossed(unbilledCents: number | null, thresholdCents: number | null): boolean {
  return thresholdCents != null && thresholdCents > 0 && unbilledCents != null && unbilledCents >= thresholdCents;
}

/** The first unbilled day: the day after the latest billed period, else the bill-from month's 1st. */
export function creditsCursor(billFromMonth: MonthKey, billedPeriodEnds: Iterable<string>): string {
  let cursor = `${billFromMonth}-01`;
  for (const to of billedPeriodEnds) {
    const next = shiftDay(to, 1);
    if (next > cursor) cursor = next;
  }
  return cursor;
}

// ---- Stream B: monthly service fee, in advance ----

/**
 * The service-fee months owed right now, oldest first. Charged IN ADVANCE: the current month is
 * due once the anchor day has passed; earlier months from bill-from on (catch-up) are due at once.
 */
export function dueFeeMonths({ today, anchorDay, billFromMonth, invoicedMonths }: DueArgs): MonthKey[] {
  const current = monthOf(today);
  const done = new Set(invoicedMonths);
  const anchorPassed = dayOfMonth(today) >= anchorDay;
  return monthRange(billFromMonth, current).filter((m) => !done.has(m) && (m < current || anchorPassed));
}

/** Months the admin may charge the fee for right now (bill-from → current month, not yet invoiced). */
export function chargeableFeeMonths(today: string, billFromMonth: MonthKey, invoicedMonths: Iterable<MonthKey>): MonthKey[] {
  const done = new Set(invoicedMonths);
  return monthRange(billFromMonth, monthOf(today)).filter((m) => !done.has(m));
}

// ---- Retry → suspension ----

/**
 * A failed charge is retried once, this long after the failure, before the client is suspended.
 * 20h (not 24h) so the next daily 03:00 UTC run always picks the retry up.
 */
export const RETRY_AFTER_MS = 20 * 60 * 60 * 1000;
/** Retries before suspension. */
export const MAX_RETRIES = 1;

/**
 * The next service-fee charge date: the current month's anchor day while that month is unbilled
 * (today, if the anchor has passed — the next run charges it), else next month's anchor day.
 */
export function nextFeeChargeDate(today: string, anchorDay: number, invoicedMonths: Iterable<MonthKey>): string {
  const current = monthOf(today);
  const day = String(anchorDay).padStart(2, "0");
  if (new Set(invoicedMonths).has(current)) return `${nextMonth(current)}-${day}`;
  return dayOfMonth(today) <= anchorDay ? `${current}-${day}` : today;
}
