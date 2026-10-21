import "server-only";
import Stripe from "stripe";
import { invoiceStatusFromStripe, type InvoiceStatus } from "./status";

export interface PayOutcome {
  status: InvoiceStatus;
  failureCode: string | null;
  failureMessage: string | null;
  paidAt: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
}

const AUTH_CODES = new Set(["authentication_required", "invoice_payment_intent_requires_action"]);

/**
 * Pay a finalised invoice now. A card decline or an authentication request is an outcome, not an
 * exception; EVERYTHING else (bad request, network, auth, rate limit) rethrows so the caller records
 * a `stripe_error` instead of mistaking it for a decline.
 */
export async function payInvoice(stripe: Stripe, invoiceId: string, idempotencyKey: string): Promise<PayOutcome> {
  try {
    const paid = await stripe.invoices.pay(invoiceId, {}, { idempotencyKey });
    const paidAtSec = paid.status_transitions?.paid_at ?? null;
    return {
      status: invoiceStatusFromStripe(paid.status),
      failureCode: null,
      failureMessage: null,
      paidAt: paidAtSec ? new Date(paidAtSec * 1000).toISOString() : null,
      hostedInvoiceUrl: paid.hosted_invoice_url ?? null,
      invoicePdfUrl: paid.invoice_pdf ?? null,
    };
  } catch (e) {
    if (e instanceof Stripe.errors.StripeError) {
      const code = e.code ?? null;
      const decline = typeof e.decline_code === "string" ? e.decline_code : null;
      const needsAuth = (code != null && AUTH_CODES.has(code)) || (decline != null && AUTH_CODES.has(decline));
      if (needsAuth || e.type === "StripeCardError") {
        return {
          status: needsAuth ? "action_required" : "failed",
          failureCode: decline ?? code ?? "payment_failed",
          failureMessage: e.message,
          paidAt: null,
          hostedInvoiceUrl: null,
          invoicePdfUrl: null,
        };
      }
    }
    throw e;
  }
}
