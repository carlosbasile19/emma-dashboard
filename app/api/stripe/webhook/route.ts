import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { billingFeatureEnabled } from "@/lib/billing/config";
import { handleStripeEvent } from "@/lib/billing/webhooks";
import { getRequestOrigin } from "@/lib/origin";
import { getStripe, stripeLivemode } from "@/lib/stripe/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Stripe webhook endpoint. The raw body is needed for signature verification, so this handler
 * reads `req.text()` and never the parsed JSON. `api/*` is outside the auth middleware; the
 * signature IS the authentication.
 */
export async function POST(req: Request): Promise<Response> {
  if (!billingFeatureEnabled()) {
    // Acknowledge so Stripe doesn't retry forever against a deploy that has billing off.
    return NextResponse.json({ ok: true, ignored: "billing disabled" });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "misconfigured", message: "STRIPE_WEBHOOK_SECRET is not set" }, { status: 500 });
  }
  const payload = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch (e) {
    console.warn("[stripe-webhook] bad signature:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }
  // A live event hitting a sandbox-keyed deploy (or vice versa) is acknowledged and dropped.
  if (event.livemode !== stripeLivemode()) {
    return NextResponse.json({ ok: true, ignored: "livemode mismatch" });
  }
  try {
    await handleStripeEvent(event, await getRequestOrigin());
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[stripe-webhook] %s failed:", event.type, e);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
