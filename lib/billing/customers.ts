import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeLivemode } from "@/lib/stripe/client";
import {
  loadClientBilling,
  updateClientBillingColumns,
  upsertClientBilling,
  type CardOnFile,
} from "./config";
import { notifyCardRemoved } from "./notify";

/**
 * One Stripe Customer per workspace and exactly one card on file. Stripe is the source of
 * truth; `client_billing` holds a mirror (brand, last4, expiry) so pages never call Stripe to
 * render, and webhooks keep the mirror current.
 */

export function cardMirrorFromPaymentMethod(
  pm: Stripe.PaymentMethod,
  addedAt: string | null,
): CardOnFile {
  return {
    paymentMethodId: pm.id,
    brand: pm.card?.brand ?? null,
    last4: pm.card?.last4 ?? null,
    expMonth: pm.card?.exp_month ?? null,
    expYear: pm.card?.exp_year ?? null,
    addedAt,
  };
}

async function clientName(clientId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("olivia_clients")
    .select("name")
    .eq("olivia_client_id", clientId)
    .maybeSingle();
  return (data?.name as string | null) ?? clientId;
}

/**
 * The client's Stripe Customer id, created on first use. A customer created under the OTHER
 * key mode (sandbox vs live) is treated as absent and a fresh one is created, so sandbox state
 * never leaks into live billing. No idempotency key is sent: a fixed key would make Stripe replay
 * the cached response for 24h, so a customer deleted on Stripe (customer.deleted → clearCustomer)
 * would be handed back on re-enable, and changed name/email would raise idempotency_error. The
 * DB unique constraint on stripe_customer_id plus the re-read below blunt the concurrent-create
 * race; an orphan empty customer on Stripe is harmless.
 */
export async function ensureCustomer(clientId: string): Promise<string> {
  const live = stripeLivemode();
  const cb = (await loadClientBilling(clientId)) ?? (await upsertClientBilling(clientId, {}, null));
  if (cb.stripeCustomerId && cb.stripeLivemode === live) return cb.stripeCustomerId;
  const customer = await getStripe().customers.create(
    {
      name: await clientName(clientId),
      email: cb.billingEmail ?? undefined,
      description: "Emma workspace",
      metadata: { emma_client_id: clientId },
    },
  );
  await updateClientBillingColumns(clientId, {
    stripe_customer_id: customer.id,
    stripe_livemode: live,
    default_payment_method_id: null,
    card_brand: null,
    card_last4: null,
    card_exp_month: null,
    card_exp_year: null,
    card_added_at: null,
  });
  return customer.id;
}

/** Persist (or clear) the card mirror. Clearing stamps `card_removed_at`. */
export async function writeCardMirror(clientId: string, card: CardOnFile | null): Promise<void> {
  await updateClientBillingColumns(
    clientId,
    card
      ? {
          default_payment_method_id: card.paymentMethodId,
          card_brand: card.brand,
          card_last4: card.last4,
          card_exp_month: card.expMonth,
          card_exp_year: card.expYear,
          card_added_at: card.addedAt ?? new Date().toISOString(),
          card_removed_at: null,
        }
      : {
          default_payment_method_id: null,
          card_brand: null,
          card_last4: null,
          card_exp_month: null,
          card_exp_year: null,
          card_removed_at: new Date().toISOString(),
        },
  );
}

/**
 * Make `paymentMethodId` the card on file: Stripe's default for invoices, the local mirror,
 * and every OTHER card detached so "remove" always means "no card". The mirror is written
 * BEFORE the old cards are detached, so the `payment_method.detached` webhooks they trigger see
 * a different card on file and are ignored.
 */
export async function setDefaultCard(clientId: string, paymentMethodId: string): Promise<CardOnFile> {
  const stripe = getStripe();
  const customerId = await ensureCustomer(clientId);
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  const owner = typeof pm.customer === "string" ? pm.customer : (pm.customer?.id ?? null);
  if (owner !== customerId) throw new Error("payment method does not belong to this client's customer");
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: pm.id },
  });
  const card = cardMirrorFromPaymentMethod(pm, new Date().toISOString());
  await writeCardMirror(clientId, card);
  const others = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 100 });
  for (const other of others.data) {
    if (other.id !== pm.id) {
      await stripe.paymentMethods.detach(other.id).catch((e) => {
        console.warn("[billing] detaching a replaced card failed:", e);
      });
    }
  }
  return card;
}

/** Re-read a card from Stripe into the mirror (issuer-refreshed expiry, default changed in Stripe). */
export async function refreshCardMirror(clientId: string, paymentMethodId: string): Promise<void> {
  const cb = await loadClientBilling(clientId);
  if (!cb) return;
  const pm = await getStripe().paymentMethods.retrieve(paymentMethodId);
  const owner = typeof pm.customer === "string" ? pm.customer : (pm.customer?.id ?? null);
  if (owner !== cb.stripeCustomerId) {
    // A detached or foreign card must not be re-mirrored (a late payment_method.updated can
    // arrive after a removal). Clear only if it is the card the mirror currently shows.
    if (paymentMethodId === cb.card?.paymentMethodId) await writeCardMirror(clientId, null);
    return;
  }
  await writeCardMirror(
    clientId,
    cardMirrorFromPaymentMethod(pm, cb.card?.addedAt ?? new Date().toISOString()),
  );
}

/**
 * Remove the card on file (member or admin). Returns false when there was none.
 *
 * The mirror is cleared BEFORE the detach, so the `payment_method.detached` webhook finds no
 * card on file and stays silent; this function emails the admins itself. A card removed inside
 * the Stripe dashboard takes the other path (mirror still set → the webhook clears it and
 * emails). Either way a removal notifies exactly once. This deviates from the spec's "the
 * webhook is the single notification place": racing our own clear against Stripe's delivery
 * made that unreliable.
 *
 * The mirror stays cleared even if the detach fails (invoicing gates on the mirror, so a
 * cleared mirror is never charged). A failed detach throws and sends no notification, so the
 * caller surfaces the error instead of reporting a removal that did not happen in Stripe.
 */
export async function removeCard(clientId: string, origin: string): Promise<boolean> {
  const cb = await loadClientBilling(clientId);
  const pmId = cb?.card?.paymentMethodId;
  if (!pmId) return false;
  await writeCardMirror(clientId, null);
  try {
    await getStripe().paymentMethods.detach(pmId);
  } catch (e) {
    throw new Error(
      `Card could not be removed from Stripe: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  await notifyCardRemoved(clientId, "removed", origin);
  return true;
}

/** Stripe reported the customer deleted: forget it and the card. The next enable recreates it. */
export async function clearCustomer(clientId: string): Promise<void> {
  await updateClientBillingColumns(clientId, {
    stripe_customer_id: null,
    stripe_livemode: null,
    default_payment_method_id: null,
    card_brand: null,
    card_last4: null,
    card_exp_month: null,
    card_exp_year: null,
    card_removed_at: new Date().toISOString(),
  });
}
