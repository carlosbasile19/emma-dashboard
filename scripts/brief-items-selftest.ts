import assert from "node:assert/strict";
import { buildBriefItems } from "../lib/overview";
import type { Overview } from "../lib/types";

const overview = (stageBooked: number): Overview => ({
  client_id: "c1",
  period: { from: "2026-04-24", to: "2026-07-22", tz: "Australia/Brisbane" },
  kpis: {
    leads_total: 2581,
    calls_total: 221,
    pickup_rate: 0.4,
    avg_call_duration_sec: 120,
    bookings_rate: 0.019,
    converted_count: 0,
    spend: { total_cents: 10_000, currency: "usd", basis: "billed" },
    leads_by_stage: { new: 2580, booked: stageBooked },
  },
});

const bookingsItem = (items: ReturnType<typeof buildBriefItems>) =>
  items.find((i) => i.category === "bookings");

(() => {
  // The bug: stages never advance in some workspaces, so stage booked=0 while real
  // appointments exist in booking_outcomes. The item must come from the outcomes count.
  const item = bookingsItem(buildBriefItems(overview(0), [], [], { confirmed: 36 }));
  assert.ok(item, "bookings item must exist when booking_outcomes has appointments");
  assert.equal(item.title, "36 appointments on the books");
  assert.equal(item.sub, "All 36 are confirmed and on the calendar.");

  // scheduled + confirmed both counted, and both mentioned.
  const mixed = bookingsItem(buildBriefItems(overview(0), [], [], { scheduled: 12, confirmed: 24 }));
  assert.equal(mixed?.title, "36 appointments on the books");
  assert.equal(mixed?.sub, "24 confirmed, 12 still waiting on a yes.");

  // scheduled only.
  const sched = bookingsItem(buildBriefItems(overview(0), [], [], { scheduled: 2 }));
  assert.equal(sched?.title, "2 appointments on the books");
  assert.equal(sched?.sub, "Still waiting on a yes — Emma is nudging them.");

  // Completed/cancelled/no_show are outcomes of past bookings, not appointments on the books.
  const past = bookingsItem(
    buildBriefItems(overview(0), [], [], { completed: 9, cancelled: 3, no_show: 1 }),
  );
  assert.equal(past, undefined);

  // Outcomes unavailable (fetch failed) → stage count fallback still works.
  const fallback = bookingsItem(buildBriefItems(overview(4), [], []));
  assert.equal(fallback?.title, "4 appointments on the books");
  assert.equal(fallback?.sub, "These leads have locked in a visit.");

  // Stage count larger than outcomes (stages DO advance here) → never undercount.
  const stageWins = bookingsItem(buildBriefItems(overview(5), [], [], { confirmed: 2 }));
  assert.equal(stageWins?.title, "5 appointments on the books");

  // Singular forms.
  const one = bookingsItem(buildBriefItems(overview(0), [], [], { confirmed: 1 }));
  assert.equal(one?.title, "1 appointment on the books");
  assert.equal(one?.sub, "It's confirmed and on the calendar.");

  // Nothing anywhere → no bookings item.
  assert.equal(bookingsItem(buildBriefItems(overview(0), [], [])), undefined);
})();

console.log("brief-items-selftest: all assertions passed");
