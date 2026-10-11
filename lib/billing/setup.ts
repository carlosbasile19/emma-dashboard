import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeLivemode } from "@/lib/stripe/client";
import { loadClientBilling, type CardOnFile } from "./config";
import { CHECKOUT_SUBMIT_MESSAGE } from "./copy";
import { ensureCustomer, setDefaultCard } from "./customers";
import { notifyCardAdded } from "./notify";
import { setupLinkState, type SetupLinkState } from "./status";

/**
 * Card capture. Two entry points (the client's Billing page and a public token link) create
 * the same Stripe Checkout Session in setup mode; one reconcile function handles the return
 * from Stripe and the `checkout.session.completed` webhook identically and idempotently.
 */

export const SETUP_LINK_TTL_DAYS = 7;

export interface SetupLink {
  id: string;
  token: string;
  clientId: string;
  createdBy: string | null;
  sentTo: string | null;
  createdAt: string;
  expiresAt: string;
  status: string;
  completedAt: string | null;
}

const COLS = "id, token, olivia_client_id, created_by, sent_to, created_at, expires_at, status, completed_at";

function rowToLink(r: Record<string, unknown>): SetupLink {
  return {
    id: String(r.id),
    token: String(r.token),
    clientId: String(r.olivia_client_id),
    createdBy: (r.created_by as string | null) ?? null,
    sentTo: (r.sent_to as string | null) ?? null,
    createdAt: String(r.created_at),
    expiresAt: String(r.expires_at),
    status: String(r.status),
    completedAt: (r.completed_at as string | null) ?? null,
  };
}

export function setupLinkUrl(origin: string, token: string): string {
  return `${origin}/billing/setup/${token}`;
}

export async function createSetupLink(clientId: string, createdBy: string | null): Promise<SetupLink> {
  const admin = createAdminClient();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SETUP_LINK_TTL_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("billing_setup_links")
    .insert({
      token,
      olivia_client_id: clientId,
      created_by: createdBy,
      expires_at: expiresAt,
      livemode: stripeLivemode(),
    })
    .select(COLS)
    .single();
  if (error || !data) throw new Error(`could not create setup link: ${error?.message ?? "no row"}`);
  return rowToLink(data as Record<string, unknown>);
}

/** Newest first. */
export async function listSetupLinks(clientId: string): Promise<SetupLink[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("billing_setup_links")
    .select(COLS)
    .eq("olivia_client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []).map((r) => rowToLink(r as Record<string, unknown>));
}

export async function revokeSetupLink(id: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("billing_setup_links").update({ status: "revoked" }).eq("id", id).eq("status", "pending");
}

export async function markSetupLinkSent(id: string, to: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("billing_setup_links").update({ sent_to: to }).eq("id", id);
}

export async function getSetupLink(
  token: string,
): Promise<{ link: SetupLink; state: SetupLinkState } | null> {
  if (!token) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("billing_setup_links").select(COLS).eq("token", token).maybeSingle();
  if (!data) return null;
  const link = rowToLink(data as Record<string, unknown>);
  return { link, state: setupLinkState({ status: link.status, expiresAt: link.expiresAt }, new Date()) };
}

export async function completeSetupLink(token: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("billing_setup_links")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("token", token)
    .eq("status", "pending");
}

/**
 * A Stripe Checkout Session in setup mode for the client's customer. Returns the hosted URL to
 * redirect the browser to. `successUrl` must contain the literal `{CHECKOUT_SESSION_ID}`
 * placeholder — Stripe substitutes it, and the return page uses it to reconcile.
 */
export async function createCheckoutSession(args: {
  clientId: string;
  successUrl: string;
  cancelUrl: string;
  setupToken?: string | null;
}): Promise<string> {
  const customerId = await ensureCustomer(args.clientId);
  const metadata: Record<string, string> = {
    emma_client_id: args.clientId,
    emma_origin: args.setupToken ? "link" : "dashboard",
  };
  if (args.setupToken) metadata.emma_setup_token = args.setupToken;
  const session = await getStripe().checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    currency: "usd",
    allowed_payment_method_types: ["card"], // stripe@23 name for payment_method_types
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    custom_text: { submit: { message: CHECKOUT_SUBMIT_MESSAGE } },
    metadata,
    setup_intent_data: { metadata: { emma_client_id: args.clientId } },
  });
  if (!session.url) throw new Error("Stripe returned a Checkout session without a url");
  return session.url;
}

export type ReconcileResult =
  | { ok: true; clientId: string; card: CardOnFile; alreadyDone: boolean }
  | {
      ok: false;
      reason: "incomplete" | "not_emma" | "client_mismatch" | "customer_mismatch" | "no_payment_method";
    };

/**
 * After Checkout: verify the session, make its payment method the card on file, complete the
 * setup link it came from, and email the admins. Idempotent — the return page and the webhook
 * both call it; the second caller finds the card already mirrored and sends nothing.
 *
 * `expectedClientId` is the tenant guard for the return page (the session's client must be the
 * one the page belongs to); the webhook passes the session's own client id.
 */
export async function reconcileCheckoutSession(
  sessionId: string,
  expectedClientId: string | null,
  origin: string,
): Promise<ReconcileResult> {
  const session = await getStripe().checkout.sessions.retrieve(sessionId, { expand: ["setup_intent"] });
  if (session.mode !== "setup" || session.status !== "complete") return { ok: false, reason: "incomplete" };
  const clientId = session.metadata?.emma_client_id;
  if (!clientId) return { ok: false, reason: "not_emma" };
  if (expectedClientId && expectedClientId !== clientId) return { ok: false, reason: "client_mismatch" };

  const cb = await loadClientBilling(clientId);
  const customerId = typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
  if (!cb?.stripeCustomerId || !customerId || cb.stripeCustomerId !== customerId) {
    return { ok: false, reason: "customer_mismatch" };
  }

  const setupIntent = session.setup_intent;
  const pmRef = setupIntent && typeof setupIntent !== "string" ? setupIntent.payment_method : null;
  const pmId = typeof pmRef === "string" ? pmRef : (pmRef?.id ?? null);
  if (!pmId) return { ok: false, reason: "no_payment_method" };

  const setupToken = session.metadata?.emma_setup_token || null;
  if (cb.card?.paymentMethodId === pmId) {
    if (setupToken) await completeSetupLink(setupToken);
    return { ok: true, clientId, card: cb.card, alreadyDone: true };
  }
  const card = await setDefaultCard(clientId, pmId);
  if (setupToken) await completeSetupLink(setupToken);
  await notifyCardAdded(clientId, card, origin);
  return { ok: true, clientId, card, alreadyDone: false };
}
