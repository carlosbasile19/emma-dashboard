import "server-only";
import { requireAdmin } from "@/lib/auth";
import {
  mergeDaily,
  monthsBetween,
  monthTotals,
  padWindow,
  seriesMatchesWindow,
  sumRange,
  yearChunks,
  type DailySpend,
  type MonthKey,
  type UsageCell,
} from "@/lib/usage";
import * as api from "./api";
import { listAgencyClients, type AgencyClient } from "./agency";
import { cachedFetch, TIERS } from "./cache";

/**
 * Billed usage per client, sliced onto whatever window the agency invoices on.
 *
 * Everything here is behind `requireAdmin()` — this is the agency's billing view, not a
 * client-facing surface — and client ids come from the agency mirror, never from the browser.
 *
 * The rule that shapes this module: **a failure is `null`, never `0`.** A billing report that
 * renders an unreachable client as $0.00 under-invoices with no signal, so every path that can
 * fail returns null and the renderer shows "—" plus a named warning.
 */

/**
 * The ONE place that knows where billed usage comes from.
 *
 * Today: `/timeseries.series[].spend_cents` — the same figure `/overview` reports as
 * `spend.total_cents` with `basis: "billed_voice"` (verified: July daily rows sum to exactly the
 * overview total). It is billed voice/call spend; TTS is bundled in, and no LLM/SMS split is
 * exposed on the per-client tree.
 *
 * When `OLIVIA_AGENCY_ID` is issued, `GET /agencies/{agencyId}/clients` becomes reachable — it
 * accepts `from`/`to`/`tz`/`client_id` and reports the fuller usage figure plus flat maintenance.
 * Swapping to it means changing `fetchDaily` and this constant; nothing above this file moves,
 * because `basis` travels with the data all the way to the screen and the CSV.
 */
const SOURCE_BASIS = "billed_voice";
const SOURCE_CURRENCY = "usd";

export interface UsageSeries {
  /** Daily rows, ascending, bucketed on the client's own timezone. */
  daily: DailySpend[];
  basis: string;
  currency: string;
}

/** One client's usage, or `null` when it could not be loaded. Never a zero-filled stand-in. */
export interface ClientUsage {
  client: AgencyClient;
  /** The timezone the day-buckets were computed on — shown per row so a figure is never ambiguous. */
  tz: string;
  series: UsageSeries | null;
}

export interface UsageReport {
  clients: ClientUsage[];
  /** Names of clients whose usage failed to load — surfaced, never swallowed. */
  failed: string[];
  basis: string;
  currency: string;
  /** Every month from the earliest workspace opening through the report window. */
  months: MonthKey[];
}

/**
 * Each client's own timezone decides which day a call lands on, and therefore which calendar
 * month it is billed in. This is deliberately NOT the console's `DEFAULT_TZ`: an agency-wide
 * timezone would put a Sydney client's late-month calls in the wrong month relative to what that
 * client sees in their own dashboard. Falls back to UTC only when upstream has no timezone at
 * all — a neutral, explicit choice rather than an accidental one.
 */
export function billingTz(client: AgencyClient): string {
  return client.timezone?.trim() || "UTC";
}

/**
 * One ≤366-day window of daily spend.
 *
 * Returns `null` rather than throwing so one bad chunk can be reported instead of blanking the
 * whole report — and rather than `[]`, which `sumRange` would happily total to a confident $0.00.
 */
async function fetchDaily(
  clientId: string,
  tz: string,
  from: string,
  to: string,
): Promise<DailySpend[] | null> {
  const params = { from, to, tz };
  try {
    const res = await cachedFetch({
      clientId,
      // Namespaced away from the dashboard's `timeseries` rows on purpose: the cross-window
      // fallback picks the closest cached window within an endpoint, and a billing read must
      // only ever fall back onto other billing reads.
      endpoint: "usage-timeseries",
      params,
      tier: TIERS.usage,
      fetcher: () => api.getTimeseries(clientId, params),
    });
    // The cache may legitimately hand back a DIFFERENT window (stale-on-error falls back to the
    // closest one it holds). Harmless on a KPI card; on an invoice it would file one month's
    // spend under another. Upstream echoes the period it served, so verify instead of assuming.
    if (!seriesMatchesWindow(res.data.period, { from, to, tz })) {
      console.warn(
        "[usage] discarded a response for %s: asked %s..%s (%s), got %o",
        clientId,
        from,
        to,
        tz,
        res.data.period,
      );
      return null;
    }
    return (res.data.series ?? []).map((p) => ({
      date: p.date,
      spendCents: p.spend_cents ?? 0,
    }));
  } catch (e) {
    console.warn("[usage] timeseries failed for %s %s..%s: %s", clientId, from, to, e);
    return null;
  }
}

/**
 * One client's daily spend across an arbitrary span, stitched from year-aligned chunks so a
 * span longer than the upstream 366-day cap still resolves.
 *
 * The requested window is padded by a day at each end before fetching. Upstream filters on UTC
 * days but labels buckets on the client's timezone, so without padding the first local day of
 * the span comes back truncated — live, that put SOLVI's July at $666.52 instead of the correct
 * $677.91. See `padWindow`.
 *
 * Rows are then merged by date, because a local day straddling a year-chunk boundary arrives as
 * two partial rows that must be summed rather than deduped.
 *
 * If ANY chunk fails the whole series is `null`. A partial history would look complete and
 * under-report a month — the one outcome this report must not produce.
 */
export async function getUsageSeries(
  clientId: string,
  tz: string,
  from: string,
  to: string,
): Promise<UsageSeries | null> {
  const window = padWindow({ from, to });
  const parts = await Promise.all(
    yearChunks(window.from, window.to).map((c) => fetchDaily(clientId, tz, c.from, c.to)),
  );
  if (parts.some((p) => p === null)) return null;
  return {
    daily: mergeDaily((parts as DailySpend[][]).flat()),
    basis: SOURCE_BASIS,
    currency: SOURCE_CURRENCY,
  };
}

/** `2026-06-04T…` → `2026-06`. Null stays null: unknown opening blanks no months. */
export function openedMonth(client: AgencyClient): MonthKey | null {
  return client.openedAt ? client.openedAt.slice(0, 7) : null;
}

/**
 * The full report: every agency client's daily spend from the earliest workspace opening through
 * `to`, so both the selected period and the whole history matrix are served from one fetch per
 * client rather than one per client per month.
 *
 * `to` bounds the fetch; `from` only widens it (a custom range reaching further back than the
 * default history start must still be covered).
 */
export async function getUsageReport(from: string, to: string): Promise<UsageReport> {
  await requireAdmin();
  const clients = await listAgencyClients();

  // History starts at the earliest opening we know of; unknown openings fall back to the
  // requested window so those clients are still covered.
  const openings = clients.map((c) => c.openedAt?.slice(0, 10)).filter((d): d is string => !!d);
  const historyStart = [from, ...openings].sort()[0] ?? from;

  const results = await Promise.all(
    clients.map(async (client): Promise<ClientUsage> => {
      const tz = billingTz(client);
      return { client, tz, series: await getUsageSeries(client.id, tz, historyStart, to) };
    }),
  );

  return {
    clients: results,
    failed: results.filter((r) => r.series === null).map((r) => r.client.name),
    basis: SOURCE_BASIS,
    currency: SOURCE_CURRENCY,
    months: monthsBetween(historyStart, to),
  };
}

/** One client's spend for a window, or `null` when their data could not be loaded. */
export function periodTotal(usage: ClientUsage, from: string, to: string): number | null {
  return usage.series ? sumRange(usage.series.daily, from, to) : null;
}

/** One rendered line: the selected period plus that client's whole month history. */
export interface UsageRow {
  id: string;
  name: string;
  tz: string;
  periodCents: number | null;
  monthCells: UsageCell[];
  /** Lifetime across the loaded history; null when the client failed to load. */
  lifetimeCents: number | null;
}

/** Shared by the page and the CSV export so a downloaded file always matches the screen. */
export function buildUsageRows(
  report: UsageReport,
  period: { from: string; to: string },
): UsageRow[] {
  return report.clients.map((u) => ({
    id: u.client.id,
    name: u.client.name,
    tz: u.tz,
    periodCents: periodTotal(u, period.from, period.to),
    monthCells: monthTotals(u.series?.daily ?? null, report.months, openedMonth(u.client)),
    lifetimeCents: u.series
      ? u.series.daily.reduce((a, d) => a + d.spendCents, 0)
      : null,
  }));
}

/**
 * Per-month agency totals. A column is `null` when ANY client's figure for it is unavailable —
 * a column total that quietly omits an unreachable client is a wrong number that looks right.
 * Months before a client opened contribute nothing, which is correct rather than missing.
 */
export function columnTotals(rows: UsageRow[], months: MonthKey[]): Array<number | null> {
  return months.map((_, i) => {
    let total = 0;
    for (const row of rows) {
      const c = row.monthCells[i];
      if (!c || c.kind === "unavailable") return null;
      if (c.kind === "value") total += c.cents;
    }
    return total;
  });
}

/**
 * Agency total for a window. `null` when ANY client failed — a total that silently omits an
 * unreachable client is a wrong number presented as a right one.
 */
export function agencyTotal(report: UsageReport, from: string, to: string): number | null {
  if (report.failed.length > 0) return null;
  let total = 0;
  for (const c of report.clients) total += periodTotal(c, from, to) ?? 0;
  return total;
}
