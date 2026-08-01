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

/**
 * Display money, exact to the cent.
 *
 * `centsToMoney()` in lib/format rounds to whole dollars — right for a KPI card, wrong here:
 * $666.52 would render as $667 and a month of those would not reconcile against an invoice.
 *
 * Grouping is applied to the dollar part as an integer, so no float ever touches the value.
 * A non-USD amount carries its currency code rather than rendering as a bare number, because
 * an unlabelled figure on a billing screen is a number waiting to be misread.
 */
export function centsToMoneyExact(cents: number, currency = "usd"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const amount = `${dollars}.${String(abs % 100).padStart(2, "0")}`;
  return currency.toLowerCase() === "usd"
    ? `${sign}$${amount}`
    : `${sign}${amount} ${currency.toUpperCase()}`;
}

/**
 * Does an upstream response actually cover the window we asked for?
 *
 * `cachedFetch` falls back to the CLOSEST cached window (up to 7 days old) when upstream fails
 * and the exact key is cold — correct for a KPI card, wrong for an invoice, where it would show
 * one month's spend under another month's heading. Every analytics response echoes the period it
 * served, so the caller can verify rather than assume.
 *
 * `tz` is part of the check: the same from/to on a different timezone is a different set of
 * days, and up to ~10% different money.
 *
 * An absent or empty period is unverifiable and therefore untrusted — never optimistically
 * accepted, because the failure mode of a wrong "yes" here is a wrong invoice.
 */
export function seriesMatchesWindow(
  period: { from?: string; to?: string; tz?: string } | undefined | null,
  want: { from: string; to: string; tz: string },
): boolean {
  if (!period) return false;
  return period.from === want.from && period.to === want.to && period.tz === want.tz;
}

/** Inclusive day count of a window — used for cap assertions and "N days" copy. */
export function windowDays({ from, to }: DateWindow): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY + 1;
}

/** Move a `YYYY-MM-DD` by whole days, crossing months, years and leap days correctly. */
export function shiftDay(ymd: string, deltaDays: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + deltaDays * DAY).toISOString().slice(0, 10);
}

/**
 * Widen a requested window by one day at each end.
 *
 * Upstream filters `from`/`to` on **UTC** days but labels `/timeseries` buckets on the client's
 * **timezone** (guide §8). The two disagree at the edges: Brisbane's 1 July begins at 30 June
 * 14:00 UTC, so asking for `from=2026-07-01` returns a 2026-07-01 bucket missing everything
 * before UTC midnight — measured live at $11.39 short on a $677.91 month.
 *
 * IANA offsets span UTC-12 to UTC+14, so a single day of padding always covers the overhang in
 * either direction. The padding days come back as extra buckets; they are simply outside the
 * window anything is reported for.
 */
export function padWindow({ from, to }: DateWindow): DateWindow {
  return { from: shiftDay(from, -1), to: shiftDay(to, 1) };
}

/**
 * Collapse duplicate dates by SUMMING, ascending.
 *
 * Year-aligned chunks are contiguous in UTC, but a local day straddles the boundary: Brisbane's
 * 2026-01-01 starts at 2025-12-31 14:00 UTC, so it arrives as two partial rows, one per chunk.
 * Taking either row alone loses a day's money; summing reconstructs it.
 */
export function mergeDaily(rows: DailySpend[]): DailySpend[] {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.date, (totals.get(r.date) ?? 0) + r.spendCents);
  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, spendCents]) => ({ date, spendCents }));
}

// ---- Period selection ----

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

/** How far back a custom range may reach. Guards against a URL that would fan out into
 *  a hundred year-chunks per client — this page is admin-only, but a typo shouldn't
 *  become an outage. */
const MAX_HISTORY_YEARS = 5;

export interface UsagePeriod {
  from: string;
  to: string;
  /** Set when the period is exactly one calendar month, so the picker can highlight it. */
  month: MonthKey | null;
  label: string;
}

/** `2026-07-01` → `1 Jul 2026`. Year always shown: a billing report can span years. */
export function dayLabel(ymd: string): string {
  const d = Number(ymd.slice(8, 10));
  return `${d} ${MONTH_NAMES[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;
}

/**
 * Turn search params into the window to report on.
 *
 * Defaults to the last CLOSED calendar month — the one being invoiced on the 1st, never the
 * current month, which is still accruing. Anything unparseable falls back to that default
 * rather than throwing: a broken URL should show the sensible period, not an error page.
 */
export function resolveUsagePeriod(
  params: { month?: string; from?: string; to?: string },
  today: string,
): UsagePeriod {
  const asMonth = (m: MonthKey): UsagePeriod => {
    const { from, to } = monthBounds(m);
    return { from, to, month: m, label: monthLabel(m) };
  };

  if (params.month && YM.test(params.month)) return asMonth(params.month);

  if (params.from && params.to && YMD.test(params.from) && YMD.test(params.to)) {
    const [rawFrom, to] = ordered(params.from, params.to);
    const floor = `${Number(today.slice(0, 4)) - MAX_HISTORY_YEARS}${today.slice(4)}`;
    const from = rawFrom < floor ? floor : rawFrom;
    // A span that is exactly one calendar month IS that month — keeps a shared URL's pill
    // highlighted and the CSV's period column consistent.
    const asMonthKey = from.slice(0, 7);
    const bounds = monthBounds(asMonthKey);
    if (bounds.from === from && bounds.to === to) return asMonth(asMonthKey);
    return { from, to, month: null, label: `${dayLabel(from)} – ${dayLabel(to)}` };
  }

  return asMonth(lastCompleteMonth(today));
}

/**
 * The span to fetch so BOTH blocks are correct from one pass.
 *
 * It reaches back to the earliest workspace opening (or further, if a custom range asks for it)
 * and forward to at least today. That forward bound matters: tying the span to the selected
 * period drops later months from the history matrix, which made a row's visible columns
 * disagree with its own lifetime total. A month-to-date period keeps its future-dated end.
 */
export function reportSpan(
  period: DateWindow,
  openings: string[],
  today: string,
): DateWindow {
  const from = [period.from, ...openings].sort()[0] ?? period.from;
  return { from, to: period.to > today ? period.to : today };
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

/** Both exports share these columns, so a period file and a history file stack in one sheet. */
export const USAGE_CSV_HEADERS = [
  "client_name",
  "client_id",
  "period",
  "from",
  "to",
  "timezone",
  "currency",
  "basis",
  "spend_usd",
] as const;

export interface UsageCsvRow {
  clientName: string;
  clientId: string;
  /** `2026-07` for a history row, `2026-07-01..2026-07-31` for a period row. */
  period: string;
  from: string;
  to: string;
  tz: string;
  currency: string;
  basis: string;
  /** `null` when the figure could not be loaded — exports EMPTY, never `0.00`. */
  cents: number | null;
}

/**
 * The billing export.
 *
 * An unloadable client still gets a row (so nobody assumes they were simply absent) but with an
 * empty amount. Writing 0.00 there would be a number someone bills against.
 */
/** One rendered line of the report: the selected period plus that client's month history. */
export interface UsageRow {
  id: string;
  name: string;
  tz: string;
  periodCents: number | null;
  monthCells: UsageCell[];
  /** Lifetime across the loaded history; null when the client failed to load. */
  lifetimeCents: number | null;
}

interface CsvMeta {
  currency: string;
  basis: string;
}

/** "This period" export: one row per client, including clients whose data failed to load. */
export function periodCsvRows(
  rows: UsageRow[],
  period: UsagePeriod,
  meta: CsvMeta,
): UsageCsvRow[] {
  return rows.map((r) => ({
    clientName: r.name,
    clientId: r.id,
    period: `${period.from}..${period.to}`,
    from: period.from,
    to: period.to,
    tz: r.tz,
    currency: meta.currency,
    basis: meta.basis,
    cents: r.periodCents,
  }));
}

/**
 * "All history" export: one row per client per month, each carrying that month's own bounds.
 *
 * Months before a workspace opened produce NO row — an empty row would imply a billable period
 * that did not exist. Unavailable months DO produce a row with an empty amount, so a gap is
 * visible in the file rather than silently absent.
 */
export function historyCsvRows(
  rows: UsageRow[],
  months: MonthKey[],
  meta: CsvMeta,
): UsageCsvRow[] {
  return rows.flatMap((r) =>
    months.flatMap((month, i): UsageCsvRow[] => {
      const cell = r.monthCells[i];
      if (!cell || cell.kind === "before-open") return [];
      const { from, to } = monthBounds(month);
      return [
        {
          clientName: r.name,
          clientId: r.id,
          period: month,
          from,
          to,
          tz: r.tz,
          currency: meta.currency,
          basis: meta.basis,
          cents: cell.kind === "value" ? cell.cents : null,
        },
      ];
    }),
  );
}

export function usageCsv(rows: UsageCsvRow[]): string {
  return toCsv(
    [...USAGE_CSV_HEADERS],
    rows.map((r) => [
      r.clientName,
      r.clientId,
      r.period,
      r.from,
      r.to,
      r.tz,
      r.currency,
      r.basis,
      r.cents == null ? "" : centsToUsd(r.cents),
    ]),
  );
}
