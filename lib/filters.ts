import type { Period, RangePreset } from "@/lib/types";

const DAY = 86_400_000;
export const DEFAULT_TZ = "America/New_York";

function ymdUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseRange(v: string | string[] | undefined): RangePreset {
  return v === "7d" || v === "90d" ? v : "30d";
}

export function rangeDays(r: RangePreset): number {
  return r === "7d" ? 7 : r === "90d" ? 90 : 30;
}

/** range preset → { from, to, tz }. from/to are UTC days; window capped at 366 (guide §5). */
export function rangeToPeriod(range: RangePreset, tz: string, now: Date = new Date()) {
  const days = Math.min(366, rangeDays(range));
  const to = now;
  const from = new Date(now.getTime() - (days - 1) * DAY);
  return { from: ymdUTC(from), to: ymdUTC(to), tz: tz || DEFAULT_TZ };
}

/** The previous equal-length period (for KPI deltas). */
export function prevPeriod(range: RangePreset, tz: string, now: Date = new Date()) {
  const days = Math.min(366, rangeDays(range));
  const to = new Date(now.getTime() - days * DAY);
  const from = new Date(now.getTime() - (2 * days - 1) * DAY);
  return { from: ymdUTC(from), to: ymdUTC(to), tz: tz || DEFAULT_TZ };
}

// ---- Brief Emma window ----
// The "Brief Emma" modal carries its own date filter (an Olivia-style segmented control),
// independent of the dashboard's ?range= so re-scoping the brief never reflows the KPI cards.
// "week" = this calendar week so far (Mon → today); "30d"/"90d" reuse the rolling presets;
// "custom" = an arbitrary from–to span (validated + clamped to 366 days, like every period).
export type BriefWindow =
  | { kind: "week" }
  | { kind: "30d" }
  | { kind: "90d" }
  | { kind: "custom"; from: string; to: string };

export type BriefWindowKind = BriefWindow["kind"];

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Monday of the week containing `now`, as a UTC day (matches the rest of this module's UTC math). */
function startOfWeekUTC(now: Date): Date {
  const sinceMonday = (now.getUTCDay() + 6) % 7; // getUTCDay: 0=Sun..6=Sat
  return new Date(now.getTime() - sinceMonday * DAY);
}

/** Resolve a brief window into a { from, to, tz } period. Custom dates are normalised + clamped. */
export function briefWindowToPeriod(w: BriefWindow, tz: string, now: Date = new Date()): Period {
  const zone = tz || DEFAULT_TZ;
  if (w.kind === "week") {
    return { from: ymdUTC(startOfWeekUTC(now)), to: ymdUTC(now), tz: zone };
  }
  if (w.kind === "custom") {
    if (!YMD_RE.test(w.from) || !YMD_RE.test(w.to)) {
      throw new Error("Invalid custom range — expected YYYY-MM-DD from/to.");
    }
    // Tolerate a reversed range, then cap the span at 366 days (guide §5).
    const to = w.from <= w.to ? w.to : w.from;
    let from = w.from <= w.to ? w.from : w.to;
    if ((Date.parse(to) - Date.parse(from)) / DAY > 365) {
      from = ymdUTC(new Date(Date.parse(to) - 365 * DAY));
    }
    return { from, to, tz: zone };
  }
  return rangeToPeriod(w.kind, zone, now); // "30d" | "90d"
}

/** YYYY-MM-DD → "Jun 25" (UTC, so it matches the day the period was built from). */
export function formatDayLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ymd
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Human label for a brief window (shown in the modal header + the live "Preview · …" pill). */
export function briefWindowLabel(w: BriefWindow): string {
  switch (w.kind) {
    case "week":
      return "This week";
    case "30d":
      return "Last 30 days";
    case "90d":
      return "Last 90 days";
    case "custom":
      return `${formatDayLabel(w.from)} – ${formatDayLabel(w.to)}`;
  }
}

export function parsePage(v: string | string[] | undefined): number {
  const n = Number(typeof v === "string" ? v : "1");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export function parseLimit(v: string | string[] | undefined, def = 25): number {
  const n = Number(typeof v === "string" ? v : String(def));
  if (!Number.isFinite(n)) return def;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

export function str(v: string | string[] | undefined, def: string): string {
  return typeof v === "string" ? v : def;
}
