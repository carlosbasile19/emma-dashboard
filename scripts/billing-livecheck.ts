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
 */
import assert from "node:assert/strict";
import { loadClientBilling, upsertClientBilling } from "../lib/billing/config";
import { ensureCustomer, setDefaultCard } from "../lib/billing/customers";
import { invoiceMonth } from "../lib/billing/invoices";
import { getStripe, stripeLivemode } from "../lib/stripe/client";
import { createAdminClient } from "../lib/supabase/admin";

(async () => {
  assert.equal(stripeLivemode(), false, "refusing to run the livecheck against a LIVE key");
  assert.equal(process.env.BILLING_ENABLED, "true", "BILLING_ENABLED=true is required");
  const admin = createAdminClient();
  const stripe = getStripe();
  const clientId = `livecheck-${Date.now()}`;
  let customerId: string | null = null;
  const openInvoices: string[] = [];

  try {
    // 1. A throwaway workspace row (the FK target) + billing config: 20% markup, $300 fee.
    const { error: insErr } = await admin
      .from("olivia_clients")
      .insert({ olivia_client_id: clientId, name: "Livecheck workspace", timezone: "UTC" });
    assert.equal(insErr, null, insErr?.message);
    await upsertClientBilling(
      clientId,
      { enabled: true, billFromMonth: "2026-01", markupBps: 2000, feeCents: 30000, anchorDay: 3 },
      null,
    );

    // 2. Customer + a working test card.
    customerId = await ensureCustomer(clientId);
    const visa = await stripe.paymentMethods.attach("pm_card_visa", { customer: customerId });
    const card = await setDefaultCard(clientId, visa.id);
    assert.equal(card.last4, "4242");
    assert.equal((await loadClientBilling(clientId))?.card?.paymentMethodId, visa.id);

    // 3. A month with usage: 67791 raw × 1.2 = 81349, + 30000 fee = 111349, paid synchronously.
    const jan = await invoiceMonth(clientId, "2026-01", "manual", { usage: async () => 67791 });
    console.log("jan:", jan.outcome, jan.status, jan.totalCents, jan.error ?? "");
    assert.equal(jan.outcome, "invoiced");
    assert.equal(jan.status, "paid");
    assert.equal(jan.totalCents, 111349);
    assert.ok(jan.hostedInvoiceUrl, "hosted invoice url recorded");
    const stripeJan = await stripe.invoices.retrieve(jan.stripeInvoiceId!);
    assert.equal(stripeJan.total, 111349, "Stripe's total equals ours");
    assert.equal(stripeJan.metadata?.emma_period, "2026-01");

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
    for (const id of openInvoices) await stripe.invoices.voidInvoice(id).catch(() => undefined);
    await admin.from("billing_invoices").delete().eq("olivia_client_id", clientId);
    await admin.from("billing_setup_links").delete().eq("olivia_client_id", clientId);
    await admin.from("client_billing").delete().eq("olivia_client_id", clientId);
    await admin.from("olivia_clients").delete().eq("olivia_client_id", clientId);
    if (customerId) await stripe.customers.del(customerId).catch(() => undefined);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
