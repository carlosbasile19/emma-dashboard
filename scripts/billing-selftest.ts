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
import {
  closedMonthsWithoutInvoice,
  dueMonths,
  localDate,
  monthRange,
  nextChargeDate,
  nextMonth,
  prevMonth,
} from "../lib/billing/schedule";
import { mandateText, ordinal } from "../lib/billing/copy";
import {
  deriveStatus,
  eventSubject,
  invoiceStatusFromStripe,
  planTransition,
  setupLinkState,
  type WebhookEventShape,
} from "../lib/billing/status";

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
assert.equal(parseDollarsToCents("1,200"), 120000);
assert.equal(parseDollarsToCents("1,000,000"), null); // grouped, but over the $100,000 cap
// Mis-grouped commas return null; they are never stripped into a wrong amount.
assert.equal(parseDollarsToCents("300,00"), null);
assert.equal(parseDollarsToCents("12,50"), null);
assert.equal(parseDollarsToCents("1,20"), null);
assert.equal(parseDollarsToCents("1,2,3"), null);
assert.equal(parseDollarsToCents(",5"), null);
assert.equal(parseDollarsToCents("5,"), null);
assert.equal(parseDollarsToCents("$,1"), null);
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

// ---- localDate: the client's calendar date decides which month closed ----
// 03:00 UTC is the cron time. Brisbane (UTC+10, no DST) is already 13:00 the same day;
// New York (UTC-4 in October) is still 23:00 the previous day.
assert.equal(localDate(new Date("2026-10-03T03:00:00Z"), "Australia/Brisbane"), "2026-10-03");
assert.equal(localDate(new Date("2026-10-03T03:00:00Z"), "America/New_York"), "2026-10-02");
// A UTC instant that is already tomorrow in Sydney.
assert.equal(localDate(new Date("2026-10-03T14:30:00Z"), "Australia/Sydney"), "2026-10-04");
assert.equal(localDate(new Date("2026-10-03T14:30:00Z"), "UTC"), "2026-10-03");
// Review Focus 1: an unknown zone falls back to UTC instead of throwing.
assert.equal(localDate(new Date("2026-10-03T14:30:00Z"), "Not/AZone"), "2026-10-03");

// ---- month arithmetic ----
assert.equal(prevMonth("2026-01"), "2025-12");
assert.equal(nextMonth("2026-12"), "2027-01");
assert.deepEqual(monthRange("2026-07", "2026-10"), ["2026-07", "2026-08", "2026-09", "2026-10"]);
assert.deepEqual(monthRange("2026-10", "2026-07"), []);
assert.deepEqual(monthRange("2026-10", "2026-10"), ["2026-10"]);

// ---- dueMonths ----
// On the anchor day, last month is due.
assert.deepEqual(
  dueMonths({ today: "2026-10-03", anchorDay: 3, billFromMonth: "2026-09", invoicedMonths: [] }),
  ["2026-09"],
);
// Before the anchor day, nothing.
assert.deepEqual(
  dueMonths({ today: "2026-10-02", anchorDay: 3, billFromMonth: "2026-09", invoicedMonths: [] }),
  [],
);
// Catch-up: older months are due regardless of the anchor; oldest first.
assert.deepEqual(
  dueMonths({ today: "2026-10-02", anchorDay: 3, billFromMonth: "2026-07", invoicedMonths: [] }),
  ["2026-07", "2026-08"],
);
assert.deepEqual(
  dueMonths({ today: "2026-10-03", anchorDay: 3, billFromMonth: "2026-07", invoicedMonths: [] }),
  ["2026-07", "2026-08", "2026-09"],
);
// An existing row (any status) removes its month.
assert.deepEqual(
  dueMonths({ today: "2026-10-03", anchorDay: 3, billFromMonth: "2026-07", invoicedMonths: ["2026-08"] }),
  ["2026-07", "2026-09"],
);
// The current month is never due, even on the last day.
assert.deepEqual(
  dueMonths({ today: "2026-10-31", anchorDay: 1, billFromMonth: "2026-10", invoicedMonths: [] }),
  [],
);
// Anchor 28 on the 28th fires.
assert.deepEqual(
  dueMonths({ today: "2026-02-28", anchorDay: 28, billFromMonth: "2026-01", invoicedMonths: [] }),
  ["2026-01"],
);

// ---- closedMonthsWithoutInvoice: the "Charge now" picker ----
assert.deepEqual(closedMonthsWithoutInvoice("2026-10-15", "2026-07", ["2026-08"]), ["2026-07", "2026-09"]);
assert.deepEqual(closedMonthsWithoutInvoice("2026-10-15", "2026-10", []), []);

// ---- nextChargeDate ----
assert.equal(nextChargeDate("2026-10-02", 3), "2026-10-03");
assert.equal(nextChargeDate("2026-10-03", 3), "2026-10-03");
assert.equal(nextChargeDate("2026-10-04", 3), "2026-11-03");
assert.equal(nextChargeDate("2026-12-31", 1), "2027-01-01");

// ---- copy ----
assert.equal(ordinal(1), "1st");
assert.equal(ordinal(2), "2nd");
assert.equal(ordinal(3), "3rd");
assert.equal(ordinal(4), "4th");
assert.equal(ordinal(11), "11th");
assert.equal(ordinal(12), "12th");
assert.equal(ordinal(13), "13th");
assert.equal(ordinal(21), "21st");
assert.equal(ordinal(22), "22nd");
assert.equal(ordinal(23), "23rd");
assert.match(mandateText(3), /on the 3rd of each month/);
assert.doesNotMatch(mandateText(3), /Olivia/);

console.log("billing-selftest: schedule + copy OK");

// ---- deriveStatus ----
assert.equal(deriveStatus({ enabled: false, hasCard: true, lastInvoiceStatus: "paid" }), "off");
assert.equal(deriveStatus({ enabled: true, hasCard: false, lastInvoiceStatus: null }), "no_card");
assert.equal(deriveStatus({ enabled: true, hasCard: true, lastInvoiceStatus: null }), "active");
assert.equal(deriveStatus({ enabled: true, hasCard: true, lastInvoiceStatus: "paid" }), "active");
assert.equal(deriveStatus({ enabled: true, hasCard: true, lastInvoiceStatus: "open" }), "active");
assert.equal(deriveStatus({ enabled: true, hasCard: true, lastInvoiceStatus: "failed" }), "payment_failed");
assert.equal(deriveStatus({ enabled: true, hasCard: true, lastInvoiceStatus: "uncollectible" }), "payment_failed");
assert.equal(deriveStatus({ enabled: true, hasCard: true, lastInvoiceStatus: "action_required" }), "action_required");
assert.equal(deriveStatus({ enabled: true, hasCard: true, lastInvoiceStatus: "skipped_zero" }), "active");

// ---- invoiceStatusFromStripe ----
assert.equal(invoiceStatusFromStripe("paid"), "paid");
assert.equal(invoiceStatusFromStripe("open"), "open");
assert.equal(invoiceStatusFromStripe("void"), "void");
assert.equal(invoiceStatusFromStripe("uncollectible"), "uncollectible");
assert.equal(invoiceStatusFromStripe("draft"), "reserved");
assert.equal(invoiceStatusFromStripe(undefined), "open");

// ---- setupLinkState ----
const NOW = new Date("2026-10-11T10:00:00Z");
assert.equal(setupLinkState({ status: "pending", expiresAt: "2026-10-18T10:00:00Z" }, NOW), "valid");
assert.equal(setupLinkState({ status: "pending", expiresAt: "2026-10-10T10:00:00Z" }, NOW), "expired");
assert.equal(setupLinkState({ status: "revoked", expiresAt: "2026-10-18T10:00:00Z" }, NOW), "revoked");
assert.equal(setupLinkState({ status: "completed", expiresAt: "2026-10-18T10:00:00Z" }, NOW), "completed");
assert.equal(setupLinkState({ status: "weird", expiresAt: "2026-10-18T10:00:00Z" }, NOW), "invalid");
assert.equal(setupLinkState({ status: "pending", expiresAt: "not a date" }, NOW), "invalid");

// ---- webhook events ----
const ev = (type: string, object: Record<string, unknown>): WebhookEventShape => ({
  id: `evt_${type}`,
  type,
  data: { object },
});
const CTX_NONE = { clientId: null, mirroredPaymentMethodId: null };
const CTX_C1 = { clientId: "c1", mirroredPaymentMethodId: "pm_on_file" };

// eventSubject pulls the ids the server needs to resolve a client.
assert.deepEqual(eventSubject(ev("payment_method.detached", { id: "pm_1", customer: null })), {
  customerId: null,
  paymentMethodId: "pm_1",
  clientIdFromMetadata: null,
});
assert.deepEqual(eventSubject(ev("customer.updated", { id: "cus_1", metadata: { emma_client_id: "c1" } })), {
  customerId: "cus_1",
  paymentMethodId: null,
  clientIdFromMetadata: "c1",
});
assert.deepEqual(
  eventSubject(ev("invoice.paid", { id: "in_1", customer: "cus_1", metadata: { emma_client_id: "c1", emma_period: "2026-09" } })),
  { customerId: "cus_1", paymentMethodId: null, clientIdFromMetadata: "c1" },
);
assert.deepEqual(eventSubject(ev("checkout.session.completed", { id: "cs_1", customer: { id: "cus_1" }, metadata: { emma_client_id: "c1" } })), {
  customerId: "cus_1",
  paymentMethodId: null,
  clientIdFromMetadata: "c1",
});

// checkout.session.completed → reconcile; non-setup or non-Emma sessions are ignored.
assert.deepEqual(
  planTransition(ev("checkout.session.completed", { id: "cs_1", mode: "setup", metadata: { emma_client_id: "c1" } }), CTX_C1),
  { kind: "reconcile_checkout", sessionId: "cs_1", clientId: "c1" },
);
assert.equal(planTransition(ev("checkout.session.completed", { id: "cs_2", mode: "payment", metadata: { emma_client_id: "c1" } }), CTX_C1).kind, "ignore");
assert.equal(planTransition(ev("checkout.session.completed", { id: "cs_3", mode: "setup", metadata: {} }), CTX_NONE).kind, "ignore");

// payment_method.detached: only the card on file clears + notifies. Review Focus 3: a card
// detached during a replacement (no longer the mirror) and a card we never knew are ignored.
assert.deepEqual(planTransition(ev("payment_method.detached", { id: "pm_on_file" }), CTX_C1), {
  kind: "card_cleared",
  clientId: "c1",
  notify: true,
});
assert.equal(planTransition(ev("payment_method.detached", { id: "pm_old" }), CTX_C1).kind, "ignore");
assert.equal(planTransition(ev("payment_method.detached", { id: "pm_x" }), CTX_NONE).kind, "ignore");

// payment_method.automatically_updated refreshes the mirror for the card on file only.
assert.deepEqual(planTransition(ev("payment_method.automatically_updated", { id: "pm_on_file" }), CTX_C1), {
  kind: "card_refresh",
  clientId: "c1",
  paymentMethodId: "pm_on_file",
});
assert.equal(planTransition(ev("payment_method.automatically_updated", { id: "pm_other" }), CTX_C1).kind, "ignore");

// customer.updated: unchanged default → ignore; new default → refresh; null → clear WITHOUT notify.
assert.equal(
  planTransition(ev("customer.updated", { id: "cus_1", invoice_settings: { default_payment_method: "pm_on_file" } }), CTX_C1).kind,
  "ignore",
);
assert.deepEqual(
  planTransition(ev("customer.updated", { id: "cus_1", invoice_settings: { default_payment_method: "pm_new" } }), CTX_C1),
  { kind: "card_refresh", clientId: "c1", paymentMethodId: "pm_new" },
);
assert.deepEqual(
  planTransition(ev("customer.updated", { id: "cus_1", invoice_settings: { default_payment_method: null } }), CTX_C1),
  { kind: "card_cleared", clientId: "c1", notify: false },
);
assert.equal(planTransition(ev("customer.updated", { id: "cus_other" }), CTX_NONE).kind, "ignore");

assert.deepEqual(planTransition(ev("customer.deleted", { id: "cus_1" }), CTX_C1), { kind: "customer_deleted", clientId: "c1" });
assert.equal(planTransition(ev("customer.deleted", { id: "cus_other" }), CTX_NONE).kind, "ignore");

// invoice.* events are scoped by metadata; the status and the notification flags are data.
const INV = { id: "in_1", status: "paid", hosted_invoice_url: "https://inv", invoice_pdf: "https://pdf", metadata: { emma_client_id: "c1", emma_period: "2026-09" } };
const paid = planTransition(ev("invoice.paid", { ...INV, status_transitions: { paid_at: 1_790_000_000 } }), CTX_NONE);
assert.equal(paid.kind, "invoice_status");
if (paid.kind === "invoice_status") {
  assert.equal(paid.status, "paid");
  assert.equal(paid.paidAt, new Date(1_790_000_000 * 1000).toISOString());
  assert.equal(paid.hostedInvoiceUrl, "https://inv");
  assert.equal(paid.notifyAdmins, false);
  assert.equal(paid.clientId, "c1");
  assert.equal(paid.periodMonth, "2026-09");
}
const failed = planTransition(ev("invoice.payment_failed", { ...INV, status: "open" }), CTX_NONE);
if (failed.kind === "invoice_status") {
  assert.equal(failed.status, "failed");
  assert.equal(failed.lookupFailure, true, "the server looks up the decline reason");
  assert.equal(failed.notifyAdmins, true);
  assert.equal(failed.notifyClient, true);
} else assert.fail("expected invoice_status");
const action = planTransition(ev("invoice.payment_action_required", INV), CTX_NONE);
if (action.kind === "invoice_status") assert.equal(action.status, "action_required");
else assert.fail("expected invoice_status");
const fin = planTransition(ev("invoice.finalization_failed", { ...INV, last_finalization_error: { message: "no default payment method" } }), CTX_NONE);
if (fin.kind === "invoice_status") {
  assert.equal(fin.status, "failed");
  assert.equal(fin.failureMessage, "no default payment method");
  assert.equal(fin.notifyAdmins, true);
  assert.equal(fin.notifyClient, false);
} else assert.fail("expected invoice_status");
const voided = planTransition(ev("invoice.voided", INV), CTX_NONE);
if (voided.kind === "invoice_status") assert.equal(voided.status, "void");
else assert.fail("expected invoice_status");
const unc = planTransition(ev("invoice.marked_uncollectible", INV), CTX_NONE);
if (unc.kind === "invoice_status") assert.equal(unc.status, "uncollectible");
else assert.fail("expected invoice_status");
// Review Focus 3: an invoice without Emma metadata (another product on the account) is ignored.
assert.equal(planTransition(ev("invoice.paid", { id: "in_other", metadata: {} }), CTX_NONE).kind, "ignore");
// Unknown event types are ignored, never thrown.
assert.equal(planTransition(ev("charge.refunded", { id: "ch_1" }), CTX_C1).kind, "ignore");

console.log("billing-selftest: status + transitions OK");
