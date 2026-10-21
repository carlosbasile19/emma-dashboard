import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeLivemode } from "@/lib/stripe/client";
import { chargeTerms, claimBillingContact, loadBillingSettings, loadClientBilling, type CardOnFile } from "./config";
import { checkoutSubmitMessage } from "./copy";
import { ensureCustomer, setDefaultCard, syncCustomerEmail, writeCardMirror } from "./customers";
import { notifyCardAdded } from "./notify";
import { setupLinkState, type SetupLinkState } from "./status";
import { retryUnpaidNow } from "./suspension";

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
  const { data, error } = await admin
    .from("billing_setup_links")
    .select(COLS)
    .eq("olivia_client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`listSetupLinks failed: ${error.message}`);
  return (data ?? []).map((r) => rowToLink(r as Record<string, unknown>));
}

/** Revokes a pending link, but only if it belongs to `clientId` (the route's client). */
export async function revokeSetupLink(id: string, clientId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("billing_setup_links")
    .update({ status: "revoked" })
    .eq("id", id)
    .eq("olivia_client_id", clientId)
    .eq("status", "pending");
  if (error) throw new Error(`revokeSetupLink failed: ${error.message}`);
}

export async function markSetupLinkSent(id: string, to: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("billing_setup_links").update({ sent_to: to }).eq("id", id);
  if (error) throw new Error(`markSetupLinkSent failed: ${error.message}`);
}

export async function getSetupLink(
  token: string,
): Promise<{ link: SetupLink; state: SetupLinkState } | null> {
  if (!token) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.from("billing_setup_links").select(COLS).eq("token", token).maybeSingle();
  if (error) throw new Error(`getSetupLink failed: ${error.message}`);
  if (!data) return null;
  const link = rowToLink(data as Record<string, unknown>);
  return { link, state: setupLinkState({ status: link.status, expiresAt: link.expiresAt }, new Date()) };
}

export async function completeSetupLink(token: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("billing_setup_links")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("token", token)
    .eq("status", "pending");
  if (error) throw new Error(`completeSetupLink failed: ${error.message}`);
}

/**
 * A Stripe Checkout Session in setup mode for the client's customer. Returns the hosted URL to
 * redirect the browser to. `successUrl` must contain the literal `{CHECKOUT_SESSION_ID}`
 * placeholder — Stripe substitutes it, and the return page uses it to reconcile.
 * A `setupToken` must be a valid (pending, unexpired) link belonging to `clientId`.
 * `contactEmail` (the signed-in member, never an admin) becomes the billing contact once the
 * card is adopted, if the client has none yet.
 */
export async function createCheckoutSession(args: {
  clientId: string;
  successUrl: string;
  cancelUrl: string;
  setupToken?: string | null;
  contactEmail?: string | null;
}): Promise<string> {
  if (args.setupToken) {
    const found = await getSetupLink(args.setupToken);
    if (!found || found.state !== "valid" || found.link.clientId !== args.clientId) {
      throw new Error("Setup link is not valid");
    }
  }
  const customerId = await ensureCustomer(args.clientId);
  const [cb, settings] = await Promise.all([loadClientBilling(args.clientId), loadBillingSettings()]);
  const metadata: Record<string, string> = {
    emma_client_id: args.clientId,
    emma_origin: args.setupToken ? "link" : "dashboard",
  };
  if (args.setupToken) metadata.emma_setup_token = args.setupToken;
  if (args.contactEmail) metadata.emma_contact_email = args.contactEmail.toLowerCase();
  const session = await getStripe().checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    currency: "usd",
    allowed_payment_method_types: ["card"], // stripe@23 name for payment_method_types
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    custom_text: { submit: { message: checkoutSubmitMessage(chargeTerms(cb, settings)) } },
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
      reason:
        | "incomplete"
        | "not_emma"
        | "client_mismatch"
        | "customer_mismatch"
        | "no_payment_method"
        | "not_found"
        | "stale"
        | "link_invalid"
        | "link_revoked"
        | "link_expired"
        | "already_adopted";
    };

/**
 * After Checkout: verify the session, make its payment method the card on file, complete the
 * setup link it came from, and email the admins. Idempotent — the return page and the webhook
 * both call it. Only the caller that wins the atomic claim on `client_billing` adopts the card
 * and sends the email; every other caller gets `already_adopted`.
 *
 * `expectedClientId` is the tenant guard for the return page (the session's client must be the
 * one the page belongs to); the webhook passes the session's own client id.
 */
export async function reconcileCheckoutSession(
  sessionId: string,
  expectedClientId: string | null,
  origin: string,
): Promise<ReconcileResult> {
  let session;
  try {
    session = await getStripe().checkout.sessions.retrieve(sessionId, { expand: ["setup_intent"] });
  } catch {
    return { ok: false, reason: "not_found" };
  }
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

  // The link must still belong to this client and still be usable. A session opened before a
  // revoke or expiry must not adopt the card. A completed link is accepted so a replay of the
  // same session reaches the claim below and reports already_adopted.
  const setupToken = session.metadata?.emma_setup_token || null;
  if (setupToken) {
    const found = await getSetupLink(setupToken);
    if (!found || found.link.clientId !== clientId) return { ok: false, reason: "link_invalid" };
    if (found.state === "revoked") return { ok: false, reason: "link_revoked" };
    if (found.state === "expired") return { ok: false, reason: "link_expired" };
    if (found.state !== "valid" && found.state !== "completed") return { ok: false, reason: "link_invalid" };
  }

  const previousCard = cb.card;
  // Atomic claim. The conditional update is the lock: only one caller can change the stored
  // card id from something else to pmId, so only that caller adopts and notifies.
  const admin = createAdminClient();
  const { data: claimed, error: claimErr } = await admin
    .from("client_billing")
    .update({ default_payment_method_id: pmId, updated_at: new Date().toISOString() })
    .eq("olivia_client_id", clientId)
    .or(`default_payment_method_id.is.null,default_payment_method_id.neq.${pmId}`)
    .select("olivia_client_id");
  if (claimErr) throw new Error(`Card adoption claim failed: ${claimErr.message}`);
  if (!claimed || claimed.length === 0) return { ok: false, reason: "already_adopted" };

  let card: CardOnFile;
  try {
    card = await setDefaultCard(clientId, pmId);
  } catch (err) {
    console.error("[billing] reconcile setDefaultCard failed", {
      sessionId,
      clientId,
      message: err instanceof Error ? err.message : String(err),
    });
    // A failed adoption must never leave a chargeable-looking row. setDefaultCard may have written
    // the new mirror before failing, so restore the whole previous mirror, not just the id.
    try {
      await writeCardMirror(clientId, previousCard);
    } catch (restoreErr) {
      console.error("[billing] reconcile could not restore the previous card id", {
        sessionId,
        clientId,
        message: restoreErr instanceof Error ? restoreErr.message : String(restoreErr),
      });
    }
    return { ok: false, reason: "stale" };
  }
  // The card is adopted: nothing after this may turn that into an error result.
  if (setupToken) {
    try {
      await completeSetupLink(setupToken);
    } catch (e) {
      // The link stays reusable until a later adoption attempt marks it.
      console.error("[billing] setup link not marked completed", { sessionId, clientId, setupToken }, e);
    }
  }
  // The member who saved the card becomes the billing contact when there is none yet, so Stripe's
  // receipts have somewhere to go. Whichever caller adopted the card does this, once.
  const contactEmail = session.metadata?.emma_contact_email || null;
  if (contactEmail) {
    try {
      const withContact = await claimBillingContact(clientId, contactEmail);
      if (withContact) await syncCustomerEmail(withContact, withContact.billingEmail);
    } catch (e) {
      console.error("[billing] billing contact not set after card adoption", { sessionId, clientId }, e);
    }
  }
  try {
    await notifyCardAdded(clientId, card, origin);
  } catch (e) {
    console.error("[billing] card-added notification failed", { sessionId, clientId }, e);
  }
  // A new card settles what is owed straight away; paying the last unpaid charge lifts a suspension.
  try {
    await retryUnpaidNow(clientId, origin);
  } catch (e) {
    console.error("[billing] retry of unpaid charges after new card failed", { sessionId, clientId }, e);
  }
  return { ok: true, clientId, card, alreadyDone: false };
}
