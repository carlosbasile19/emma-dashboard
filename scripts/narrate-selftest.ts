import assert from "node:assert/strict";
import {
  buildNutshell,
  describeBooked,
  describeChase,
  describeConverted,
  describeNew,
  joinNames,
  pointsTrend,
  spokenShare,
} from "../lib/narrate";
import type { Lead, OverviewKpis } from "../lib/types";

// ---- joinNames ----
(() => {
  assert.equal(joinNames([]), "");
  assert.equal(joinNames(["Maria"]), "Maria");
  assert.equal(joinNames(["Maria", "Jack"]), "Maria and Jack");
  assert.equal(joinNames(["Maria", "Jack", "Ana"]), "Maria, Jack and Ana");
  assert.equal(joinNames(["Maria", "Jack", "Ana", "Bo"]), "Maria, Jack, Ana and 1 more");
  assert.equal(joinNames(["Maria", "Jack", "Ana"], 2), "Maria, Jack and 1 more");
})();

// ---- spokenShare ----
(() => {
  assert.equal(spokenShare(0), "no one");
  assert.equal(spokenShare(0.02), "almost no one");
  assert.equal(spokenShare(0.31), "about 3 in 10");
  assert.equal(spokenShare(0.5), "about half");
  assert.equal(spokenShare(0.52), "about half"); // rounds to 5 tenths
  assert.equal(spokenShare(0.62), "about 6 in 10");
  assert.equal(spokenShare(0.97), "nearly everyone");
  assert.equal(spokenShare(1), "nearly everyone");
  // clamped garbage
  assert.equal(spokenShare(1.4), "nearly everyone");
  assert.equal(spokenShare(-3), "no one");
})();

// ---- pointsTrend ----
(() => {
  assert.equal(pointsTrend(0.6), "");
  assert.equal(pointsTrend(0.6, undefined), "");
  assert.equal(pointsTrend(0.62, 0.62), " — holding steady on last period");
  assert.equal(pointsTrend(0.62, 0.618), " — holding steady on last period"); // < 0.5pp
  assert.equal(pointsTrend(0.65, 0.62), " — up 3 points on last period");
  assert.equal(pointsTrend(0.62, 0.65), " — down 3 points on last period");
  assert.equal(pointsTrend(0.63, 0.62), " — up 1 point on last period"); // singular
  assert.equal(pointsTrend(0.8, 0.6), " — up 20 points on last period"); // big move: whole points
})();

// ---- buildNutshell ----
const kpis = (over: Partial<OverviewKpis> = {}): OverviewKpis => ({
  leads_total: 128,
  calls_total: 342,
  pickup_rate: 0.62,
  avg_call_duration_sec: 161,
  bookings_rate: 0.07,
  converted_count: 11,
  spend: { total_cents: 41_200, currency: "usd", basis: "billed" },
  leads_by_stage: {},
  ...over,
});

(() => {
  const lines = buildNutshell(kpis(), kpis({ pickup_rate: 0.6, bookings_rate: 0.07 }));
  assert.equal(lines.length, 3);
  assert.equal(
    lines[0],
    "In a nutshell: 128 leads came in and Emma made 342 calls — about 6 in 10 picked up — up 2 points on last period.",
  );
  assert.equal(
    lines[1],
    "7% of those calls turned into bookings — holding steady on last period, and 11 leads have gone all the way to converted.",
  );
  assert.equal(lines[2], "Calls are averaging 2:41, and all-in billed spend for the window is $412.");
})();

(() => {
  // No previous period → no trend fragments.
  const lines = buildNutshell(kpis());
  assert.ok(lines[0]?.endsWith("about 6 in 10 picked up."));
  // Singulars
  const one = buildNutshell(kpis({ leads_total: 1, calls_total: 1, converted_count: 1 }));
  assert.ok(one[0]?.includes("1 lead came in and Emma made 1 call"));
  assert.ok(one[1]?.includes("1 lead has gone all the way"));
  // Zero conversions
  const none = buildNutshell(kpis({ converted_count: 0 }));
  assert.ok(none[1]?.includes("none have gone all the way"));
  // Tiny booking rate never rounds to a silent 0%.
  const tiny = buildNutshell(kpis({ bookings_rate: 0.004 }));
  assert.ok(tiny[1]?.startsWith("under 1% of those calls"));
  // Quiet window
  assert.equal(buildNutshell(kpis({ leads_total: 0, calls_total: 0 })).length, 1);
  // Leads but no calls yet: no pickup/booking talk, spend still reported.
  const noCalls = buildNutshell(kpis({ calls_total: 0 }));
  assert.equal(noCalls.length, 2);
  assert.ok(noCalls[0]?.includes("no calls have gone out yet"));
  assert.ok(noCalls[1]?.startsWith("All-in billed spend"));
})();

// ---- lead detail lines ----
const lead = (over: Partial<Lead>): Lead => ({
  id: Math.random().toString(36).slice(2),
  status: "contacted",
  source: "manual",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  total_calls: 1,
  ...over,
});

(() => {
  const leads: Lead[] = [
    lead({ status: "new", first_name: "Ana", last_name: "Ruiz", created_at: "2026-07-20T00:00:00Z" }),
    lead({ status: "contacted", first_name: "Maria", last_name: "Silva", last_disposition: "interested" }),
    lead({ status: "qualified", first_name: "Jack", last_name: "Doe", last_disposition: "interested" }),
    lead({ status: "contacted", first_name: "Tom", last_name: "Fox", last_disposition: "callback_requested" }),
    lead({ status: "contacted", last_disposition: "voicemail_left" }), // PII-redacted
    lead({ status: "contacted", first_name: "Zoe", last_name: "Lin", last_disposition: "not_interested" }),
    lead({ status: "booked", first_name: "Ben", last_name: "Kim" }),
    lead({ status: "converted", first_name: "Ivy", last_name: "Chen" }),
    lead({ status: "contacted", last_disposition: "dnc" }), // never surfaced
  ];

  const chase = describeChase(leads);
  assert.equal(chase.length, 4);
  assert.equal(
    chase[0],
    "Maria Silva and Jack Doe sounded genuinely interested on the last call — worth striking while it's warm.",
  );
  assert.equal(chase[1], "Tom Fox asked to be called back — the hesitation is timing, not interest.");
  assert.equal(chase[2], "One lead keeps going to voicemail — Emma is trying different times of day.");
  assert.equal(chase[3], "Zoe Lin said it's not for them right now — that's the objection to work on.");

  assert.deepEqual(describeNew(leads), ["Ana Ruiz just landed — Emma makes first contact next."]);
  assert.deepEqual(describeBooked(leads), [
    "Ben Kim picked a time — a quick confirmation keeps the slot warm.",
  ]);
  assert.deepEqual(describeConverted(leads), [
    "Ivy Chen went all the way — worth a listen to hear what clicked.",
  ]);

  // dnc never shows up in any line
  assert.ok(![...chase, ...describeNew(leads)].some((l) => l.toLowerCase().includes("dnc")));

  // Mixed named/redacted bucket: names first, count for the rest.
  const mixed = describeChase([
    lead({ first_name: "Maria", last_name: "Silva", last_disposition: "interested" }),
    lead({ last_disposition: "interested" }),
    lead({ last_disposition: "interested" }),
  ]);
  assert.equal(
    mixed[0],
    "Maria Silva and 2 more sounded genuinely interested on the last call — worth striking while it's warm.",
  );

  // Stage never advanced but the lead was called: disposition wins over stage.
  const stuckInNew = describeChase([
    lead({ status: "new", first_name: "Pia", last_name: "Moss", last_disposition: "interested" }),
  ]);
  assert.equal(
    stuckInNew[0],
    "Pia Moss sounded genuinely interested on the last call — worth striking while it's warm.",
  );
  // ...and a called lead no longer counts as "new" for the untouched-leads line.
  assert.deepEqual(
    describeNew([
      lead({ status: "new", first_name: "Pia", last_name: "Moss", last_disposition: "interested" }),
      lead({ status: "new", first_name: "Ana", last_name: "Ruiz" }),
    ]),
    ["Ana Ruiz just landed — Emma makes first contact next."],
  );
  // Terminal stages stay out of the chase lines even with a warm disposition.
  assert.deepEqual(
    describeChase([lead({ status: "converted", first_name: "Ivy", last_name: "Chen", last_disposition: "interested" })]),
    [],
  );

  // Cap + redacted together: hidden names and redacted leads fold into ONE trailing count.
  const capped = describeChase([
    lead({ first_name: "Ana", last_name: "Ruiz", last_disposition: "interested" }),
    lead({ first_name: "Bo", last_name: "Vik", last_disposition: "interested" }),
    lead({ first_name: "Cy", last_name: "Ono", last_disposition: "interested" }),
    lead({ first_name: "Di", last_name: "Ash", last_disposition: "interested" }),
    lead({ last_disposition: "interested" }),
  ]);
  assert.equal(
    capped[0],
    "Ana Ruiz, Bo Vik, Cy Ono and 2 more sounded genuinely interested on the last call — worth striking while it's warm.",
  );

  // Fully redacted bucket: counts only.
  const redacted = describeChase([
    lead({ last_disposition: "callback_requested" }),
    lead({ last_disposition: "callback_requested" }),
  ]);
  assert.equal(redacted[0], "2 leads asked to be called back — the hesitation is timing, not interest.");

  // Empty inputs produce no lines.
  assert.deepEqual(describeChase([]), []);
  assert.deepEqual(describeNew([]), []);
})();

console.log("narrate-selftest: all assertions passed");
