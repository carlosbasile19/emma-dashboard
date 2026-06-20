// Builds overview KPI cards from domain objects. Used by Phase 2 (sample) and Phase 6
// (live) identically — only the inputs change.

import { CHART_PALETTE } from "@/lib/design";
import { centsToMoney, num, secToMMSS } from "@/lib/format";
import type { Overview, Timeseries } from "@/lib/types";

export interface KpiCardModel {
  key: string;
  label: string;
  value: string;
  unit: string;
  delta?: string;
  deltaColor?: string;
  color: string;
  spark?: number[];
}

const GREEN = "#2BB673";
const RED = "#E5484D";
const MUTED = "#5C6B6D";

function pctDelta(cur: number, prev: number): { text: string; up: boolean } {
  if (!prev) return { text: "—", up: true };
  const d = ((cur - prev) / prev) * 100;
  return { text: `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`, up: d >= 0 };
}

function ppDelta(cur: number, prev: number): { text: string; up: boolean } {
  const d = (cur - prev) * 100;
  return { text: `${d >= 0 ? "+" : ""}${d.toFixed(1)}pp`, up: d >= 0 };
}

/** Per-day pickup rate series (picked_up / calls), for the pickup KPI sparkline. */
function pickupSeries(ts?: Timeseries): number[] | undefined {
  if (!ts) return undefined;
  return ts.series.map((p) => (p.calls > 0 ? p.picked_up / p.calls : 0));
}

export function buildKpiCards(
  ov: Overview,
  prev?: Overview,
  ts?: Timeseries,
): KpiCardModel[] {
  const k = ov.kpis;
  const p = prev?.kpis;

  const leads = p ? pctDelta(k.leads_total, p.leads_total) : undefined;
  const calls = p ? pctDelta(k.calls_total, p.calls_total) : undefined;
  const pickup = p ? ppDelta(k.pickup_rate, p.pickup_rate) : undefined;
  const booking = p ? ppDelta(k.bookings_rate, p.bookings_rate) : undefined;
  const spendD = p ? pctDelta(k.spend.total_cents, p.spend.total_cents) : undefined;

  // Duration: lower is better, so a decrease is "good".
  let durDelta: { text: string; good: boolean } | undefined;
  if (p) {
    const diff = k.avg_call_duration_sec - p.avg_call_duration_sec;
    const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
    durDelta = { text: `${sign}${secToMMSS(Math.abs(diff))}`, good: diff <= 0 };
  }
  const convDelta = p
    ? { text: `${k.converted_count - p.converted_count >= 0 ? "+" : ""}${k.converted_count - p.converted_count}`, up: k.converted_count >= p.converted_count }
    : undefined;

  return [
    {
      key: "leads",
      label: "Total leads",
      value: num(k.leads_total),
      unit: "",
      color: CHART_PALETTE[0],
      delta: leads?.text,
      deltaColor: leads ? (leads.up ? GREEN : RED) : undefined,
    },
    {
      key: "calls",
      label: "Total calls",
      value: num(k.calls_total),
      unit: "",
      color: CHART_PALETTE[1],
      delta: calls?.text,
      deltaColor: calls ? (calls.up ? GREEN : RED) : undefined,
      spark: ts?.series.map((s) => s.calls),
    },
    {
      key: "pickup",
      label: "Pickup rate",
      value: (k.pickup_rate * 100).toFixed(1),
      unit: "%",
      color: CHART_PALETTE[2],
      delta: pickup?.text,
      deltaColor: pickup ? (pickup.up ? GREEN : RED) : undefined,
      spark: pickupSeries(ts),
    },
    {
      key: "aht",
      label: "Avg call duration",
      value: secToMMSS(k.avg_call_duration_sec),
      unit: "",
      color: CHART_PALETTE[3],
      delta: durDelta?.text,
      deltaColor: durDelta ? (durDelta.good ? GREEN : RED) : undefined,
    },
    {
      key: "booking",
      label: "Bookings rate",
      value: (k.bookings_rate * 100).toFixed(1),
      unit: "%",
      color: CHART_PALETTE[4],
      delta: booking?.text,
      deltaColor: booking ? (booking.up ? GREEN : RED) : undefined,
      spark: ts?.series.map((s) => s.bookings),
    },
    {
      key: "converted",
      label: "Converted",
      value: num(k.converted_count),
      unit: "",
      color: CHART_PALETTE[5],
      delta: convDelta?.text,
      deltaColor: convDelta ? (convDelta.up ? GREEN : RED) : undefined,
    },
    {
      key: "spend",
      label: "Billed spend",
      value: centsToMoney(k.spend.total_cents, k.spend.currency),
      unit: "",
      color: CHART_PALETTE[6],
      delta: spendD?.text,
      deltaColor: MUTED, // more/less spend isn't inherently good or bad
      spark: ts?.series.map((s) => s.spend_cents),
    },
  ];
}
