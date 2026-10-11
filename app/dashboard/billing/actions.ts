"use server";

import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { billingFeatureEnabled, upsertClientBilling, type ClientBilling } from "@/lib/billing/config";
import { removeCard, syncCustomerEmail } from "@/lib/billing/customers";
import { createCheckoutSession } from "@/lib/billing/setup";
import { getRequestOrigin } from "@/lib/origin";

/**
 * The session's active workspace — every member action is scoped by the session, never by input.
 * The card can be managed whether or not automatic billing is on: saving one never charges.
 */
async function activeSession() {
  if (!billingFeatureEnabled()) redirect("/dashboard");
  return getSessionContext();
}

/** "Add card" / "Replace card": open Stripe Checkout in setup mode and come back here. */
export async function startCardSetup() {
  const ctx = await activeSession();
  const origin = await getRequestOrigin();
  let url: string;
  try {
    url = await createCheckoutSession({
      clientId: ctx.activeClientId,
      successUrl: `${origin}/dashboard/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/dashboard/billing?setup=cancelled`,
      // Becomes the billing contact if the card is saved and there is none yet. A platform admin
      // acting inside a client's workspace never does.
      contactEmail: ctx.isAdmin ? null : ctx.email,
    });
  } catch (e) {
    console.error("[billing] dashboard card setup could not start:", e);
    redirect("/dashboard/billing?error=setup_start");
  }
  redirect(url);
}

export async function removeMyCard() {
  const ctx = await activeSession();
  const origin = await getRequestOrigin();
  let removed: boolean;
  try {
    removed = await removeCard(ctx.activeClientId, origin);
  } catch (e) {
    console.error("[billing] card removal failed:", e);
    redirect("/dashboard/billing?error=remove");
  }
  redirect(removed ? "/dashboard/billing?notice=card_removed" : "/dashboard/billing");
}

/** Billing contact: stored locally and on the Stripe customer, so Stripe's receipts go there too. */
export async function saveBillingEmail(formData: FormData) {
  const ctx = await activeSession();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) redirect("/dashboard/billing?error=email");
  let saved: ClientBilling;
  try {
    saved = await upsertClientBilling(ctx.activeClientId, { billingEmail: email }, ctx.userId);
  } catch (e) {
    console.error("[billing] billing email save failed:", e);
    redirect("/dashboard/billing?error=email_save");
  }
  await syncCustomerEmail(saved, email);
  redirect("/dashboard/billing?notice=email_saved");
}
