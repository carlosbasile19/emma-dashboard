"use server";

import { redirect } from "next/navigation";
import { getSessionClientId, getSessionUser } from "@/lib/auth";
import { billingFeatureEnabled, loadClientBilling, upsertClientBilling, type ClientBilling } from "@/lib/billing/config";
import { removeCard } from "@/lib/billing/customers";
import { createCheckoutSession } from "@/lib/billing/setup";
import { getRequestOrigin } from "@/lib/origin";
import { getStripe } from "@/lib/stripe/client";

/** The active workspace's billing row — every member action is scoped by the session, never by input. */
async function activeBilling(): Promise<ClientBilling> {
  if (!billingFeatureEnabled()) redirect("/dashboard");
  const cb = await loadClientBilling(await getSessionClientId());
  if (!cb?.enabled) redirect("/dashboard/billing");
  return cb;
}

/** "Add card" / "Replace card": open Stripe Checkout in setup mode and come back here. */
export async function startCardSetup() {
  const cb = await activeBilling();
  const origin = await getRequestOrigin();
  let url: string;
  try {
    url = await createCheckoutSession({
      clientId: cb.clientId,
      successUrl: `${origin}/dashboard/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/dashboard/billing?setup=cancelled`,
    });
  } catch (e) {
    console.error("[billing] dashboard card setup could not start:", e);
    redirect("/dashboard/billing?error=setup_start");
  }
  redirect(url);
}

export async function removeMyCard() {
  const cb = await activeBilling();
  const origin = await getRequestOrigin();
  let removed: boolean;
  try {
    removed = await removeCard(cb.clientId, origin);
  } catch (e) {
    console.error("[billing] card removal failed:", e);
    redirect("/dashboard/billing?error=remove");
  }
  redirect(removed ? "/dashboard/billing?notice=card_removed" : "/dashboard/billing");
}

/** Billing contact: stored locally and on the Stripe customer, so Stripe's receipts go there too. */
export async function saveBillingEmail(formData: FormData) {
  const cb = await activeBilling();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) redirect("/dashboard/billing?error=email");
  const user = await getSessionUser();
  try {
    await upsertClientBilling(cb.clientId, { billingEmail: email }, user?.id ?? null);
  } catch (e) {
    console.error("[billing] billing email save failed:", e);
    redirect("/dashboard/billing?error=email_save");
  }
  if (cb.stripeCustomerId) {
    await getStripe()
      .customers.update(cb.stripeCustomerId, { email })
      .catch((e) => console.warn("[billing] customer email update failed:", e));
  }
  redirect("/dashboard/billing?notice=email_saved");
}
