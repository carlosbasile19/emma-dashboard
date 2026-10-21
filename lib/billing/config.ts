import "server-only";
import { cache } from "react";
import { getSessionClientId, PLATFORM_ADMIN_ROLE } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  effectiveMarkupBps,
  isFeeCurrency,
  isValidAnchorDay,
  isValidBps,
  isValidFeeCents,
  type FeeCurrency,
} from "./money";

/**
 * Billing configuration: the platform defaults row and one row per client, read through the
 * service role (these tables have no RLS policies). `get*` variants are React `cache()`d so a
 * page that asks three times pays one query; after a WRITE use the `load*` variant, which
 * always hits the database.
 */

export function billingFeatureEnabled(): boolean {
  return process.env.BILLING_ENABLED === "true";
}

/**
 * Markup is a future feature. While this is off, the effective markup is 0 everywhere (invoices,
 * estimates, dashboard spend) and the console shows no markup controls; stored values are kept.
 */
export function billingMarkupEnabled(): boolean {
  return process.env.BILLING_MARKUP_ENABLED === "true";
}

/**
 * The agency's defaults. There is deliberately no default service fee: the fee is each client's
 * retail price, set per client, and Emma's wholesale price never lives in this app.
 */
export interface BillingSettings {
  markupBps: number;
  /** Service-fee charge day (1–28). */
  anchorDay: number;
  /** Default service-fee currency. */
  feeCurrency: FeeCurrency;
  /** Default early-charge threshold for unbilled credits, USD cents; null = off. */
  lowBalanceCents: number | null;
  /** Default agency billing contact; null = the earliest platform admin. */
  alertEmail: string | null;
  updatedAt: string | null;
}

export const DEFAULT_SETTINGS: BillingSettings = {
  markupBps: 0,
  anchorDay: 3,
  feeCurrency: "usd",
  lowBalanceCents: null,
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
  /** Per-client values; null = agency default (fee: no fee; lowBalance 0 = off for this client). */
  overrides: {
    markupBps: number | null;
    feeCents: number | null;
    feeCurrency: FeeCurrency | null;
    anchorDay: number | null;
    lowBalanceCents: number | null;
  };
  /** What actually applies to this client. */
  effective: {
    markupBps: number;
    /** The agency's retail service fee in `feeCurrency` cents; 0 = none. */
    feeCents: number;
    feeCurrency: FeeCurrency;
    anchorDay: number;
    /** Early-charge threshold for unbilled credits (USD cents); null = off. */
    lowBalanceCents: number | null;
  };
  /** Agency-side contact as stored; null = the agency default (see `agencyContactFor`). */
  agencyContactEmail: string | null;
  suspension: { at: string; reason: string | null; invoiceRowId: string | null; servicePausedAt: string | null } | null;
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
  const { data, error } = await admin
    .from("billing_settings")
    .select("markup_bps, anchor_day, fee_currency, low_balance_cents, alert_email, updated_at")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`billing_settings read failed: ${error.message}`);
  if (!data) return DEFAULT_SETTINGS;
  return {
    markupBps: num(data.markup_bps) ?? 0,
    anchorDay: num(data.anchor_day) ?? 3,
    feeCurrency: isFeeCurrency(data.fee_currency) ? data.fee_currency : "usd",
    lowBalanceCents: num(data.low_balance_cents),
    alertEmail: text(data.alert_email),
    updatedAt: text(data.updated_at),
  };
}

export const getBillingSettings = cache(loadBillingSettings);

const CLIENT_COLS =
  "olivia_client_id, enabled, stripe_customer_id, stripe_livemode, billing_email, bill_from_month, " +
  "markup_bps, fee_cents, anchor_day, default_payment_method_id, card_brand, card_last4, " +
  "card_exp_month, card_exp_year, card_added_at, card_removed_at, no_card_alerted_month, updated_at, " +
  "fee_currency, low_balance_cents, agency_contact_email, suspended_at, suspended_reason, " +
  "suspended_invoice_id, service_paused_at";

export function rowToClientBilling(r: Row, s: BillingSettings): ClientBilling {
  const pm = text(r.default_payment_method_id);
  const overrides = {
    markupBps: num(r.markup_bps),
    feeCents: num(r.fee_cents),
    feeCurrency: isFeeCurrency(r.fee_currency) ? r.fee_currency : null,
    anchorDay: num(r.anchor_day),
    lowBalanceCents: num(r.low_balance_cents),
  };
  const suspendedAt = text(r.suspended_at);
  return {
    clientId: String(r.olivia_client_id),
    enabled: r.enabled === true,
    stripeCustomerId: text(r.stripe_customer_id),
    stripeLivemode: typeof r.stripe_livemode === "boolean" ? r.stripe_livemode : null,
    billingEmail: text(r.billing_email),
    billFromMonth: text(r.bill_from_month),
    overrides,
    effective: {
      markupBps: effectiveMarkupBps(overrides.markupBps, s.markupBps, billingMarkupEnabled()),
      feeCents: overrides.feeCents ?? 0,
      feeCurrency: overrides.feeCurrency ?? s.feeCurrency,
      anchorDay: overrides.anchorDay ?? s.anchorDay,
      lowBalanceCents: effectiveThreshold(overrides.lowBalanceCents, s.lowBalanceCents),
    },
    agencyContactEmail: text(r.agency_contact_email),
    suspension: suspendedAt
      ? {
          at: suspendedAt,
          reason: text(r.suspended_reason),
          invoiceRowId: text(r.suspended_invoice_id),
          servicePausedAt: text(r.service_paused_at),
        }
      : null,
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
  const [settings, { data, error }] = await Promise.all([
    loadBillingSettings(),
    admin.from("client_billing").select(CLIENT_COLS).eq("olivia_client_id", clientId).maybeSingle(),
  ]);
  if (error) throw new Error(`client_billing read failed: ${error.message}`);
  return data ? rowToClientBilling(data as unknown as Row, settings) : null;
}

export const getClientBilling = cache(loadClientBilling);

/** A client threshold of 0 switches it off; null inherits the agency default. */
export function effectiveThreshold(override: number | null, agencyDefault: number | null): number | null {
  const v = override ?? agencyDefault;
  return v != null && v > 0 ? v : null;
}

/**
 * The service fee and charge day a client is on: its effective values, or the agency defaults
 * (no fee) while it has no billing row yet (a card can be saved before anything is configured).
 */
export function chargeTerms(
  cb: ClientBilling | null,
  s: BillingSettings,
): { feeCents: number; feeCurrency: FeeCurrency; anchorDay: number } {
  return cb
    ? { feeCents: cb.effective.feeCents, feeCurrency: cb.effective.feeCurrency, anchorDay: cb.effective.anchorDay }
    : { feeCents: 0, feeCurrency: s.feeCurrency, anchorDay: s.anchorDay };
}

/**
 * The agency's default billing contact: the alerts email when set, else the earliest platform
 * admin (the agency owner). null only when the agency has no admin at all.
 */
export async function defaultAgencyContact(s?: BillingSettings): Promise<string | null> {
  const settings = s ?? (await loadBillingSettings());
  if (settings.alertEmail) return settings.alertEmail.toLowerCase();
  const admin = createAdminClient();
  const { data: member } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("role", PLATFORM_ADMIN_ROLE)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!member) return null;
  const { data } = await admin.auth.admin.getUserById(member.user_id as string);
  return data.user?.email?.toLowerCase() ?? null;
}

/** Where this client's agency-side billing mail goes: its own contact, else the agency default. */
export async function agencyContactFor(cb: ClientBilling | null): Promise<string | null> {
  return cb?.agencyContactEmail ?? (await defaultAgencyContact());
}

/**
 * The default billing contact: the workspace's earliest-mapped CLIENT member. Platform admins
 * are mapped to a home workspace too, so they are skipped — an agency email must never become
 * a client's billing contact.
 */
export async function defaultBillingEmail(clientId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: member } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("olivia_client_id", clientId)
    .neq("role", PLATFORM_ADMIN_ROLE)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!member) return null;
  const { data } = await admin.auth.admin.getUserById(member.user_id as string);
  return data.user?.email?.toLowerCase() ?? null;
}

export async function listClientBilling(): Promise<ClientBilling[]> {
  const admin = createAdminClient();
  const [settings, { data, error }] = await Promise.all([
    loadBillingSettings(),
    admin.from("client_billing").select(CLIENT_COLS),
  ]);
  if (error) throw new Error(`client_billing list failed: ${error.message}`);
  return (data ?? []).map((r) => rowToClientBilling(r as unknown as Row, settings));
}

export async function clientIdForCustomer(customerId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("client_billing")
    .select("olivia_client_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) throw new Error(`client_billing customer lookup failed: ${error.message}`);
  return text(data?.olivia_client_id);
}

export async function clientIdForPaymentMethod(paymentMethodId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("client_billing")
    .select("olivia_client_id")
    .eq("default_payment_method_id", paymentMethodId)
    .maybeSingle();
  if (error) throw new Error(`client_billing payment method lookup failed: ${error.message}`);
  return text(data?.olivia_client_id);
}

export interface ClientBillingPatch {
  enabled?: boolean;
  billingEmail?: string | null;
  billFromMonth?: string | null;
  markupBps?: number | null;
  feeCents?: number | null;
  feeCurrency?: FeeCurrency | null;
  anchorDay?: number | null;
  lowBalanceCents?: number | null;
  agencyContactEmail?: string | null;
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
  if (patch.feeCurrency != null && !isFeeCurrency(patch.feeCurrency)) throw new RangeError("invalid currency");
  if (patch.lowBalanceCents != null && !isValidFeeCents(patch.lowBalanceCents)) throw new RangeError("invalid threshold");
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
  if (patch.feeCurrency !== undefined) cols.fee_currency = patch.feeCurrency;
  if (patch.lowBalanceCents !== undefined) cols.low_balance_cents = patch.lowBalanceCents;
  if (patch.agencyContactEmail !== undefined) cols.agency_contact_email = patch.agencyContactEmail;
  const { error } = await admin.from("client_billing").upsert(cols, { onConflict: "olivia_client_id" });
  if (error) throw new Error(`client_billing upsert failed: ${error.message}`);
  const row = await loadClientBilling(clientId);
  if (!row) throw new Error("client_billing row missing after upsert");
  return row;
}

/**
 * Set the billing contact only when the client has none: a conditional update, so a contact a
 * member or admin already chose is never overwritten. Returns the row when this call set it.
 */
export async function claimBillingContact(clientId: string, email: string): Promise<ClientBilling | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("client_billing")
    .update({ billing_email: email.toLowerCase(), updated_at: new Date().toISOString() })
    .eq("olivia_client_id", clientId)
    .is("billing_email", null)
    .select("olivia_client_id");
  if (error) throw new Error(`client_billing contact claim failed: ${error.message}`);
  return data && data.length > 0 ? loadClientBilling(clientId) : null;
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
  patch: {
    markupBps?: number;
    anchorDay?: number;
    feeCurrency?: FeeCurrency;
    lowBalanceCents?: number | null;
    alertEmail?: string | null;
  },
  userId: string | null,
): Promise<void> {
  if (patch.markupBps !== undefined && !isValidBps(patch.markupBps)) throw new RangeError("invalid markup");
  if (patch.anchorDay !== undefined && !isValidAnchorDay(patch.anchorDay)) throw new RangeError("invalid anchor day");
  if (patch.feeCurrency !== undefined && !isFeeCurrency(patch.feeCurrency)) throw new RangeError("invalid currency");
  if (patch.lowBalanceCents != null && (!isValidFeeCents(patch.lowBalanceCents) || patch.lowBalanceCents === 0)) {
    throw new RangeError("invalid threshold");
  }
  const admin = createAdminClient();
  const cols: Row = { id: 1, updated_at: new Date().toISOString(), updated_by: userId };
  if (patch.markupBps !== undefined) cols.markup_bps = patch.markupBps;
  if (patch.anchorDay !== undefined) cols.anchor_day = patch.anchorDay;
  if (patch.feeCurrency !== undefined) cols.fee_currency = patch.feeCurrency;
  if (patch.lowBalanceCents !== undefined) cols.low_balance_cents = patch.lowBalanceCents;
  if (patch.alertEmail !== undefined) cols.alert_email = patch.alertEmail;
  const { error } = await admin.from("billing_settings").upsert(cols, { onConflict: "id" });
  if (error) throw new Error(`billing_settings upsert failed: ${error.message}`);
}

/**
 * The multiplier for the ACTIVE client's dashboard figures: 0 unless billing and markup are both
 * on and billing is enabled for that workspace. Never throws — a billing lookup must not take
 * the overview page down.
 */
export async function activeMarkupBps(): Promise<number> {
  if (!billingFeatureEnabled() || !billingMarkupEnabled()) return 0;
  try {
    const cb = await getClientBilling(await getSessionClientId());
    return cb?.enabled ? cb.effective.markupBps : 0;
  } catch {
    return 0;
  }
}
