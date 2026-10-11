/**
 * Billing statuses and webhook transition planning — pure, no I/O, no `server-only`.
 *
 * `planTransition` turns a Stripe event into a description of what should change. The server
 * (lib/billing/webhooks.ts) resolves ids to a client first, then applies the plan. Keeping the
 * decision pure means every event type is unit-tested without Stripe or a database.
 */

export const INVOICE_STATUSES = [
  "reserved",
  "open",
  "paid",
  "failed",
  "action_required",
  "void",
  "uncollectible",
  "skipped_zero",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export function isInvoiceStatus(s: string): s is InvoiceStatus {
  return (INVOICE_STATUSES as readonly string[]).includes(s);
}

export type ClientBillingStatus = "off" | "no_card" | "active" | "payment_failed" | "action_required";

export const STATUS_LABEL: Record<ClientBillingStatus, string> = {
  off: "Off",
  no_card: "No card",
  active: "Active",
  payment_failed: "Payment failed",
  action_required: "Action required",
};

/** The badge for a client. `open` is a payment still in flight, so it reads as active. */
export function deriveStatus(a: {
  enabled: boolean;
  hasCard: boolean;
  lastInvoiceStatus: InvoiceStatus | null;
}): ClientBillingStatus {
  if (!a.enabled) return "off";
  if (!a.hasCard) return "no_card";
  if (a.lastInvoiceStatus === "action_required") return "action_required";
  if (a.lastInvoiceStatus === "failed" || a.lastInvoiceStatus === "uncollectible") return "payment_failed";
  return "active";
}

/** Stripe's invoice status → ours. Anything unrecognised is treated as still open. */
export function invoiceStatusFromStripe(s: string | null | undefined): InvoiceStatus {
  switch (s) {
    case "paid":
      return "paid";
    case "void":
      return "void";
    case "uncollectible":
      return "uncollectible";
    case "draft":
      return "reserved";
    default:
      return "open";
  }
}

export type SetupLinkState = "valid" | "expired" | "revoked" | "completed" | "invalid";

export function setupLinkState(row: { status: string; expiresAt: string }, now: Date): SetupLinkState {
  if (row.status === "revoked") return "revoked";
  if (row.status === "completed") return "completed";
  if (row.status !== "pending") return "invalid";
  const exp = Date.parse(row.expiresAt);
  if (Number.isNaN(exp)) return "invalid";
  return exp > now.getTime() ? "valid" : "expired";
}

// ---- Webhook transitions ----

/** The slice of a Stripe event this module reads. Structural so tests need no SDK types. */
export interface WebhookEventShape {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface EventSubject {
  customerId: string | null;
  paymentMethodId: string | null;
  clientIdFromMetadata: string | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** A Stripe reference is either an id string or an expanded object with an id. */
function idOf(v: unknown): string | null {
  if (typeof v === "string") return str(v);
  if (v && typeof v === "object" && "id" in v) return str((v as { id: unknown }).id);
  return null;
}

function meta(o: Record<string, unknown>, key: string): string | null {
  const m = o.metadata;
  return m && typeof m === "object" ? str((m as Record<string, unknown>)[key]) : null;
}

/** The ids the server must resolve to a client before planning. */
export function eventSubject(ev: WebhookEventShape): EventSubject {
  const o = ev.data.object;
  if (ev.type.startsWith("payment_method.")) {
    return { customerId: idOf(o.customer), paymentMethodId: str(o.id), clientIdFromMetadata: null };
  }
  if (ev.type.startsWith("customer.")) {
    return { customerId: str(o.id), paymentMethodId: null, clientIdFromMetadata: meta(o, "emma_client_id") };
  }
  if (ev.type.startsWith("invoice.") || ev.type.startsWith("checkout.")) {
    return { customerId: idOf(o.customer), paymentMethodId: null, clientIdFromMetadata: meta(o, "emma_client_id") };
  }
  return { customerId: null, paymentMethodId: null, clientIdFromMetadata: null };
}

export interface TransitionContext {
  /** The client the event's customer / payment method belongs to, or null when unknown to us. */
  clientId: string | null;
  /** The payment method currently mirrored as that client's card on file. */
  mirroredPaymentMethodId: string | null;
}

export type BillingTransition =
  | { kind: "ignore"; reason: string }
  | { kind: "reconcile_checkout"; sessionId: string; clientId: string }
  | { kind: "card_cleared"; clientId: string; notify: boolean }
  | { kind: "card_refresh"; clientId: string; paymentMethodId: string }
  | { kind: "customer_deleted"; clientId: string }
  | {
      kind: "invoice_status";
      clientId: string;
      periodMonth: string;
      stripeInvoiceId: string;
      status: InvoiceStatus;
      hostedInvoiceUrl: string | null;
      invoicePdfUrl: string | null;
      paidAt: string | null;
      failureMessage: string | null;
      /** The decline reason lives on the PaymentIntent; the server fetches it when true. */
      lookupFailure: boolean;
      notifyAdmins: boolean;
      notifyClient: boolean;
    };

const INVOICE_EVENTS = new Set([
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.finalization_failed",
  "invoice.voided",
  "invoice.marked_uncollectible",
]);

export function planTransition(ev: WebhookEventShape, ctx: TransitionContext): BillingTransition {
  const o = ev.data.object;

  if (ev.type === "checkout.session.completed") {
    const clientId = meta(o, "emma_client_id");
    if (o.mode !== "setup" || !clientId) return { kind: "ignore", reason: "not an Emma setup session" };
    return { kind: "reconcile_checkout", sessionId: String(o.id), clientId };
  }

  if (ev.type === "payment_method.detached") {
    if (!ctx.clientId || ctx.mirroredPaymentMethodId !== str(o.id)) {
      return { kind: "ignore", reason: "not the card on file" };
    }
    return { kind: "card_cleared", clientId: ctx.clientId, notify: true };
  }

  if (ev.type === "payment_method.automatically_updated") {
    if (!ctx.clientId || ctx.mirroredPaymentMethodId !== str(o.id)) {
      return { kind: "ignore", reason: "not the card on file" };
    }
    return { kind: "card_refresh", clientId: ctx.clientId, paymentMethodId: String(o.id) };
  }

  if (ev.type === "customer.updated") {
    if (!ctx.clientId) return { kind: "ignore", reason: "customer not on file" };
    const settings = o.invoice_settings as Record<string, unknown> | undefined;
    const pm = idOf(settings?.default_payment_method);
    if (pm === ctx.mirroredPaymentMethodId) return { kind: "ignore", reason: "default card unchanged" };
    return pm
      ? { kind: "card_refresh", clientId: ctx.clientId, paymentMethodId: pm }
      : { kind: "card_cleared", clientId: ctx.clientId, notify: false };
  }

  if (ev.type === "customer.deleted") {
    if (!ctx.clientId) return { kind: "ignore", reason: "customer not on file" };
    return { kind: "customer_deleted", clientId: ctx.clientId };
  }

  if (INVOICE_EVENTS.has(ev.type)) {
    const clientId = meta(o, "emma_client_id");
    const periodMonth = meta(o, "emma_period");
    if (!clientId || !periodMonth) return { kind: "ignore", reason: "not an Emma invoice" };
    const base = {
      clientId,
      periodMonth,
      stripeInvoiceId: String(o.id),
      hostedInvoiceUrl: str(o.hosted_invoice_url),
      invoicePdfUrl: str(o.invoice_pdf),
      paidAt: null as string | null,
      failureMessage: null as string | null,
      lookupFailure: false,
      notifyAdmins: false,
      notifyClient: false,
    };
    switch (ev.type) {
      case "invoice.paid": {
        const transitions = o.status_transitions as Record<string, unknown> | undefined;
        const paidAtSec = transitions?.paid_at;
        const paidAt = typeof paidAtSec === "number" ? new Date(paidAtSec * 1000).toISOString() : null;
        return { kind: "invoice_status", ...base, status: "paid", paidAt };
      }
      case "invoice.payment_failed":
        return { kind: "invoice_status", ...base, status: "failed", lookupFailure: true, notifyAdmins: true, notifyClient: true };
      case "invoice.payment_action_required":
        return { kind: "invoice_status", ...base, status: "action_required", notifyAdmins: true, notifyClient: true };
      case "invoice.finalization_failed": {
        const err = o.last_finalization_error as Record<string, unknown> | undefined;
        return {
          kind: "invoice_status",
          ...base,
          status: "failed",
          failureMessage: str(err?.message) ?? "Invoice could not be finalised",
          notifyAdmins: true,
        };
      }
      case "invoice.voided":
        return { kind: "invoice_status", ...base, status: "void" };
      default:
        return { kind: "invoice_status", ...base, status: "uncollectible" };
    }
  }

  return { kind: "ignore", reason: `unhandled event type ${ev.type}` };
}
