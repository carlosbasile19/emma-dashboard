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

/** A concurrent delivery younger than this is presumed still running. */
const IN_FLIGHT_MS = 60_000;

/**
 * An unprocessed event row younger than IN_FLIGHT_MS is presumed to be mid-handling by another
 * delivery: throw so Stripe retries later. Older means that attempt died or failed; run again.
 */
function assertNotInFlight(receivedAt: unknown): void {
  const age = receivedAt ? Date.now() - Date.parse(String(receivedAt)) : Infinity;
  if (age < IN_FLIGHT_MS) throw new Error("event in flight");
}

/**
 * Stripe → us. Idempotent by event id (`billing_events`): a processed event is a no-op on
 * redelivery; an event whose handler threw stays unprocessed so Stripe's retry runs it again.
 * Decisions live in the pure `planTransition`; this file only resolves ids and applies.
 */
export async function handleStripeEvent(event: Stripe.Event, origin: string): Promise<void> {
  const admin = createAdminClient();
  const { data: existing, error: selErr } = await admin
    .from("billing_events")
    .select("processed_at, received_at")
    .eq("stripe_event_id", event.id)
    .maybeSingle();
  if (selErr) throw new Error(`billing_events lookup: ${selErr.message}`);
  if (existing?.processed_at) return;
  if (existing) assertNotInFlight(existing.received_at);
  if (!existing) {
    const { error: insErr } = await admin
      .from("billing_events")
      .insert({ stripe_event_id: event.id, type: event.type, livemode: event.livemode });
    if (insErr) {
      if (insErr.code !== "23505") throw new Error(`billing_events insert: ${insErr.message}`);
      // A concurrent delivery of the same event won the insert.
      const { data: other, error: reErr } = await admin
        .from("billing_events")
        .select("processed_at, received_at")
        .eq("stripe_event_id", event.id)
        .maybeSingle();
      if (reErr) throw new Error(`billing_events re-lookup: ${reErr.message}`);
      if (other?.processed_at) return;
      assertNotInFlight(other?.received_at);
    }
  }
  try {
    await applyEvent(event as unknown as WebhookEventShape, origin);
    const { error: doneErr } = await admin
      .from("billing_events")
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq("stripe_event_id", event.id);
    if (doneErr) throw new Error(`billing_events mark processed: ${doneErr.message}`);
  } catch (e) {
    // Log-only: recording the failure must not mask the original error.
    const { error: recErr } = await admin
      .from("billing_events")
      .update({ error: e instanceof Error ? e.message : String(e) })
      .eq("stripe_event_id", event.id);
    if (recErr) console.error("[stripe-webhook] could not record event error:", recErr.message);
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
  // Metadata can name a client whose Stripe customer has since been replaced: a customer.* event
  // only counts when it is about the customer we currently have on file.
  let ours = cb !== null;
  if (cb && ev.type.startsWith("customer.") && cb.stripeCustomerId !== subject.customerId) {
    console.error("[stripe-webhook] %s for customer %s is not the client's current customer; ignoring", ev.type, subject.customerId);
    ours = false;
  }
  const plan = planTransition(ev, {
    clientId: cb && ours ? cb.clientId : null,
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
  const { data: row, error: rowErr } = await admin
    .from("billing_invoices")
    .select("id, status, total_cents, hosted_invoice_url")
    .eq("stripe_invoice_id", plan.stripeInvoiceId)
    .maybeSingle();
  if (rowErr) throw new Error(`billing_invoices lookup: ${rowErr.message}`);
  if (!row) return; // Not one of ours, or the run that created it has not written the id yet.
  // Terminal rows never move: a redelivered or out-of-order event must not flip paid back to failed.
  if ((row.status === "paid" || row.status === "void") && row.status !== plan.status) return;
  if (row.status === plan.status) return; // Nothing to change; no fields differ worth a write.
  const hostedInvoiceUrl = plan.hostedInvoiceUrl ?? (row.hosted_invoice_url as string | null) ?? null;
  // The conditional update is the guarantee: only one writer moves the row into this status, and
  // a terminal row is never touched. Failure detail is looked up after, in a second small update.
  const { data: changedRows, error: updErr } = await admin
    .from("billing_invoices")
    .update({
      status: plan.status,
      hosted_invoice_url: hostedInvoiceUrl,
      invoice_pdf_url: plan.invoicePdfUrl ?? undefined,
      paid_at: plan.paidAt ?? undefined,
      failure_message: plan.failureMessage ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .neq("status", plan.status)
    .not("status", "in", "(paid,void)")
    .select("id");
  if (updErr) throw new Error(`billing_invoices update: ${updErr.message}`);
  const changed = (changedRows?.length ?? 0) > 0;
  if (!changed) return;

  let failureMessage = plan.failureMessage;
  if (plan.lookupFailure) {
    const f = await lookupFailure(plan.stripeInvoiceId);
    failureMessage = f.message;
    const { error: failErr } = await admin
      .from("billing_invoices")
      .update({ failure_code: f.code, failure_message: f.message, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    // Log-only: the status is already moved, and a retry would see no change and skip the emails.
    if (failErr) console.error("[stripe-webhook] could not record failure detail:", failErr.message);
  }

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
