"use server";

import { redirect } from "next/navigation";
import { billingFeatureEnabled, loadClientBilling } from "@/lib/billing/config";
import { createCheckoutSession, getSetupLink } from "@/lib/billing/setup";
import { getRequestOrigin } from "@/lib/origin";

/**
 * Public, token-gated: start a Checkout session for the link's client. Only this click creates
 * a session — a page view never does, so a crawled link cannot mint sessions. The token is the
 * bearer credential; it must be pending and unexpired, and the workspace must have billing on.
 */
export async function startLinkCheckout(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!token || !billingFeatureEnabled()) redirect("/login");
  const path = `/billing/setup/${encodeURIComponent(token)}`;
  const found = await getSetupLink(token);
  if (!found || found.state !== "valid") redirect(path);
  const cb = await loadClientBilling(found.link.clientId);
  if (!cb?.enabled) redirect(`${path}?error=disabled`);
  const origin = await getRequestOrigin();
  const url = await createCheckoutSession({
    clientId: found.link.clientId,
    setupToken: token,
    successUrl: `${origin}${path}?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}${path}?setup=cancelled`,
  });
  redirect(url);
}
