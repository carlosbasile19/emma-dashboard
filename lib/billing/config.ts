import "server-only";
import { cache } from "react";
import { getSessionClientId } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidAnchorDay, isValidBps, isValidFeeCents } from "./money";

/**
 * Billing configuration: the platform defaults row and one row per client, read through the
 * service role (these tables have no RLS policies). `get*` variants are React `cache()`d so a
 * page that asks three times pays one query; after a WRITE use the `load*` variant, which
 * always hits the database.
 */

export function billingFeatureEnabled(): boolean {
  return process.env.BILLING_ENABLED === "true";
}

export interface BillingSettings {
  markupBps: number;
  feeCents: number;
  anchorDay: number;
  currency: string;
  alertEmail: string | null;
  updatedAt: string | null;
}

export const DEFAULT_SETTINGS: BillingSettings = {
  markupBps: 0,
  feeCents: 0,
  anchorDay: 3,
  currency: "usd",
  alertEmail: null,
  updatedAt: null,
};

export interface CardOnFile {
  paymentMethodId: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  addedAt: string | null;
}

export interface ClientBilling {
  clientId: string;
  enabled: boolean;
  stripeCustomerId: string | null;
  /** The key mode the customer was created under; a mismatch with the current key = no customer. */
  stripeLivemode: boolean | null;
  billingEmail: string | null;
  billFromMonth: string | null;
  /** Per-client overrides; null = platform default. */
  overrides: { markupBps: number | null; feeCents: number | null; anchorDay: number | null };
  /** What actually applies to this client. */
  effective: { markupBps: number; feeCents: number; anchorDay: number; currency: string };
  card: CardOnFile | null;
  cardRemovedAt: string | null;
  noCardAlertedMonth: string | null;
  updatedAt: string | null;
}

type Row = Record<string, unknown>;

const num = (v: unknown): number | null =>
  typeof v === "number" ? v : v == null ? null : Number(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export async function loadBillingSettings(): Promise<BillingSettings> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("billing_settings")
    .select("markup_bps, fee_cents, anchor_day, currency, alert_email, updated_at")
    .eq("id", 1)
    .maybeSingle();
  if (!data) return DEFAULT_SETTINGS;
  return {
    markupBps: num(data.markup_bps) ?? 0,
    feeCents: num(data.fee_cents) ?? 0,
    anchorDay: num(data.anchor_day) ?? 3,
    currency: text(data.currency) ?? "usd",
    alertEmail: text(data.alert_email),
    updatedAt: text(data.updated_at),
  };
}

export const getBillingSettings = cache(loadBillingSettings);

const CLIENT_COLS =
  "olivia_client_id, enabled, stripe_customer_id, stripe_livemode, billing_email, bill_from_month, " +
  "markup_bps, fee_cents, anchor_day, default_payment_method_id, card_brand, card_last4, " +
  "card_exp_month, card_exp_year, card_added_at, card_removed_at, no_card_alerted_month, updated_at";

export function rowToClientBilling(r: Row, s: BillingSettings): ClientBilling {
  const pm = text(r.default_payment_method_id);
  const overrides = {
    markupBps: num(r.markup_bps),
    feeCents: num(r.fee_cents),
    anchorDay: num(r.anchor_day),
  };
  return {
    clientId: String(r.olivia_client_id),
    enabled: r.enabled === true,
    stripeCustomerId: text(r.stripe_customer_id),
    stripeLivemode: typeof r.stripe_livemode === "boolean" ? r.stripe_livemode : null,
    billingEmail: text(r.billing_email),
    billFromMonth: text(r.bill_from_month),
    overrides,
    effective: {
      markupBps: overrides.markupBps ?? s.markupBps,
      feeCents: overrides.feeCents ?? s.feeCents,
      anchorDay: overrides.anchorDay ?? s.anchorDay,
      currency: s.currency,
    },
    card: pm
      ? {
          paymentMethodId: pm,
          brand: text(r.card_brand),
          last4: text(r.card_last4),
          expMonth: num(r.card_exp_month),
          expYear: num(r.card_exp_year),
          addedAt: text(r.card_added_at),
        }
      : null,
    cardRemovedAt: text(r.card_removed_at),
    noCardAlertedMonth: text(r.no_card_alerted_month),
    updatedAt: text(r.updated_at),
  };
}

export async function loadClientBilling(clientId: string): Promise<ClientBilling | null> {
  const admin = createAdminClient();
  const [settings, { data }] = await Promise.all([
    loadBillingSettings(),
    admin.from("client_billing").select(CLIENT_COLS).eq("olivia_client_id", clientId).maybeSingle(),
  ]);
  return data ? rowToClientBilling(data as unknown as Row, settings) : null;
}

export const getClientBilling = cache(loadClientBilling);

export async function listClientBilling(): Promise<ClientBilling[]> {
  const admin = createAdminClient();
  const [settings, { data }] = await Promise.all([
    loadBillingSettings(),
    admin.from("client_billing").select(CLIENT_COLS),
  ]);
  return (data ?? []).map((r) => rowToClientBilling(r as unknown as Row, settings));
}

export async function clientIdForCustomer(customerId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("client_billing")
    .select("olivia_client_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return text(data?.olivia_client_id);
}

export async function clientIdForPaymentMethod(paymentMethodId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("client_billing")
    .select("olivia_client_id")
    .eq("default_payment_method_id", paymentMethodId)
    .maybeSingle();
  return text(data?.olivia_client_id);
}

export interface ClientBillingPatch {
  enabled?: boolean;
  billingEmail?: string | null;
  billFromMonth?: string | null;
  markupBps?: number | null;
  feeCents?: number | null;
  anchorDay?: number | null;
}

/**
 * Create or update a client's row. Only the keys present in `patch` change (an omitted key is
 * untouched; an explicit null clears an override). Ranges are re-validated here so a caller
 * that forgot to parse cannot store garbage.
 */
export async function upsertClientBilling(
  clientId: string,
  patch: ClientBillingPatch,
  userId: string | null,
): Promise<ClientBilling> {
  if (patch.markupBps != null && !isValidBps(patch.markupBps)) throw new RangeError("invalid markup");
  if (patch.feeCents != null && !isValidFeeCents(patch.feeCents)) throw new RangeError("invalid fee");
  if (patch.anchorDay != null && !isValidAnchorDay(patch.anchorDay)) throw new RangeError("invalid anchor day");
  const admin = createAdminClient();
  const cols: Row = {
    olivia_client_id: clientId,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  if (patch.enabled !== undefined) cols.enabled = patch.enabled;
  if (patch.billingEmail !== undefined) cols.billing_email = patch.billingEmail;
  if (patch.billFromMonth !== undefined) cols.bill_from_month = patch.billFromMonth;
  if (patch.markupBps !== undefined) cols.markup_bps = patch.markupBps;
  if (patch.feeCents !== undefined) cols.fee_cents = patch.feeCents;
  if (patch.anchorDay !== undefined) cols.anchor_day = patch.anchorDay;
  const { error } = await admin.from("client_billing").upsert(cols, { onConflict: "olivia_client_id" });
  if (error) throw new Error(`client_billing upsert failed: ${error.message}`);
  const row = await loadClientBilling(clientId);
  if (!row) throw new Error("client_billing row missing after upsert");
  return row;
}

/** Raw column update for the card mirror / customer id. customers.ts owns these column names. */
export async function updateClientBillingColumns(clientId: string, cols: Row): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("client_billing")
    .update({ ...cols, updated_at: new Date().toISOString() })
    .eq("olivia_client_id", clientId);
  if (error) throw new Error(`client_billing update failed: ${error.message}`);
}

export async function saveBillingSettings(
  patch: { markupBps?: number; feeCents?: number; anchorDay?: number; alertEmail?: string | null },
  userId: string | null,
): Promise<void> {
  if (patch.markupBps !== undefined && !isValidBps(patch.markupBps)) throw new RangeError("invalid markup");
  if (patch.feeCents !== undefined && !isValidFeeCents(patch.feeCents)) throw new RangeError("invalid fee");
  if (patch.anchorDay !== undefined && !isValidAnchorDay(patch.anchorDay)) throw new RangeError("invalid anchor day");
  const admin = createAdminClient();
  const cols: Row = { id: 1, updated_at: new Date().toISOString(), updated_by: userId };
  if (patch.markupBps !== undefined) cols.markup_bps = patch.markupBps;
  if (patch.feeCents !== undefined) cols.fee_cents = patch.feeCents;
  if (patch.anchorDay !== undefined) cols.anchor_day = patch.anchorDay;
  if (patch.alertEmail !== undefined) cols.alert_email = patch.alertEmail;
  const { error } = await admin.from("billing_settings").upsert(cols, { onConflict: "id" });
  if (error) throw new Error(`billing_settings upsert failed: ${error.message}`);
}

/**
 * The multiplier for the ACTIVE client's dashboard figures: 0 unless the feature is on and
 * billing is enabled for that workspace. Never throws — a billing lookup must not take the
 * overview page down.
 */
export async function activeMarkupBps(): Promise<number> {
  if (!billingFeatureEnabled()) return 0;
  try {
    const cb = await getClientBilling(await getSessionClientId());
    return cb?.enabled ? cb.effective.markupBps : 0;
  } catch {
    return 0;
  }
}
