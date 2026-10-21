/* Sandbox live check — NOT part of `npm run test:*` (needs network + credentials).
 *
 * Needs `.env` with STRIPE_SECRET_KEY=sk_test_… (the sandbox), the Supabase variables and
 * BILLING_ENABLED=true. Run:
 *
 *   RESEND_API_KEY= npm run billing:livecheck
 *
 * (a blank Resend key keeps the admin alert emails from going out; sends fail soft.)
 *
 * Exercises the REAL invoicePeriod path end to end against the Stripe sandbox, for both
 * streams on ONE customer: AI Power Credits in USD and the service fee in AUD (Stripe's
 * multi-currency customers). A throwaway workspace row, Stripe's test cards, an injected usage
 * figure. Asserts the money, the currencies, the never-twice rule, the never-$0 rule, a decline,
 * retry → suspension, and resume after a good card. Cleans up every local row and the Stripe
 * customer; the sandbox invoices stay as history. Refuses to run against a live key.
 *
 * Markup is unreleased: unless BILLING_MARKUP_ENABLED=true, the stored 20% must NOT be charged.
 */
import assert from "node:assert/strict";
import { loadClientBilling, upsertClientBilling } from "../lib/billing/config";
import { ensureCustomer, setDefaultCard } from "../lib/billing/customers";
import { invoicePeriod } from "../lib/billing/invoices";
import { retryUnpaidNow } from "../lib/billing/suspension";
import { getStripe, stripeLivemode } from "../lib/stripe/client";
import { createAdminClient } from "../lib/supabase/admin";

(async () => {
  // Never email real admins: lib/email/send.ts reads the key at call time.
  process.env.RESEND_API_KEY = "";
  console.log("billing-livecheck: email sending disabled for this run");
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    console.error("billing-livecheck: STRIPE_SECRET_KEY is not a sandbox key (sk_test_/rk_test_); aborting");
    process.exit(1);
  }
  assert.equal(stripeLivemode(), false, "refusing to run the livecheck against a LIVE key");
  assert.equal(process.env.BILLING_ENABLED, "true", "BILLING_ENABLED=true is required");
  const admin = createAdminClient();
  const stripe = getStripe();
  const clientId = `livecheck-${Date.now()}`;
  // 67791 raw usage; the stored 20% applies only once markup is released (67791 × 1.2 = 81349).
  const markupOn = process.env.BILLING_MARKUP_ENABLED === "true";
  const creditsTotal = markupOn ? 81349 : 67791;
  console.log(`billing-livecheck: markup ${markupOn ? "ON" : "off"} → expecting credits ${creditsTotal}`);
  let customerId: string | null = null;
  const openInvoices: string[] = [];
  const WEEK1 = { stream: "credits" as const, from: "2026-01-05", to: "2026-01-11" };
  const WEEK2 = { stream: "credits" as const, from: "2026-01-12", to: "2026-01-18" };
  const WEEK3 = { stream: "credits" as const, from: "2026-01-19", to: "2026-01-25" };
  const FEE_JAN = { stream: "service_fee" as const, month: "2026-01" };
  const FEE_FEB = { stream: "service_fee" as const, month: "2026-02" };

  try {
    // 1. A throwaway workspace row (the FK target) + billing config: 20% markup stored, an
    //    agency fee of $450.00 AUD, automatic billing still OFF.
    const { error: insErr } = await admin
      .from("olivia_clients")
      .insert({ olivia_client_id: clientId, name: "Livecheck workspace", timezone: "UTC" });
    assert.equal(insErr, null, insErr?.message);
    await upsertClientBilling(
      clientId,
      { enabled: false, billFromMonth: "2026-01", markupBps: 2000, feeCents: 45000, feeCurrency: "aud", anchorDay: 3 },
      null,
    );

    // 2. Customer + a working test card.
    customerId = await ensureCustomer(clientId);
    const visa = await stripe.paymentMethods.attach("pm_card_visa", { customer: customerId });
    const card = await setDefaultCard(clientId, visa.id);
    assert.equal(card.last4, "4242");
    assert.equal((await loadClientBilling(clientId))?.card?.paymentMethodId, visa.id);

    // 2b. A saved card with automatic billing off is never charged: no invoice, no row.
    const off = await invoicePeriod(clientId, WEEK1, "manual", { usage: async () => 67791 });
    assert.equal(off.outcome, "skipped_disabled");
    const { data: offRows } = await admin.from("billing_invoices").select("id").eq("olivia_client_id", clientId);
    assert.equal(offRows?.length ?? 0, 0, "billing off must leave no invoice row");
    await upsertClientBilling(clientId, { enabled: true }, null);

    // 3. Stream A: a credits week, USD, one line, paid synchronously.
    const w1 = await invoicePeriod(clientId, WEEK1, "manual", { usage: async () => 67791 });
    console.log("credits:", w1.outcome, w1.status, w1.totalCents, w1.error ?? "");
    assert.equal(w1.outcome, "invoiced");
    assert.equal(w1.status, "paid");
    assert.equal(w1.totalCents, creditsTotal);
    const sw1 = await stripe.invoices.retrieve(w1.stripeInvoiceId!);
    assert.equal(sw1.currency, "usd");
    assert.equal(sw1.total, creditsTotal, "Stripe's total equals ours");
    assert.equal(sw1.metadata?.emma_stream, "credits");
    assert.equal(sw1.metadata?.emma_period, "2026-01-05");
    const w1Lines = (await stripe.invoices.listLineItems(w1.stripeInvoiceId!, { limit: 100 })).data;
    assert.equal(w1Lines.length, 1, "exactly one line");
    assert.equal(w1Lines[0]!.description, "AI Power Credits · 5 Jan 2026 – 11 Jan 2026");

    // 4. Stream B: the service fee, AUD, on the SAME customer.
    const f1 = await invoicePeriod(clientId, FEE_JAN, "manual");
    console.log("fee:", f1.outcome, f1.status, f1.totalCents, f1.error ?? "");
    assert.equal(f1.outcome, "invoiced");
    assert.equal(f1.status, "paid");
    const sf1 = await stripe.invoices.retrieve(f1.stripeInvoiceId!);
    assert.equal(sf1.currency, "aud", "the fee is charged in the agency's currency");
    assert.equal(sf1.total, 45000);
    const f1Lines = (await stripe.invoices.listLineItems(f1.stripeInvoiceId!, { limit: 100 })).data;
    assert.deepEqual(f1Lines.map((l) => [l.description, l.amount]), [["Monthly service fee · Jan 2026", 45000]]);

    // 5. Never twice, per stream and period.
    assert.equal((await invoicePeriod(clientId, WEEK1, "manual", { usage: async () => 67791 })).outcome, "already_invoiced");
    assert.equal((await invoicePeriod(clientId, FEE_JAN, "manual")).outcome, "already_invoiced");

    // 6. Usage unavailable: no row left behind, nothing charged.
    const w2 = await invoicePeriod(clientId, WEEK2, "manual", { usage: async () => null });
    assert.equal(w2.outcome, "usage_unavailable");
    const { data: w2Rows } = await admin.from("billing_invoices").select("id").eq("olivia_client_id", clientId).eq("period_key", WEEK2.from);
    assert.equal(w2Rows?.length ?? 0, 0, "an unavailable period must leave no row");

    // 7. Zero credits: recorded as skipped (the week is closed), no Stripe invoice.
    const w2z = await invoicePeriod(clientId, WEEK2, "manual", { usage: async () => 0 });
    assert.equal(w2z.outcome, "skipped_zero");
    assert.equal(w2z.stripeInvoiceId, null);

    // 8. A declining card → failed, retry scheduled; the retry fails too → suspended.
    const declined = await stripe.paymentMethods.attach("pm_card_chargeCustomerFail", { customer: customerId });
    await setDefaultCard(clientId, declined.id);
    const w3 = await invoicePeriod(clientId, WEEK3, "manual", { usage: async () => 1000 });
    console.log("declined:", w3.outcome, w3.status, w3.error ?? "");
    assert.equal(w3.outcome, "invoiced");
    assert.equal(w3.status, "failed");
    if (w3.stripeInvoiceId) openInvoices.push(w3.stripeInvoiceId);
    const { data: w3Row } = await admin
      .from("billing_invoices")
      .select("failure_code, next_retry_at, retry_count")
      .eq("olivia_client_id", clientId)
      .eq("period_key", WEEK3.from)
      .maybeSingle();
    assert.ok(w3Row?.failure_code, "decline code recorded");
    assert.ok(w3Row?.next_retry_at, "one retry scheduled");
    assert.equal((await loadClientBilling(clientId))?.suspension, null, "not suspended before the retry");
    assert.equal(await retryUnpaidNow(clientId, ""), 1, "the retry fails on the same card");
    assert.ok((await loadClientBilling(clientId))?.suspension, "suspended after the failed retry");
    // Suspended: no new charges.
    assert.equal((await invoicePeriod(clientId, FEE_FEB, "manual")).outcome, "skipped_suspended");

    // 9. A good card settles what is owed and lifts the suspension.
    await setDefaultCard(clientId, visa.id);
    assert.equal(await retryUnpaidNow(clientId, ""), 0, "paid on the good card");
    assert.equal((await loadClientBilling(clientId))?.suspension, null, "resumed");
    openInvoices.length = 0;

    console.log("billing-livecheck: OK");
  } finally {
    for (const id of openInvoices) {
      await stripe.invoices.voidInvoice(id).catch((e) => console.warn("void failed", id, e?.message));
    }
    for (const table of ["billing_invoices", "billing_setup_links", "client_billing", "olivia_clients"] as const) {
      const { error } = await admin.from(table).delete().eq("olivia_client_id", clientId);
      if (error) {
        console.error(`LEFTOVER ROWS: ${table} ${clientId}: ${error.message}`);
        process.exitCode = 1;
      }
    }
    if (customerId) {
      await stripe.customers.del(customerId).catch((e) => console.warn("customer delete failed", customerId, e?.message));
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
