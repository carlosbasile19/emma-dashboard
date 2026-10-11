"use server";

import { redirect } from "next/navigation";
import { billingFeatureEnabled } from "@/lib/billing/config";
import { createCheckoutSession, getSetupLink } from "@/lib/billing/setup";
import { getRequestOrigin } from "@/lib/origin";

/**
 * Public, token-gated: start a Checkout session for the link's client. Only this click creates
 * a session — a page view never does, so a crawled link cannot mint sessions. The token is the
 * bearer credential; it must be pending and unexpired. Automatic billing need not be on yet:
 * saving a card never charges anything by itself.
 */
export async function startLinkCheckout(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!token || !billingFeatureEnabled()) redirect("/login");
  const path = `/billing/setup/${encodeURIComponent(token)}`;
  const found = await getSetupLink(token);
  if (!found || found.state !== "valid") redirect(path);
  const origin = await getRequestOrigin();
  let url: string;
  try {
    url = await createCheckoutSession({
      clientId: found.link.clientId,
      setupToken: token,
      successUrl: `${origin}${path}?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}${path}?setup=cancelled`,
    });
  } catch (e) {
    // Stripe outage or the link being revoked mid-click: show a retry banner, not the error page.
    // Never log the token.
    console.error("[billing] checkout start failed", {
      clientId: found.link.clientId,
      message: e instanceof Error ? e.message : String(e),
    });
    redirect(`${path}?error=failed`);
  }
  redirect(url);
}
