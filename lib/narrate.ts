// Emma's voice: the one place that turns workspace numbers and lead lists into conversational
// sentences. Shared by the Brief Emma walkthrough and the Reporting preview so the two features
// speak the same way. Pure + client-safe — no fetching, no formatting side effects.

import { centsToMoney, num, secToMMSS } from "@/lib/format";
import type { Lead, OverviewKpis } from "@/lib/types";

/** "Maria" / "Maria and Jack" / "Maria, Jack and Ana" / "Maria, Jack and 2 more". */
export function joinNames(names: string[], max = 3): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  if (shown.length <= 1) return shown[0] ?? "";
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/**
 * A 0..1 rate as a spoken share — "about 6 in 10", not "62.3%". Bands at the edges keep it
 * honest ("nearly everyone" / "almost no one") where a tenths phrase would sound silly.
 */
export function spokenShare(rate: number): string {
  const r = Math.min(1, Math.max(0, rate));
  if (r === 0) return "no one";
  if (r < 0.05) return "almost no one";
  if (r >= 0.95) return "nearly everyone";
  const tenths = Math.min(9, Math.max(1, Math.round(r * 10)));
  return tenths === 5 ? "about half" : `about ${tenths} in 10`;
}

/**
 * Trend fragment for a 0..1 rate vs the previous period, e.g. " — up 2 points on last period".
 * Empty string when there's no previous value; "holding steady" under half a point of movement.
 */
export function pointsTrend(cur: number, prev?: number): string {
  if (prev == null) return "";
  const d = (cur - prev) * 100;
  if (Math.abs(d) < 0.5) return " — holding steady on last period";
  const size = Math.abs(d) >= 10 ? Math.round(Math.abs(d)) : Number(Math.abs(d).toFixed(1));
  return ` — ${d > 0 ? "up" : "down"} ${size} point${size === 1 ? "" : "s"} on last period`;
}

/**
 * The window's metrics in a nutshell — two or three spoken sentences for the reporting preview.
 * Numbers are woven into the sentences (counts stay exact; rates become spoken shares).
 */
export function buildNutshell(k: OverviewKpis, p?: OverviewKpis): string[] {
  const lines: string[] = [];

  if (k.calls_total === 0 && k.leads_total === 0) {
    return ["It was a quiet window — no new leads and no calls went out, so there's not much to tell."];
  }

  if (k.calls_total === 0) {
    lines.push(
      `In a nutshell: ${num(k.leads_total)} lead${k.leads_total === 1 ? "" : "s"} came in, but no calls have gone out yet this window.`,
    );
  } else {
    lines.push(
      `In a nutshell: ${num(k.leads_total)} lead${k.leads_total === 1 ? "" : "s"} came in and Emma made ${num(k.calls_total)} call${k.calls_total === 1 ? "" : "s"} — ${spokenShare(k.pickup_rate)} picked up${pointsTrend(k.pickup_rate, p?.pickup_rate)}.`,
    );
    const bookingPct = k.bookings_rate > 0 && k.bookings_rate < 0.005 ? "under 1%" : `${Math.round(k.bookings_rate * 100)}%`;
    lines.push(
      `${bookingPct} of those calls turned into bookings${pointsTrend(k.bookings_rate, p?.bookings_rate)}, and ${k.converted_count === 0 ? "none have" : `${num(k.converted_count)} lead${k.converted_count === 1 ? " has" : "s have"}`} gone all the way to converted.`,
    );
  }

  lines.push(
    `${k.calls_total > 0 ? `Calls are averaging ${secToMMSS(k.avg_call_duration_sec)}, and all` : "All"}-in billed spend for the window is ${centsToMoney(k.spend.total_cents, k.spend.currency)}.`,
  );

  return lines;
}

// ---- Per-lead motivation / hesitation lines (Brief Emma) ----
// The /leads list never carries lead-intelligence text, so the honest per-lead signal is the
// last call disposition: interested/booked → motivated; callback_requested → hesitating on
// timing; voicemail_left → unreachable; not_interested → an objection to work on. Names appear
// only when the key has PII scope; otherwise the phrases fall back to counts. `dnc` leads are
// never surfaced in brief copy.

const nameOf = (l: Lead): string | null => {
  const name = [l.first_name, l.last_name].filter(Boolean).join(" ").trim();
  return name.length ? name : null;
};

/** "Maria and Jack" when names are visible, else "3 leads" / "one lead". Redacted leads fold
 *  into the trailing "and N more" together with any names past the cap. */
function who(leads: Lead[], max = 3): string {
  const names = leads.map(nameOf).filter((n): n is string => n !== null);
  if (names.length === 0) return leads.length === 1 ? "one lead" : `${num(leads.length)} leads`;
  const shown = names.slice(0, max);
  const rest = leads.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  return joinNames(shown, max);
}

const byNewest = (a: Lead, b: Lead) => (a.created_at < b.created_at ? 1 : -1);

/** Detail lines for the "new leads" brief row. */
export function describeNew(leads: Lead[]): string[] {
  const fresh = leads.filter((l) => l.status === "new").sort(byNewest);
  if (fresh.length === 0) return [];
  return [`${capitalize(who(fresh))} just landed — Emma makes first contact next.`];
}

/**
 * Detail lines for the "leads to chase" brief row: who's motivated, and the identified reasons
 * the rest are hesitating (callback timing, voicemail, an outright objection).
 */
export function describeChase(leads: Lead[]): string[] {
  const chase = leads.filter((l) => l.status === "contacted" || l.status === "qualified");
  const bucket = (d: Lead["last_disposition"]) => chase.filter((l) => l.last_disposition === d);

  const lines: string[] = [];
  const keen = bucket("interested");
  if (keen.length > 0) {
    lines.push(
      `${capitalize(who(keen))} sounded genuinely interested on the last call — worth striking while it's warm.`,
    );
  }
  const callback = bucket("callback_requested");
  if (callback.length > 0) {
    lines.push(
      `${capitalize(who(callback))} asked to be called back — the hesitation is timing, not interest.`,
    );
  }
  const voicemail = bucket("voicemail_left");
  if (voicemail.length > 0) {
    lines.push(
      `${capitalize(who(voicemail))} keep${voicemail.length === 1 ? "s" : ""} going to voicemail — Emma is trying different times of day.`,
    );
  }
  const cold = bucket("not_interested");
  if (cold.length > 0) {
    lines.push(
      `${capitalize(who(cold))} said it's not for them right now — that's the objection to work on.`,
    );
  }
  return lines;
}

/** Detail lines for the "appointments to confirm" brief row. */
export function describeBooked(leads: Lead[]): string[] {
  const booked = leads.filter((l) => l.status === "booked").sort(byNewest);
  if (booked.length === 0) return [];
  return [`${capitalize(who(booked))} picked a time — a quick confirmation keeps the slot warm.`];
}

/** Detail lines for the "converted" brief row. */
export function describeConverted(leads: Lead[]): string[] {
  const won = leads.filter((l) => l.status === "converted").sort(byNewest);
  if (won.length === 0) return [];
  return [`${capitalize(who(won))} went all the way — worth a listen to hear what clicked.`];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
