import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { clientIdForCustomer, clientIdForPaymentMethod, loadClientBilling } from "./config";
import { clearCustomer, refreshCardMirror, writeCardMirror } from "./customers";
import { clientActionUrl } from "./invoices";
import { clientDisplayName, notifyCardRemoved, notifyPaymentFailed } from "./notify";
import { reconcileCheckoutSession } from "./setup";
import { eventSubject, planTransition, type BillingTransition, type WebhookEventShape } from "./status";

/**
 * Stripe → us. Idempotent by event id (`billing_events`): a processed event is a no-op on
 * redelivery; an event whose handler threw stays unprocessed so Stripe's retry runs it again.
 * Decisions live in the pure `planTransition`; this file only resolves ids and applies.
 */
export async function handleStripeEvent(event: Stripe.Event, origin: string): Promise<void> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("billing_events")
    .select("processed_at")
    .eq("stripe_event_id", event.id)
    .maybeSingle();
  if (existing?.processed_at) return;
  if (!existing) {
    // A concurrent delivery may win the insert (unique event id); either way the row exists.
    await admin
      .from("billing_events")
      .insert({ stripe_event_id: event.id, type: event.type, livemode: event.livemode });
  }
  try {
    await applyEvent(event as unknown as WebhookEventShape, origin);
    await admin
      .from("billing_events")
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq("stripe_event_id", event.id);
  } catch (e) {
    await admin
      .from("billing_events")
      .update({ error: e instanceof Error ? e.message : String(e) })
      .eq("stripe_event_id", event.id);
    throw e;
  }
}

async function applyEvent(ev: WebhookEventShape, origin: string): Promise<void> {
  const subject = eventSubject(ev);
  let clientId = subject.clientIdFromMetadata;
  if (!clientId && subject.paymentMethodId) clientId = await clientIdForPaymentMethod(subject.paymentMethodId);
  if (!clientId && subject.customerId) clientId = await clientIdForCustomer(subject.customerId);
  const cb = clientId ? await loadClientBilling(clientId) : null;
  const mirroredPaymentMethodId = cb?.card?.paymentMethodId ?? null;
  const plan = planTransition(ev, {
    clientId: cb ? cb.clientId : null,
    mirroredPaymentMethodId,
  });
  switch (plan.kind) {
    case "ignore":
      return;
    case "reconcile_checkout": {
      // ok:true and already_adopted (the return page or an earlier delivery won) are success.
      // Any other refusal is final for this session; a 5xx would only make Stripe retry forever.
      const res = await reconcileCheckoutSession(plan.sessionId, plan.clientId, origin);
      if (!res.ok && res.reason !== "already_adopted") {
        console.error("[stripe-webhook] checkout reconcile refused: session=%s reason=%s", plan.sessionId, res.reason);
      }
      return;
    }
    case "card_cleared":
    case "card_refresh": {
      if (ev.type === "customer.updated") {
        // The snapshot in a customer.updated event can be stale or out of order: act on the
        // customer's CURRENT default instead.
        const customerId = subject.customerId;
        if (!customerId) return;
        const live = await liveDefaultPaymentMethod(customerId);
        if (live === mirroredPaymentMethodId) return;
        if (live) await refreshCardMirror(plan.clientId, live);
        else await writeCardMirror(plan.clientId, null);
        return;
      }
      if (plan.kind === "card_cleared") {
        await writeCardMirror(plan.clientId, null);
        if (plan.notify) await safeNotify("card removed", () => notifyCardRemoved(plan.clientId, "detached", origin));
      } else {
        await refreshCardMirror(plan.clientId, plan.paymentMethodId);
      }
      return;
    }
    case "customer_deleted":
      await clearCustomer(plan.clientId);
      await safeNotify("customer deleted", () => notifyCardRemoved(plan.clientId, "customer_deleted", origin));
      return;
    case "invoice_status":
      await applyInvoiceStatus(plan, origin);
      return;
  }
}

/** A notification failure must never fail the event: Stripe would redeliver and re-run side effects. */
async function safeNotify(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error("[stripe-webhook] notification failed (%s):", label, e);
  }
}

/** The customer's current default payment method id from Stripe; null when none or the customer is deleted. */
async function liveDefaultPaymentMethod(customerId: string): Promise<string | null> {
  const customer = await getStripe().customers.retrieve(customerId);
  if (customer.deleted) return null;
  const pm = customer.invoice_settings?.default_payment_method;
  if (!pm) return null;
  return typeof pm === "string" ? pm : pm.id;
}

type InvoiceStatusPlan = Extract<BillingTransition, { kind: "invoice_status" }>;

/**
 * Only a CHANGE of status notifies. Our synchronous `pay` already recorded a decline and sent the
 * emails; the `invoice.payment_failed` Stripe sends for that same attempt arrives later and must
 * not send them again (Review Focus 5). A later retry that fails after a success is impossible,
 * and a retry that keeps failing stays `failed` → silent.
 */
async function applyInvoiceStatus(plan: InvoiceStatusPlan, origin: string): Promise<void> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("billing_invoices")
    .select("id, status, total_cents, hosted_invoice_url")
    .eq("stripe_invoice_id", plan.stripeInvoiceId)
    .maybeSingle();
  if (!row) return; // Not one of ours, or the run that created it has not written the id yet.
  // Terminal rows never move: a redelivered or out-of-order event must not flip paid back to failed.
  if ((row.status === "paid" || row.status === "void") && row.status !== plan.status) return;
  const changed = row.status !== plan.status;
  let failureCode: string | null = null;
  let failureMessage = plan.failureMessage;
  if (plan.lookupFailure && changed) {
    const f = await lookupFailure(plan.stripeInvoiceId);
    failureCode = f.code;
    failureMessage = f.message;
  }
  const hostedInvoiceUrl = plan.hostedInvoiceUrl ?? (row.hosted_invoice_url as string | null) ?? null;
  await admin
    .from("billing_invoices")
    .update({
      status: plan.status,
      hosted_invoice_url: hostedInvoiceUrl,
      invoice_pdf_url: plan.invoicePdfUrl ?? undefined,
      paid_at: plan.paidAt ?? undefined,
      failure_code: changed ? failureCode : undefined,
      failure_message: changed ? failureMessage : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  if (changed && (plan.notifyAdmins || plan.notifyClient) && (plan.status === "failed" || plan.status === "action_required")) {
    const kind = plan.status;
    await safeNotify("payment failed", async () =>
      notifyPaymentFailed({
        clientId: plan.clientId,
        clientName: await clientDisplayName(plan.clientId),
        month: plan.periodMonth,
        totalCents: Number(row.total_cents ?? 0),
        reason: failureMessage ?? "Payment failed",
        kind,
        origin,
        clientActionUrl: await clientActionUrl(plan.clientId, kind, hostedInvoiceUrl, origin),
      }),
    );
  }
}

/**
 * The decline reason lives on the PaymentIntent behind the invoice's latest payment. In the
 * current API version the invoice no longer carries `payment_intent` directly; it carries a
 * `payments` list. Best-effort: any failure here degrades to a generic message.
 */
async function lookupFailure(invoiceId: string): Promise<{ code: string | null; message: string | null }> {
  try {
    const stripe = getStripe();
    const invoice = (await stripe.invoices.retrieve(invoiceId, { expand: ["payments"] })) as unknown as {
      payments?: { data?: Array<{ payment?: { payment_intent?: string | { id: string } | null } }> };
    };
    const ref = invoice.payments?.data?.[0]?.payment?.payment_intent;
    const piId = typeof ref === "string" ? ref : (ref?.id ?? null);
    if (!piId) return { code: null, message: "Payment failed" };
    const pi = await stripe.paymentIntents.retrieve(piId);
    const err = pi.last_payment_error;
    return { code: err?.decline_code ?? err?.code ?? null, message: err?.message ?? "Payment failed" };
  } catch {
    return { code: null, message: "Payment failed" };
  }
}
