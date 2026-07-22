// Builds overview KPI cards from domain objects. Used by Phase 2 (sample) and Phase 6
// (live) identically — only the inputs change.

import { CHART_PALETTE } from "@/lib/design";
import { centsToMoney, num, secToMMSS } from "@/lib/format";
import {
  describeBooked,
  describeChase,
  describeConverted,
  describeNew,
} from "@/lib/narrate";
import type { Campaign, Lead, Overview, Timeseries } from "@/lib/types";

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

// ---- Brief Emma ----
export type BriefCategory = "bookings" | "leads" | "campaigns";

export interface BriefItem {
  id: string;
  category: BriefCategory;
  title: string;
  sub: string;
  tag: string;
  color: string;
  /** Conversational context lines — who's motivated, who's hesitating and why. */
  detail?: string[];
}

/**
 * Builds the "to brief" list from real workspace data for the active period. `leads` is the
 * window-scoped lead list (best-effort, first page) — when present it powers the per-lead
 * motivation/hesitation detail lines; the stage counts stay authoritative for the titles.
 */
export function buildBriefItems(
  ov: Overview,
  campaigns: Campaign[],
  leads: Lead[] = [],
): BriefItem[] {
  const k = ov.kpis;
  const s = k.leads_by_stage;
  const items: BriefItem[] = [];
  const withDetail = (item: BriefItem, detail: string[]): BriefItem =>
    detail.length > 0 ? { ...item, detail } : item;

  const booked = s.booked ?? 0;
  if (booked > 0) {
    items.push(
      withDetail(
        {
          id: "bookings",
          category: "bookings",
          title: `${num(booked)} appointment${booked === 1 ? "" : "s"} to confirm`,
          sub: booked === 1 ? "One lead has locked in a visit." : "These leads have locked in a visit.",
          tag: "Bookings",
          color: "#E8A33D",
        },
        describeBooked(leads),
      ),
    );
  }

  const fresh = s.new ?? 0;
  if (fresh > 0) {
    items.push(
      withDetail(
        {
          id: "new",
          category: "leads",
          title: `${num(fresh)} new lead${fresh === 1 ? "" : "s"} to work`,
          sub: fresh === 1 ? "Nobody's spoken to this one yet." : "Nobody's spoken to these yet.",
          tag: "New",
          color: "#2E86F2",
        },
        describeNew(leads),
      ),
    );
  }

  const chase = (s.contacted ?? 0) + (s.qualified ?? 0);
  if (chase > 0) {
    items.push(
      withDetail(
        {
          id: "chase",
          category: "leads",
          title: `${num(chase)} lead${chase === 1 ? "" : "s"} to chase`,
          sub: "Emma's already talking to them and keeping each thread going.",
          tag: "Leads",
          color: "#6D4AFF",
        },
        describeChase(leads),
      ),
    );
  }

  const converted = k.converted_count ?? 0;
  if (converted > 0) {
    items.push(
      withDetail(
        {
          id: "converted",
          category: "leads",
          title: `${num(converted)} lead${converted === 1 ? "" : "s"} converted`,
          sub: converted === 1 ? "A win this period." : "Wins this period.",
          tag: "Converted",
          color: "#2BB673",
        },
        describeConverted(leads),
      ),
    );
  }

  for (const c of campaigns.filter((c) => c.status === "active").slice(0, 3)) {
    items.push({
      id: `cmp-${c.id}`,
      category: "campaigns",
      title: c.name,
      sub: `Pulled ${num(c.replies)} repl${c.replies === 1 ? "y" : "ies"} so far and turned ${c.appointments_booked === 0 ? "none" : num(c.appointments_booked)} into booked appointment${c.appointments_booked === 1 ? "" : "s"}.`,
      tag: "Campaign",
      color: "#2E86F2",
    });
  }

  return items;
}
