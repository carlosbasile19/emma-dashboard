/**
 * Usage & billing maths — pure, no I/O, no `server-only`, so it is unit-testable end to end
 * (`npm run test:usage`).
 *
 * The agency invoices on calendar months while upstream reports on a 15th–14th cycle, so every
 * figure here is derived by re-slicing daily spend onto whatever window the agency asked for.
 * Two rules run through the whole module because this feeds invoices:
 *
 *   1. Money is integer cents until the final format. No float arithmetic, ever.
 *   2. "Could not load" is never the same value as "zero". A silent 0 under-invoices with no
 *      signal, so unavailable data stays `null` all the way to the renderer.
 *
 * Dates are `YYYY-MM-DD` strings and compared lexicographically, which is ordinal for that
 * format — no Date objects in the hot paths, so no timezone can creep into the arithmetic.
 * The timezone that matters (which client's day a call lands on) is applied upstream by the
 * API via `tz`; by the time rows reach this module the bucketing is already decided.
 */

const DAY = 86_400_000;

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** One tz-local day of billed spend, straight from `/timeseries.series[]`. */
export interface DailySpend {
  date: string; // YYYY-MM-DD
  spendCents: number;
}

/** `YYYY-MM`. */
export type MonthKey = string;

export interface DateWindow {
  from: string;
  to: string;
}

/**
 * One figure in the report. `unavailable` (fetch failed) and `before-open` (the workspace did
 * not exist yet) are deliberately distinct from `{ value, cents: 0 }` — rendering either as
 * $0.00 would read as "billed nothing" when the truth is "we don't know" / "not a customer yet".
 */
export type UsageCell =
  | { kind: "value"; cents: number }
  | { kind: "unavailable" }
  | { kind: "before-open" };

/** Order a possibly-reversed pair. Search params are user input; tolerate rather than throw. */
function ordered(from: string, to: string): [string, string] {
  return from <= to ? [from, to] : [to, from];
}

/** Every calendar month touched by the span, ascending. These are the history matrix columns. */
export function monthsBetween(from: string, to: string): MonthKey[] {
  const [a, b] = ordered(from, to);
  const endY = Number(b.slice(0, 4));
  const endM = Number(b.slice(5, 7));
  const out: MonthKey[] = [];
  let y = Number(a.slice(0, 4));
  let m = Number(a.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** `2026-07` → the inclusive window to ask upstream for. Handles month length and leap years. */
export function monthBounds(month: MonthKey): DateWindow {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  // Day 0 of the FOLLOWING month is the last day of this one — correct for Feb in leap years.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/** `2026-07` → `Jul 2026`. */
export function monthLabel(month: MonthKey): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/**
 * The month you invoice on the 1st: the last one that has actually closed. Never the current
 * month, which is still accruing.
 */
export function lastCompleteMonth(today: string): MonthKey {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7)) - 1;
  if (m < 1) {
    m = 12;
    y--;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Spend across an inclusive window. Both endpoints count — a month's last day is billable. */
export function sumRange(daily: DailySpend[], from: string, to: string): number {
  const [a, b] = ordered(from, to);
  let total = 0;
  for (const d of daily) {
    if (d.date >= a && d.date <= b) total += d.spendCents;
  }
  return total;
}

/** Daily rows → `{ "2026-07": cents }`. Totals reconcile exactly to the sum of the input. */
export function bucketByMonth(daily: DailySpend[]): Record<MonthKey, number> {
  const out: Record<MonthKey, number> = {};
  for (const d of daily) {
    const m = d.date.slice(0, 7);
    out[m] = (out[m] ?? 0) + d.spendCents;
  }
  return out;
}

/** `null` in → `unavailable` out. The one place that guarantees a failure can't become a zero. */
export function cell(cents: number | null): UsageCell {
  return cents == null ? { kind: "unavailable" } : { kind: "value", cents };
}

/**
 * One client's row of the history matrix.
 *
 * `daily === null` means the fetch failed — every month is `unavailable`, never 0.
 * `openedMonth` blanks the months before the workspace existed; pass `null` when the opening
 * date is unknown, which must show the real data rather than hide it.
 */
export function monthTotals(
  daily: DailySpend[] | null,
  months: MonthKey[],
  openedMonth: MonthKey | null,
): UsageCell[] {
  if (daily == null) return months.map(() => ({ kind: "unavailable" }));
  const buckets = bucketByMonth(daily);
  return months.map((m) =>
    openedMonth && m < openedMonth
      ? { kind: "before-open" }
      : { kind: "value", cents: buckets[m] ?? 0 },
  );
}

/** Integer cents → `"666.52"`. Formatted by division, never accumulated as a float. */
export function centsToUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Split a span into windows on calendar-year boundaries.
 *
 * Upstream rejects anything over 366 days (`400 date_range_too_large`), and a year is at most
 * 366 days, so year-aligned chunks always fit. Aligning on 1 Jan rather than rolling back 366
 * days from today also keeps each closed year's cache key stable — a rolling window would mint
 * a fresh key every day and never reuse a cached year.
 */
export function yearChunks(from: string, to: string): DateWindow[] {
  const [a, b] = ordered(from, to);
  const startY = Number(a.slice(0, 4));
  const endY = Number(b.slice(0, 4));
  const out: DateWindow[] = [];
  for (let y = startY; y <= endY; y++) {
    out.push({
      from: y === startY ? a : `${y}-01-01`,
      to: y === endY ? b : `${y}-12-31`,
    });
  }
  return out;
}

/** Inclusive day count of a window — used for cap assertions and "N days" copy. */
export function windowDays({ from, to }: DateWindow): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY + 1;
}

// ---- CSV ----
// This file lands in a spreadsheet that drives invoicing, so encoding is defensive:
// a client name is user-controlled data and must never be evaluated as a formula.

/** Leading characters Excel/Sheets treat as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
/** A plain number — must stay numeric, so a negative amount isn't turned into text. */
const NUMERIC = /^-?\d+(\.\d+)?$/;
/** RFC 4180: these force quoting. */
const NEEDS_QUOTE = /[",\r\n]/;

export function csvCell(value: string): string {
  let v = value;
  if (FORMULA_LEAD.test(v) && !NUMERIC.test(v)) v = `'${v}`;
  return NEEDS_QUOTE.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function csvRow(values: string[]): string {
  return values.map(csvCell).join(",");
}

/** Header + data rows, CRLF-separated per RFC 4180. No totals row: it breaks SUM() and pivots. */
export function toCsv(headers: string[], rows: string[][]): string {
  return [csvRow(headers), ...rows.map(csvRow)].join("\r\n");
}
