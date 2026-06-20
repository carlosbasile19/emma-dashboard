import type { RangePreset } from "@/lib/types";

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
