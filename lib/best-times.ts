// Pure helpers for the "Best times to call" 7×24 heatmap. The API grid's row index is
// day-of-week with 0 = SUNDAY; the UI displays Mon→Sun (matching the calendar grid), so
// every read goes through apiRowForDisplay. `null` cells mean NO DATA — they must render
// as neutral/empty, never as "0% pickup".

export const HEATMAP_DAYS_MON_FIRST = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Display row (0=Mon..6=Sun) → API row (0=Sun..6=Sat). */
export function apiRowForDisplay(displayRow: number): number {
  return (displayRow + 1) % 7;
}

/**
 * Fill alpha for a likelihood 0..1 — a sequential single-hue ramp (violet), with a floor
 * so a genuine 0% cell stays visibly "data present" (distinct from the no-data neutral).
 */
export function cellAlpha(value: number): number {
  const v = Math.min(1, Math.max(0, value));
  return 0.08 + 0.74 * v;
}

/**
 * Cell opacity from the per-cell sample size (spec: ∝ min(1, calls/5)), floored so a
 * 1-call cell is faint but still perceptible. No sample info → fully opaque.
 */
export function cellOpacity(calls: number | undefined): number {
  if (calls === undefined) return 1;
  return Math.max(0.15, Math.min(1, calls / 5));
}

/** "13" → "1pm"-style compact hour label shown every 3 hours on the x axis. */
export function hourLabel(hour: number): string {
  if (hour === 0) return "12am";
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return "12pm";
  return `${hour - 12}pm`;
}

/** Tooltip line for a cell; null value → the explicit no-data message. */
export function cellTitle(
  day: string,
  hour: number,
  value: number | null,
  calls: number | undefined,
): string {
  if (value == null) return `${day} ${hourLabel(hour)} — no data`;
  const pct = `${Math.round(value * 100)}% pickup`;
  return calls === undefined
    ? `${day} ${hourLabel(hour)} — ${pct}`
    : `${day} ${hourLabel(hour)} — ${pct} · ${calls} ${calls === 1 ? "call" : "calls"}`;
}
