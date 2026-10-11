import assert from "node:assert/strict";
import {
  applyMarkup,
  bpsToPercent,
  centsToDollarsInput,
  composeInvoice,
  MARKUP_BPS_MAX,
  markupLeadDetail,
  markupOverview,
  markupTimeseries,
  parseAnchorDay,
  parseDollarsToCents,
  parseMonthKey,
  parsePercentToBps,
} from "../lib/billing/money";
import type { LeadDetail, Overview, Timeseries } from "../lib/types";

// ---- applyMarkup: one rounding, on the total ----
assert.equal(applyMarkup(67791, 0), 67791);
assert.equal(applyMarkup(67791, 2000), 81349); // 67791 × 1.2 = 81349.2
assert.equal(applyMarkup(1, 5000), 2); // 1.5 rounds half-up
assert.equal(applyMarkup(3, 5000), 5); // 4.5 rounds half-up
assert.equal(applyMarkup(0, 2000), 0);
// Rounding once on the sum, not per day: three 1-cent days at 50% is 4.5 → 5, never 2+2+2.
assert.equal(applyMarkup(1 + 1 + 1, 5000), 5);
assert.throws(() => applyMarkup(100, -1), RangeError);
assert.throws(() => applyMarkup(100, MARKUP_BPS_MAX + 1), RangeError);
assert.throws(() => applyMarkup(10.5, 0), RangeError);

// ---- admin inputs: decorated numbers parse, garbage is null (never a silent 0) ----
assert.equal(parsePercentToBps("20"), 2000);
assert.equal(parsePercentToBps("12.5"), 1250);
assert.equal(parsePercentToBps("12.50"), 1250);
assert.equal(parsePercentToBps(" 7 % "), 700);
assert.equal(parsePercentToBps("0"), 0);
assert.equal(parsePercentToBps("300"), 30000);
assert.equal(parsePercentToBps("300.01"), null);
assert.equal(parsePercentToBps(""), null);
assert.equal(parsePercentToBps("abc"), null);
assert.equal(parsePercentToBps("-1"), null);
assert.equal(parsePercentToBps("1e2"), null);
assert.equal(bpsToPercent(0), "0");
assert.equal(bpsToPercent(2000), "20");
assert.equal(bpsToPercent(1250), "12.5");
assert.equal(bpsToPercent(1205), "12.05");
assert.equal(bpsToPercent(1), "0.01");

assert.equal(parseDollarsToCents("300"), 30000);
assert.equal(parseDollarsToCents("299.99"), 29999);
assert.equal(parseDollarsToCents("$1,200.50"), 120050);
assert.equal(parseDollarsToCents("0"), 0);
assert.equal(parseDollarsToCents("1.999"), null);
assert.equal(parseDollarsToCents("-5"), null);
assert.equal(parseDollarsToCents(""), null);
assert.equal(parseDollarsToCents("100000.01"), null); // over the $100,000 cap
assert.equal(centsToDollarsInput(30000), "300");
assert.equal(centsToDollarsInput(29999), "299.99");
assert.equal(centsToDollarsInput(5), "0.05");

assert.equal(parseAnchorDay("3"), 3);
assert.equal(parseAnchorDay("1"), 1);
assert.equal(parseAnchorDay("28"), 28);
assert.equal(parseAnchorDay("29"), null); // a 29th–31st would never fire in a short month
assert.equal(parseAnchorDay("0"), null);
assert.equal(parseAnchorDay("31"), null);
assert.equal(parseAnchorDay("abc"), null);
assert.equal(parseAnchorDay("2.5"), null);

assert.equal(parseMonthKey("2026-09"), "2026-09");
assert.equal(parseMonthKey(" 2026-09 "), "2026-09");
assert.equal(parseMonthKey("2026-13"), null);
assert.equal(parseMonthKey("2026-9"), null);
assert.equal(parseMonthKey("202609"), null);

// ---- composeInvoice ----
assert.deepEqual(composeInvoice(67791, 2000, 30000), {
  rawUsageCents: 67791,
  markupBps: 2000,
  billedUsageCents: 81349,
  feeCents: 30000,
  totalCents: 111349,
});
// Zero usage with a fee still produces an invoice (only an all-zero total is skipped).
assert.equal(composeInvoice(0, 2000, 30000).totalCents, 30000);
assert.equal(composeInvoice(5000, 0, 0).totalCents, 5000);
assert.equal(composeInvoice(0, 0, 0).totalCents, 0);
assert.throws(() => composeInvoice(100, 0, -1), RangeError);

// ---- dashboard payloads ----
const overview = {
  client_id: "c1",
  period: { from: "2026-09-01", to: "2026-09-30", tz: "UTC" },
  kpis: {
    leads_total: 1,
    calls_total: 1,
    pickup_rate: 0,
    avg_call_duration_sec: 0,
    bookings_rate: 0,
    converted_count: 0,
    spend: { total_cents: 1000, currency: "usd", basis: "billed_voice" },
    leads_by_stage: {},
  },
} as Overview;
const marked = markupOverview(overview, 2000);
assert.equal(marked.kpis.spend.total_cents, 1200);
assert.equal(overview.kpis.spend.total_cents, 1000, "input must not be mutated");
assert.equal(markupOverview(overview, 0), overview, "0 bps returns the same object");
// A float from upstream is rounded before the markup rather than throwing on a live page.
const floaty = { ...overview, kpis: { ...overview.kpis, spend: { ...overview.kpis.spend, total_cents: 10.6 } } } as Overview;
assert.equal(markupOverview(floaty, 0).kpis.spend.total_cents, 10.6);
assert.equal(markupOverview(floaty, 1000).kpis.spend.total_cents, 12); // round(10.6) = 11, × 1.1 = 12.1 → 12

const ts = {
  client_id: "c1",
  period: { from: "2026-09-01", to: "2026-09-02", tz: "UTC" },
  series: [
    { date: "2026-09-01", calls: 1, picked_up: 1, bookings: 0, spend_cents: 100 },
    { date: "2026-09-02", calls: 1, picked_up: 1, bookings: 0, spend_cents: 250 },
  ],
} as Timeseries;
assert.deepEqual(
  markupTimeseries(ts, 2000).series.map((p) => p.spend_cents),
  [120, 300],
);
assert.equal(ts.series[0]?.spend_cents, 100, "input must not be mutated");

const lead = {
  lead: { id: "l1" },
  pipeline: null,
  summary: { total_spend_cents: 333, currency: "usd", basis: "billed", calls: 1, bookings: 0, days_in_pipeline: 1 },
  calls: [],
  bookings: [],
  conversations: [],
} as unknown as LeadDetail;
assert.equal(markupLeadDetail(lead, 1000).summary.total_spend_cents, 366); // 366.3 → 366

console.log("billing-selftest: money OK");
