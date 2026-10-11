import "server-only";
import Stripe from "stripe";

let client: Stripe | null = null;

/**
 * Server-only Stripe SDK singleton. The API version is the one bundled with the installed SDK
 * (pinned by package.json), so an SDK upgrade is the only way the version moves.
 */
export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!/^(sk|rk)_(live|test)_/.test(key)) throw new Error("Unrecognised STRIPE_SECRET_KEY prefix");
  client = new Stripe(key, { appInfo: { name: "Hey Emma dashboard" } });
  return client;
}

/**
 * True when the configured key is a live key (secret `sk_live_` or restricted `rk_live_`). Every Stripe-linked row we write carries this
 * flag, and a customer created under the other mode is treated as absent, so sandbox state
 * can never be charged against live keys (or vice versa).
 */
export function stripeLivemode(): boolean {
  return /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "");
}
