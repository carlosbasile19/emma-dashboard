/* Sandbox live check — NOT part of `npm run test:*` (needs network + credentials).
 *
 * Needs `.env` with STRIPE_SECRET_KEY=sk_test_… (the sandbox), the Supabase variables and
 * BILLING_ENABLED=true. Run:
 *
 *   RESEND_API_KEY= npm run billing:livecheck
 *
 * (a blank Resend key keeps the admin alert emails from going out; sends fail soft.)
 *
 * Exercises the REAL invoiceMonth path end to end against the Stripe sandbox: a throwaway
 * workspace row, Stripe's test cards, an injected usage figure. Asserts the money, the
 * never-twice rule, the never-$0 rule, and a decline. Cleans up every local row and the Stripe
 * customer; the sandbox invoices stay as history. Refuses to run against a live key.
 *
 * Markup is unreleased: unless BILLING_MARKUP_ENABLED=true, the stored 20% must NOT be charged.
 */
import assert from "node:assert/strict";
import { loadClientBilling, upsertClientBilling } from "../lib/billing/config";
import { ensureCustomer, setDefaultCard } from "../lib/billing/customers";
import { invoiceMonth } from "../lib/billing/invoices";
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
  const usageLine = markupOn ? 81349 : 67791;
  const janTotal = usageLine + 30000;
  console.log(`billing-livecheck: markup ${markupOn ? "ON" : "off"} → expecting ${janTotal}`);
  let customerId: string | null = null;
  const openInvoices: string[] = [];

  try {
    // 1. A throwaway workspace row (the FK target) + billing config: 20% markup stored, $300 fee,
    //    automatic billing still OFF (a card can be saved before it is switched on).
    const { error: insErr } = await admin
      .from("olivia_clients")
      .insert({ olivia_client_id: clientId, name: "Livecheck workspace", timezone: "UTC" });
    assert.equal(insErr, null, insErr?.message);
    await upsertClientBilling(
      clientId,
      { enabled: false, billFromMonth: "2026-01", markupBps: 2000, feeCents: 30000, anchorDay: 3 },
      null,
    );

    // 2. Customer + a working test card.
    customerId = await ensureCustomer(clientId);
    const visa = await stripe.paymentMethods.attach("pm_card_visa", { customer: customerId });
    const card = await setDefaultCard(clientId, visa.id);
    assert.equal(card.last4, "4242");
    assert.equal((await loadClientBilling(clientId))?.card?.paymentMethodId, visa.id);

    // 2b. A saved card with automatic billing off is never charged: no invoice, no row.
    const off = await invoiceMonth(clientId, "2026-01", "manual", { usage: async () => 67791 });
    assert.equal(off.outcome, "skipped_disabled");
    const { data: offRows } = await admin.from("billing_invoices").select("id").eq("olivia_client_id", clientId);
    assert.equal(offRows?.length ?? 0, 0, "billing off must leave no invoice row");
    await upsertClientBilling(clientId, { enabled: true }, null);

    // 3. A month with usage: usage line + 30000 fee, paid synchronously.
    const jan = await invoiceMonth(clientId, "2026-01", "manual", { usage: async () => 67791 });
    console.log("jan:", jan.outcome, jan.status, jan.totalCents, jan.error ?? "");
    assert.equal(jan.outcome, "invoiced");
    assert.equal(jan.status, "paid");
    assert.equal(jan.totalCents, janTotal);
    assert.ok(jan.hostedInvoiceUrl, "hosted invoice url recorded");
    const stripeJan = await stripe.invoices.retrieve(jan.stripeInvoiceId!);
    assert.equal(stripeJan.total, janTotal, "Stripe's total equals ours");
    assert.equal(stripeJan.metadata?.emma_period, "2026-01");
    const janLines = (await stripe.invoices.listLineItems(jan.stripeInvoiceId!, { limit: 100 })).data;
    assert.equal(janLines.length, 2, "exactly two invoice lines");
    const lineAmounts = new Map(janLines.map((l) => [l.description, l.amount]));
    assert.equal(lineAmounts.get("Emma usage · Jan 2026"), usageLine, "usage line");
    assert.equal(lineAmounts.get("Monthly fee · Jan 2026"), 30000, "fee line");

    // 4. The same month again is refused — never billed twice.
    const again = await invoiceMonth(clientId, "2026-01", "manual", { usage: async () => 67791 });
    assert.equal(again.outcome, "already_invoiced");

    // 5. Usage unavailable: no row left behind, nothing charged.
    const feb = await invoiceMonth(clientId, "2026-02", "manual", { usage: async () => null });
    assert.equal(feb.outcome, "usage_unavailable");
    const { data: febRows } = await admin
      .from("billing_invoices")
      .select("id")
      .eq("olivia_client_id", clientId)
      .eq("period_month", "2026-02");
    assert.equal(febRows?.length ?? 0, 0, "an unavailable month must leave no row");

    // 6. Zero total: recorded as skipped, no Stripe invoice.
    await upsertClientBilling(clientId, { feeCents: 0 }, null);
    const mar = await invoiceMonth(clientId, "2026-03", "manual", { usage: async () => 0 });
    assert.equal(mar.outcome, "skipped_zero");
    assert.equal(mar.stripeInvoiceId, null);
    await upsertClientBilling(clientId, { feeCents: 30000 }, null);

    // 7. A declining card: invoiced, status failed with a decline code recorded.
    const declined = await stripe.paymentMethods.attach("pm_card_chargeCustomerFail", { customer: customerId });
    await setDefaultCard(clientId, declined.id);
    const apr = await invoiceMonth(clientId, "2026-04", "manual", { usage: async () => 1000 });
    console.log("apr:", apr.outcome, apr.status, apr.error ?? "");
    assert.equal(apr.outcome, "invoiced");
    assert.equal(apr.status, "failed");
    if (apr.stripeInvoiceId) openInvoices.push(apr.stripeInvoiceId);
    const { data: aprRow } = await admin
      .from("billing_invoices")
      .select("failure_code, failure_message")
      .eq("olivia_client_id", clientId)
      .eq("period_month", "2026-04")
      .maybeSingle();
    assert.ok(aprRow?.failure_code, "decline code recorded");
    console.log("decline:", aprRow?.failure_code, "—", aprRow?.failure_message);

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
