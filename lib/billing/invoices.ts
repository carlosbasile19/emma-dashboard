import "server-only";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { getUsageSeries } from "@/lib/olivia/usage";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeLivemode } from "@/lib/stripe/client";
import { dayLabel, monthBounds, monthLabel, shiftDay, sumRange } from "@/lib/usage";
import {
  listClientBilling,
  loadClientBilling,
  updateClientBillingColumns,
  type ClientBilling,
} from "./config";
import { composeInvoice, CREDITS_CURRENCY, type InvoiceLines } from "./money";
import {
  notifyNoCard,
  notifyPaymentFailed,
  notifyPaymentReceived,
  notifyRunSummary,
  notifyUsageUnavailable,
  type RunSummaryLine,
} from "./notify";
import { payInvoice, type PayOutcome } from "./pay";
import {
  creditsCursor,
  dueCreditPeriods,
  dueFeeMonths,
  earlyCreditPeriod,
  localDate,
  monthOf,
  nextFeeChargeDate,
  nextMonday,
  shouldAlertNoCard,
  thresholdCrossed,
  weekStart,
} from "./schedule";
import { createSetupLink, setupLinkUrl } from "./setup";
import {
  invoiceStatusFromStripe,
  isInvoiceStatus,
  isInvoiceStream,
  STREAM_LABEL,
  type InvoiceStatus,
  type InvoiceStream,
} from "./status";
import { maybeResume, onChargeFailed, runRetrySweep, type SweepResult } from "./suspension";

/**
 * The charges. `invoicePeriod` is the one path that creates a Stripe Invoice, for both streams:
 *   - credits      AI Power Credits (USD) for a run of closed days — the weekly Mon–Sun period,
 *                  or cursor → yesterday for a low-balance early charge;
 *   - service_fee  the agency's monthly service fee (its currency), in advance for a month.
 * The cron, the admin's "Charge now" and the livecheck all go through it. Each stream is its own
 * Stripe invoice with its own descriptor; both are charged to the same saved card.
 *
 * Billing-safety rules, in the order the code applies them:
 *   1. The (client, stream, period) row is RESERVED before Stripe is called — the unique constraint is
 *      the lock, so two runs can never bill a month twice and a crash leaves a visible row.
 *   2. Usage that fails to load is `null`: the reservation is released, admins are told, and
 *      tomorrow's run retries. Never $0.
 *   3. Every Stripe create carries an idempotency key built from the reservation id, so a replay
 *      within 24h returns the same objects and a fresh reservation never collides.
 *   4. Pay synchronously so the run reports a real outcome. A decline gets one retry, then the
 *      client is suspended (lib/billing/suspension.ts).
 */

export type ChargePeriod = { stream: "credits"; from: string; to: string } | { stream: "service_fee"; month: string };

export function periodKeyOf(p: ChargePeriod): string {
  return p.stream === "credits" ? p.from : p.month;
}

/** "6 Oct 2026 – 12 Oct 2026" for a credits period, "October 2026" for a fee month. */
export function periodLabel(stream: InvoiceStream, periodKey: string, periodTo: string | null): string {
  if (stream === "service_fee") return monthLabel(periodKey);
  if (!periodTo || periodTo === periodKey) return dayLabel(periodKey);
  return `${dayLabel(periodKey)} – ${dayLabel(periodTo)}`;
}

function chargeLabel(p: ChargePeriod): string {
  return periodLabel(p.stream, periodKeyOf(p), p.stream === "credits" ? p.to : null);
}

/** Card-statement descriptors (≤ 22 chars), one per stream so the client can tell them apart. */
const DESCRIPTOR: Record<InvoiceStream, string> = {
  credits: "HEY EMMA AI CREDITS",
  service_fee: "HEY EMMA SERVICE FEE",
};

export function tzOf(timezone: string | null | undefined): string {
  return timezone?.trim() || "UTC";
}

interface ClientInfo {
  id: string;
  name: string;
  timezone: string | null;
}

export async function loadClientsIndex(): Promise<Map<string, ClientInfo>> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("olivia_clients").select("olivia_client_id, name, timezone");
  if (error) throw new Error(`loadClientsIndex: ${error.message}`);
  return new Map(
    (data ?? []).map((c) => [
      c.olivia_client_id as string,
      {
        id: c.olivia_client_id as string,
        name: (c.name as string | null) ?? (c.olivia_client_id as string),
        timezone: (c.timezone as string | null) ?? null,
      },
    ]),
  );
}

export interface InvoiceRow {
  id: string;
  clientId: string;
  stream: InvoiceStream;
  /** credits: the period's first day; service_fee: the month. */
  periodKey: string;
  /** "6 Oct 2026 – 12 Oct 2026" / "October 2026". */
  periodLabel: string;
  periodMonth: string;
  periodFrom: string | null;
  periodTo: string | null;
  tz: string | null;
  rawUsageCents: number | null;
  markupBps: number | null;
  billedUsageCents: number | null;
  feeCents: number | null;
  totalCents: number | null;
  currency: string;
  stripeInvoiceId: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  status: InvoiceStatus;
  failureCode: string | null;
  failureMessage: string | null;
  trigger: string;
  livemode: boolean;
  createdAt: string;
  finalizedAt: string | null;
  paidAt: string | null;
  retryCount: number;
  nextRetryAt: string | null;
}

const INVOICE_COLS =
  "id, olivia_client_id, stream, period_key, retry_count, next_retry_at, period_month, period_from, period_to, tz, raw_usage_cents, markup_bps, " +
  "billed_usage_cents, fee_cents, total_cents, currency, stripe_invoice_id, hosted_invoice_url, " +
  "invoice_pdf_url, status, failure_code, failure_message, trigger, livemode, created_at, finalized_at, paid_at";

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" ? v : v == null ? null : Number(v));
const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const now = () => new Date().toISOString();

/** supabase-js reports write failures in `{ error }` rather than throwing. */
function must(label: string, res: { error: { message: string } | null }): void {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
}

/** A notification must never abort or reject a money path that has already charged or written status. */
async function safeNotify(what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`[billing] ${what} notification failed`, e);
  }
}

function rowToInvoice(r: Row): InvoiceRow {
  const status = String(r.status);
  const streamRaw = String(r.stream ?? "credits");
  const stream: InvoiceStream = isInvoiceStream(streamRaw) ? streamRaw : "credits";
  const periodKey = text(r.period_key) ?? String(r.period_month);
  return {
    id: String(r.id),
    clientId: String(r.olivia_client_id),
    stream,
    periodKey,
    periodLabel: periodLabel(stream, periodKey, text(r.period_to)),
    periodMonth: String(r.period_month),
    periodFrom: text(r.period_from),
    periodTo: text(r.period_to),
    tz: text(r.tz),
    rawUsageCents: num(r.raw_usage_cents),
    markupBps: num(r.markup_bps),
    billedUsageCents: num(r.billed_usage_cents),
    feeCents: num(r.fee_cents),
    totalCents: num(r.total_cents),
    currency: text(r.currency) ?? "usd",
    stripeInvoiceId: text(r.stripe_invoice_id),
    hostedInvoiceUrl: text(r.hosted_invoice_url),
    invoicePdfUrl: text(r.invoice_pdf_url),
    status: isInvoiceStatus(status) ? status : "open",
    failureCode: text(r.failure_code),
    failureMessage: text(r.failure_message),
    trigger: text(r.trigger) ?? "cron",
    livemode: r.livemode === true,
    createdAt: String(r.created_at),
    finalizedAt: text(r.finalized_at),
    paidAt: text(r.paid_at),
    retryCount: num(r.retry_count) ?? 0,
    nextRetryAt: text(r.next_retry_at),
  };
}

/** Newest first. */
export async function listInvoices(clientId?: string): Promise<InvoiceRow[]> {
  const admin = createAdminClient();
  let q = admin
    .from("billing_invoices")
    .select<string, Row>(INVOICE_COLS)
    .eq("livemode", stripeLivemode())
    .order("period_from", { ascending: false })
    .order("created_at", { ascending: false });
  if (clientId) q = q.eq("olivia_client_id", clientId);
  const { data, error } = await q;
  if (error) throw new Error(`listInvoices: ${error.message}`);
  return (data ?? []).map((r) => rowToInvoice(r));
}

export interface BilledPeriods {
  /** Service-fee months with a row. */
  feeMonths: string[];
  /** Last day of every billed credits period. */
  creditEnds: string[];
}

/**
 * Periods that count as "done" for scheduling, this Stripe mode only. A `reserved` row (a crashed
 * run) and a `failed` row with no Stripe invoice are NOT done: they resurface so recovery runs.
 */
export async function billedPeriodsByClient(clientId?: string): Promise<Map<string, BilledPeriods>> {
  const admin = createAdminClient();
  let q = admin
    .from("billing_invoices")
    .select("olivia_client_id, stream, period_key, period_to, status, stripe_invoice_id")
    .eq("livemode", stripeLivemode());
  if (clientId) q = q.eq("olivia_client_id", clientId);
  const { data, error } = await q;
  if (error) throw new Error(`billedPeriodsByClient: ${error.message}`);
  const out = new Map<string, BilledPeriods>();
  for (const r of data ?? []) {
    if (r.status === "reserved" || (r.status === "failed" && !r.stripe_invoice_id)) continue;
    const id = r.olivia_client_id as string;
    const entry = out.get(id) ?? { feeMonths: [], creditEnds: [] };
    if (r.stream === "service_fee") entry.feeMonths.push(r.period_key as string);
    else if (r.period_to) entry.creditEnds.push(r.period_to as string);
    out.set(id, entry);
  }
  return out;
}

/** The first unbilled credits day for one client. */
export async function creditsCursorFor(cb: ClientBilling, today: string): Promise<string> {
  const billed = (await billedPeriodsByClient(cb.clientId)).get(cb.clientId);
  return creditsCursor(cb.billFromMonth ?? monthOf(today), billed?.creditEnds ?? []);
}

export async function latestInvoiceByClient(): Promise<Map<string, InvoiceRow>> {
  const out = new Map<string, InvoiceRow>();
  for (const inv of await listInvoices()) if (!out.has(inv.clientId)) out.set(inv.clientId, inv);
  return out;
}

export interface BillingRunInfo {
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  counts: Record<string, number>;
}

export async function lastBillingRun(): Promise<BillingRunInfo | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("billing_runs")
    .select("trigger, started_at, finished_at, summary")
    .eq("livemode", stripeLivemode())
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`lastBillingRun: ${error.message}`);
  if (!data) return null;
  const summary = (data.summary as { counts?: Record<string, number> } | null) ?? null;
  return {
    trigger: String(data.trigger),
    startedAt: String(data.started_at),
    finishedAt: text(data.finished_at),
    counts: summary?.counts ?? {},
  };
}

// ---- Usage ----

/** Raw billed cents for a window, or null when it could not be loaded. */
export type UsageProvider = (clientId: string, tz: string, from: string, to: string) => Promise<number | null>;

/** The real thing: a fresh upstream read through the Usage report's seam. */
export const liveUsage: UsageProvider = async (clientId, tz, from, to) => {
  const series = await getUsageSeries(clientId, tz, from, to, { fresh: true });
  return series ? Math.round(sumRange(series.daily, from, to)) : null;
};

// ---- invoiceMonth ----

export type InvoiceOutcome =
  | "invoiced"
  | "skipped_zero"
  | "skipped_no_card"
  | "skipped_disabled"
  | "skipped_suspended"
  | "already_invoiced"
  | "usage_unavailable"
  | "error";

export interface InvoicePeriodResult {
  clientId: string;
  clientName: string;
  stream: InvoiceStream;
  periodKey: string;
  periodLabel: string;
  trigger: "cron" | "manual" | "threshold";
  outcome: InvoiceOutcome;
  status: InvoiceStatus | null;
  totalCents: number | null;
  stripeInvoiceId: string | null;
  hostedInvoiceUrl: string | null;
  error: string | null;
}

/** Throws on any Stripe error: recovery must fail CLOSED, never read an outage as "nothing exists". */
async function lookupExistingInvoice(
  stripe: Stripe,
  stripeInvoiceId: string | null,
  clientId: string,
  stream: InvoiceStream,
  periodKey: string,
): Promise<Stripe.Invoice | null> {
  if (stripeInvoiceId) return stripe.invoices.retrieve(stripeInvoiceId);
  const res = await stripe.invoices.search({
    query: `metadata['emma_client_id']:'${clientId}' AND metadata['emma_stream']:'${stream}' AND metadata['emma_period']:'${periodKey}'`,
    limit: 1,
  });
  return res.data[0] ?? null;
}

type Admin = ReturnType<typeof createAdminClient>;

interface ExistingRow {
  id: string;
  status: string;
  createdAt: string;
  stripeInvoiceId: string | null;
  livemode: boolean;
}

type Reservation =
  | { kind: "reserved"; rowId: string }
  | { kind: "exists"; row: ExistingRow }
  | { kind: "error"; message: string };

async function reservePeriod(admin: Admin, cols: Row, clientId: string, stream: InvoiceStream, periodKey: string): Promise<Reservation> {
  const { data, error } = await admin.from("billing_invoices").insert(cols).select("id").single();
  if (!error && data) return { kind: "reserved", rowId: String(data.id) };
  if (error?.code !== "23505") return { kind: "error", message: error?.message ?? "reserve failed" };
  const { data: row, error: readErr } = await admin
    .from("billing_invoices")
    .select("id, status, created_at, stripe_invoice_id, livemode")
    .eq("olivia_client_id", clientId)
    .eq("stream", stream)
    .eq("period_key", periodKey)
    .maybeSingle();
  if (readErr) return { kind: "error", message: readErr.message };
  if (!row) return { kind: "error", message: "reservation vanished" };
  return {
    kind: "exists",
    row: {
      id: String(row.id),
      status: String(row.status),
      createdAt: String(row.created_at),
      stripeInvoiceId: text(row.stripe_invoice_id),
      livemode: row.livemode === true,
    },
  };
}

/**
 * Take over an existing row for a new attempt. Conditional on the row still being exactly as we
 * read it, so two concurrent recoveries cannot both proceed. Returns false if someone else won.
 */
async function claimRow(admin: Admin, row: ExistingRow, fields: Row): Promise<boolean> {
  const { data, error } = await admin
    .from("billing_invoices")
    .update({ ...fields, created_at: now(), updated_at: now() })
    .eq("id", row.id)
    .eq("status", row.status)
    .eq("created_at", row.createdAt)
    .select("id");
  if (error) throw new Error(`claim row: ${error.message}`);
  return (data?.length ?? 0) === 1;
}

/** Statuses a webhook may have written that a later local write must never overwrite. */
const SETTLED = "(paid,void,uncollectible)";

/** A `reserved` row older than this came from a crashed run and is reconciled, not respected. */
const RESERVATION_STALE_MS = 60 * 60 * 1000;

/**
 * Undo a half-built Stripe invoice: a draft is deleted. Anything else (open, paid, void,
 * uncollectible) is left alone and its status reported — a finalised invoice is NEVER voided,
 * because a void row would make the month unbillable. Never swallows an error.
 */
async function cleanupStripeInvoice(
  stripe: Stripe,
  invoiceId: string,
): Promise<{ ok: true; removed: boolean; stripeStatus: string | null } | { ok: false; reason: string }> {
  try {
    const inv = await stripe.invoices.retrieve(invoiceId);
    if (inv.status === "draft") {
      await stripe.invoices.del(invoiceId);
      return { ok: true, removed: true, stripeStatus: "deleted" };
    }
    return { ok: true, removed: false, stripeStatus: inv.status };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function invoicePeriod(
  clientId: string,
  period: ChargePeriod,
  trigger: "cron" | "manual" | "threshold",
  opts: { usage?: UsageProvider; createdBy?: string | null; origin?: string } = {},
): Promise<InvoicePeriodResult> {
  const admin = createAdminClient();
  const stripe = getStripe();
  const live = stripeLivemode();
  const origin = opts.origin ?? "";
  const client = (await loadClientsIndex()).get(clientId);
  const clientName = client?.name ?? clientId;
  const stream = period.stream;
  const periodKey = periodKeyOf(period);
  const label = chargeLabel(period);
  /** The month this period belongs to: the no-card alert marker and the legacy column. */
  const month = period.stream === "credits" ? monthOf(period.to) : period.month;
  const result = (outcome: InvoiceOutcome, extra: Partial<InvoicePeriodResult> = {}): InvoicePeriodResult => ({
    clientId,
    clientName,
    stream,
    periodKey,
    periodLabel: label,
    trigger,
    outcome,
    status: null,
    totalCents: null,
    stripeInvoiceId: null,
    hostedInvoiceUrl: null,
    error: null,
    ...extra,
  });

  const cb = await loadClientBilling(clientId);
  if (!cb?.enabled) return result("skipped_disabled");
  // Suspended: no new charges until what is owed is paid (catch-up runs after the resume).
  if (cb.suspension) return result("skipped_suspended");
  // A customer from the other key mode (a sandbox session on the shared database, or vice versa)
  // is not "no card": never alert or touch the alert marker for it.
  if (cb.stripeCustomerId && cb.stripeLivemode !== live) {
    return result("skipped_disabled", { error: "Client is billed under the other Stripe mode" });
  }
  if (!cb.card || !cb.stripeCustomerId) {
    // Once per newly-due month (months run oldest first), never again on repeat runs.
    if (shouldAlertNoCard(month, cb.noCardAlertedMonth)) {
      await safeNotify("no-card", () => notifyNoCard(clientId, clientName, month, origin));
      await updateClientBillingColumns(clientId, { no_card_alerted_month: month });
    }
    return result("skipped_no_card");
  }

  const tz = tzOf(client?.timezone);
  const today = localDate(new Date(), tz);
  if (!cb.billFromMonth) return result("error", { error: "This client has no bill-from month" });
  if (period.stream === "credits") {
    // Only whole, closed days: today's usage is still accruing.
    if (period.to >= today || period.from > period.to) {
      return result("error", { error: "Credits can only be charged for closed days" });
    }
    if (period.from < `${cb.billFromMonth}-01`) {
      return result("error", { error: "Period starts before this client's bill-from month" });
    }
  } else {
    // In advance: the current month is billable, a future one is not.
    if (period.month > monthOf(today)) return result("error", { error: "A future month's fee cannot be charged yet" });
    if (period.month < cb.billFromMonth) return result("error", { error: "Month is before this client's bill-from month" });
    // No fee configured: nothing to raise, and no row, so a fee set later this month still bills it.
    if (cb.effective.feeCents === 0) return result("skipped_zero", { totalCents: 0 });
  }
  const { from, to } = period.stream === "credits" ? period : monthBounds(period.month);
  const currency = period.stream === "credits" ? CREDITS_CURRENCY : cb.effective.feeCurrency;
  const reserveCols: Row = {
    olivia_client_id: clientId,
    stream,
    period_key: periodKey,
    period_month: month,
    period_from: from,
    period_to: to,
    tz,
    currency,
    status: "reserved",
    trigger,
    created_by: opts.createdBy ?? null,
    livemode: live,
  };
  // One id per call: Stripe idempotency keys are scoped to this attempt, so a deleted draft's id is
  // never replayed. Cross-attempt safety comes from the unique row and the fail-closed recovery.
  const attemptId = randomUUID();

  // 1. Reserve the period (the unique constraint is the lock).
  const reservation = await reservePeriod(admin, reserveCols, clientId, stream, periodKey);
  if (reservation.kind === "error") return result("error", { error: reservation.message });

  let rowId: string;
  /** An open Stripe invoice found during recovery: skip straight to paying it. */
  let adopted: Stripe.Invoice | null = null;

  if (reservation.kind === "reserved") {
    rowId = reservation.rowId;
  } else {
    const { row } = reservation;
    if (row.livemode !== live) {
      return result("error", {
        error: `A ${row.livemode ? "live" : "sandbox"} invoice row already exists for this period; delete it before billing in this mode`,
      });
    }
    const stale = row.status === "reserved" && Date.now() - Date.parse(row.createdAt) > RESERVATION_STALE_MS;
    const stuckFailed = row.status === "failed" && !row.stripeInvoiceId;
    if (!stale && !stuckFailed) {
      return result("already_invoiced", {
        status: isInvoiceStatus(row.status) ? row.status : null,
        stripeInvoiceId: row.stripeInvoiceId,
      });
    }

    // 2. Recovery of a crashed / stuck row. Fails CLOSED: any Stripe lookup error leaves the row alone.
    let found: Stripe.Invoice | null;
    try {
      found = await lookupExistingInvoice(stripe, row.stripeInvoiceId, clientId, stream, periodKey);
    } catch (e) {
      console.error("[billing] recovery lookup failed", clientId, stream, periodKey, e);
      return result("error", { error: "Stripe lookup failed during recovery; row left untouched" });
    }
    const reservedFields = {
      // A recovered credits period may now end on a different day than the crashed attempt's.
      period_from: from,
      period_to: to,
      currency,
      status: "reserved",
      stripe_invoice_id: null,
      hosted_invoice_url: null,
      invoice_pdf_url: null,
      failure_code: null,
      failure_message: null,
      finalized_at: null,
      paid_at: null,
    };
    if (found && found.status === "open") {
      // Finalised but unpaid: adopt it and go to the pay step.
      const claimed = await claimRow(admin, row, {
        stripe_invoice_id: found.id,
        status: "open",
        total_cents: found.total,
        hosted_invoice_url: found.hosted_invoice_url ?? null,
        invoice_pdf_url: found.invoice_pdf ?? null,
        failure_code: null,
        failure_message: null,
      });
      if (!claimed) return result("already_invoiced", { stripeInvoiceId: found.id });
      rowId = row.id;
      adopted = found;
    } else if (found && found.status !== "draft") {
      // paid / void / uncollectible: record what Stripe says and stop.
      const status = invoiceStatusFromStripe(found.status);
      const paidSec = found.status_transitions?.paid_at ?? null;
      console.warn("[billing] recovered invoice", { clientId, stream, periodKey, stripeInvoiceId: found.id, status });
      const { error } = await admin
        .from("billing_invoices")
        .update({
          stripe_invoice_id: found.id,
          status,
          total_cents: found.total,
          hosted_invoice_url: found.hosted_invoice_url ?? null,
          invoice_pdf_url: found.invoice_pdf ?? null,
          paid_at: paidSec ? new Date(paidSec * 1000).toISOString() : null,
          updated_at: now(),
        })
        .eq("id", row.id);
      if (error) {
        return result("error", { error: `Recovered invoice ${found.id} (${status}) but the local write failed: ${error.message}` });
      }
      return result("already_invoiced", {
        status,
        stripeInvoiceId: found.id,
        totalCents: found.total,
        error: `Recovered ${found.status} invoice ${found.id} from a previous interrupted run`,
      });
    } else {
      // Nothing, or a draft that never finalised: delete the draft, then restart on the SAME row.
      if (found) {
        try {
          await stripe.invoices.del(found.id);
        } catch (e) {
          console.error("[billing] recovery could not delete draft", found.id, e);
          return result("error", { error: "Could not delete the abandoned draft invoice; row left untouched" });
        }
      }
      const claimed = await claimRow(admin, row, reservedFields);
      if (!claimed) return result("already_invoiced");
      rowId = row.id;
    }
  }

  // Everything below owns the row. Stripe-side id once we have one:
  let stripeInvoiceId: string | null = adopted?.id ?? null;
  let payReturned: PayOutcome | null = null;
  let payAttempted = false;
  /** True once the Stripe invoice is finalised (open): from then on it is never deleted or voided. */
  let finalizedOnStripe = adopted != null;

  try {
    let finalized: { id: string; hosted_invoice_url?: string | null; invoice_pdf?: string | null };
    let lines: InvoiceLines | null = null;

    if (adopted) {
      finalized = adopted;
    } else {
      if (period.stream === "credits") {
        // 3. Usage. null releases the reservation so tomorrow's run retries. Never $0.
        const raw = await (opts.usage ?? liveUsage)(clientId, tz, from, to);
        if (raw == null) {
          must("release reservation", await admin.from("billing_invoices").delete().eq("id", rowId));
          await safeNotify("usage-unavailable", () => notifyUsageUnavailable(clientId, clientName, label, origin));
          return result("usage_unavailable");
        }
        // 4. Lines. Markup once, on the period total; credits carry no fee.
        lines = composeInvoice(raw, cb.effective.markupBps, 0);
      } else {
        lines = composeInvoice(0, 0, cb.effective.feeCents);
      }
      const lineCols: Row = {
        raw_usage_cents: lines.rawUsageCents,
        markup_bps: lines.markupBps,
        billed_usage_cents: lines.billedUsageCents,
        fee_cents: lines.feeCents,
        total_cents: lines.totalCents,
      };
      if (lines.totalCents === 0) {
        must(
          "mark skipped_zero",
          await admin.from("billing_invoices").update({ ...lineCols, status: "skipped_zero", updated_at: now() }).eq("id", rowId),
        );
        return result("skipped_zero", { status: "skipped_zero", totalCents: 0 });
      }

      // 5. Stripe: draft with auto_advance OFF so Stripe never finalises or charges a half-built draft.
      const k = `emma:inv:${rowId}:${attemptId}`;
      const invoice = await stripe.invoices.create(
        {
          customer: cb.stripeCustomerId,
          collection_method: "charge_automatically",
          auto_advance: false,
          currency,
          pending_invoice_items_behavior: "exclude",
          description: `${STREAM_LABEL[stream]} · ${label}`,
          statement_descriptor: DESCRIPTOR[stream],
          metadata: { emma_client_id: clientId, emma_stream: stream, emma_period: periodKey },
        },
        { idempotencyKey: `${k}:create` },
      );
      stripeInvoiceId = invoice.id;
      // Record the id BEFORE adding lines so a crash leaves a row that points at the draft.
      must(
        "record stripe invoice id",
        await admin.from("billing_invoices").update({ ...lineCols, stripe_invoice_id: invoice.id, updated_at: now() }).eq("id", rowId),
      );
      // One line per invoice: the stream's own amount, in its own currency. Nothing else.
      await stripe.invoiceItems.create(
        {
          customer: cb.stripeCustomerId,
          invoice: invoice.id,
          amount: lines.totalCents,
          currency,
          description: `${STREAM_LABEL[stream]} · ${label}`,
        },
        { idempotencyKey: `${k}:${stream}` },
      );
      // Finalised invoices are immutable and complete, so letting Stripe keep retrying a decline is safe.
      finalized = await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: true }, { idempotencyKey: `${k}:finalize` });
      finalizedOnStripe = true;
      // Conditional: Stripe auto-collects a finalised invoice, so invoice.paid may already have
      // landed. Never flip a settled row back to open.
      const openWrite = await admin
        .from("billing_invoices")
        .update({
          stripe_invoice_id: finalized.id,
          hosted_invoice_url: finalized.hosted_invoice_url ?? null,
          invoice_pdf_url: finalized.invoice_pdf ?? null,
          status: "open",
          finalized_at: now(),
          updated_at: now(),
        })
        .eq("id", rowId)
        .not("status", "in", SETTLED)
        .select("id");
      must("mark open", openWrite);
      if ((openWrite.data?.length ?? 0) === 0) {
        // A webhook settled it first: report that, do not pay again.
        const { data: settled, error: readErr } = await admin.from("billing_invoices").select("status").eq("id", rowId).maybeSingle();
        if (readErr) throw new Error(`read settled row: ${readErr.message}`);
        const st = String(settled?.status ?? "");
        return result("invoiced", {
          status: isInvoiceStatus(st) ? st : null,
          totalCents: lines.totalCents,
          stripeInvoiceId: finalized.id,
          hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
        });
      }
    }

    // 6. Pay now so the run reports a real outcome.
    payAttempted = true;
    const outcome = await payInvoice(stripe, finalized.id, `emma:inv:${rowId}:${attemptId}:pay`);
    payReturned = outcome;
    const hostedInvoiceUrl = outcome.hostedInvoiceUrl ?? finalized.hosted_invoice_url ?? null;
    const totalCents = lines?.totalCents ?? adopted?.total ?? null;
    // Conditional: if the invoice.payment_failed webhook already recorded this status (and sent
    // the emails), this write changes nothing and must not notify a second time.
    const outcomeWrite = await admin
      .from("billing_invoices")
      .update({
        status: outcome.status,
        failure_code: outcome.failureCode,
        failure_message: outcome.failureMessage,
        paid_at: outcome.paidAt,
        hosted_invoice_url: hostedInvoiceUrl,
        invoice_pdf_url: outcome.invoicePdfUrl ?? finalized.invoice_pdf ?? null,
        updated_at: now(),
      })
      .eq("id", rowId)
      .neq("status", outcome.status)
      .select("id");
    must("record payment outcome", outcomeWrite);
    const outcomeChanged = (outcomeWrite.data?.length ?? 0) > 0;

    if (outcomeChanged && outcome.status === "paid") {
      await safeNotify("payment-received", () =>
        notifyPaymentReceived({ clientId, clientName, stream, periodLabel: label, totalCents: totalCents ?? 0, currency, origin }),
      );
    }
    if (outcomeChanged && (outcome.status === "failed" || outcome.status === "action_required")) {
      const failedKind = outcome.status;
      await onChargeFailed(rowId, origin);
      await safeNotify("payment-failed", async () =>
        notifyPaymentFailed({
          clientId,
          clientName,
          stream,
          periodLabel: label,
          currency,
          totalCents: totalCents ?? 0,
          reason: outcome.failureMessage ?? "Payment declined",
          kind: failedKind,
          origin,
          clientActionUrl: await clientActionUrl(clientId, failedKind, hostedInvoiceUrl, origin),
        }),
      );
    }
    return result("invoiced", { status: outcome.status, totalCents, stripeInvoiceId: finalized.id, hostedInvoiceUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    // A write that failed AFTER pay returned is not a decline and must not be undone.
    if (payReturned) {
      console.error("[billing] local write failed after pay", { rowId, stripeInvoiceId, status: payReturned.status }, e);
      return result("error", {
        stripeInvoiceId,
        error:
          payReturned.status === "paid"
            ? `Paid on Stripe (${stripeInvoiceId}) but the local write failed; the invoice.paid webhook will correct it`
            : `Payment attempted on Stripe (${stripeInvoiceId}) but the local write failed; webhooks will correct it`,
      });
    }

    // After finalisation the invoice is never deleted or voided (a void would leave the month
    // unbillable). A non-decline pay error is ambiguous (the charge may have gone through), so ask
    // Stripe first; otherwise leave the invoice open for retry and keep its id.
    if (finalizedOnStripe && stripeInvoiceId) {
      const failureCode = payAttempted ? "pay_error" : "finalize_error";
      console.error(`[billing] ${failureCode} after finalise`, { rowId, stripeInvoiceId }, e);
      const settled = await settledOnStripe(stripe, admin, rowId, stripeInvoiceId);
      if (settled) {
        return result("invoiced", {
          status: settled.status,
          totalCents: settled.totalCents,
          stripeInvoiceId,
          hostedInvoiceUrl: settled.hostedInvoiceUrl,
        });
      }
      await recordOpenForRetry(admin, rowId, stripeInvoiceId, failureCode, message);
      return result("error", {
        status: "open",
        stripeInvoiceId,
        error: `${payAttempted ? "Payment attempt" : "Recording the finalised invoice"} failed (${message}); invoice ${stripeInvoiceId} is open on Stripe for retry`,
      });
    }

    // Otherwise undo whatever Stripe state we created, then record the failure.
    let failure: Row = { status: "failed", failure_code: "stripe_error", failure_message: message };
    let reportId = stripeInvoiceId;
    if (stripeInvoiceId) {
      const cleaned = await cleanupStripeInvoice(stripe, stripeInvoiceId);
      if (!cleaned.ok) {
        failure = {
          status: "failed",
          failure_code: "cleanup_failed",
          failure_message: `${message} (cleanup of ${stripeInvoiceId} failed: ${cleaned.reason})`,
          stripe_invoice_id: stripeInvoiceId,
        };
      } else if (cleaned.removed) {
        failure = { ...failure, stripe_invoice_id: null };
        reportId = null;
      } else if (cleaned.stripeStatus === "open") {
        // Finalised despite the throw (e.g. finalize succeeded but its response was lost): never
        // void it — record it open for retry and keep the id.
        await recordOpenForRetry(admin, rowId, stripeInvoiceId, "finalize_error", message);
        return result("error", {
          status: "open",
          stripeInvoiceId,
          error: `${message}; invoice ${stripeInvoiceId} is open on Stripe for retry`,
        });
      } else if (cleaned.stripeStatus) {
        // Already settled on Stripe (e.g. paid before the error): reflect it, do not call it failed.
        failure = { status: invoiceStatusFromStripe(cleaned.stripeStatus), stripe_invoice_id: stripeInvoiceId, failure_code: null, failure_message: null };
      }
    }
    // Conditional: never overwrite a status a webhook already settled.
    const { error: writeErr } = await admin
      .from("billing_invoices")
      .update({ ...failure, updated_at: now() })
      .eq("id", rowId)
      .not("status", "in", SETTLED)
      .select("id");
    if (writeErr) console.error("[billing] could not record failure", rowId, writeErr.message);
    return result("error", { status: isInvoiceStatus(String(failure.status)) ? (failure.status as InvoiceStatus) : "failed", stripeInvoiceId: reportId, error: message });
  }
}

/**
 * After an ambiguous error on a finalised invoice: if Stripe already settled it (auto-collection
 * or the pay call went through), record that — conditionally, so a webhook's write is never
 * overwritten — and return it. null = still open (or the lookup failed); the caller records it open.
 */
async function settledOnStripe(
  stripe: Stripe,
  admin: Admin,
  rowId: string,
  stripeInvoiceId: string,
): Promise<{ status: InvoiceStatus; totalCents: number; hostedInvoiceUrl: string | null } | null> {
  let inv: Stripe.Invoice;
  try {
    inv = await stripe.invoices.retrieve(stripeInvoiceId);
  } catch (e) {
    console.error("[billing] could not re-check invoice after error", stripeInvoiceId, e);
    return null;
  }
  if (inv.status !== "paid") return null;
  const paidSec = inv.status_transitions?.paid_at ?? null;
  const { error } = await admin
    .from("billing_invoices")
    .update({
      status: "paid",
      stripe_invoice_id: stripeInvoiceId,
      failure_code: null,
      failure_message: null,
      paid_at: paidSec ? new Date(paidSec * 1000).toISOString() : now(),
      hosted_invoice_url: inv.hosted_invoice_url ?? null,
      invoice_pdf_url: inv.invoice_pdf ?? null,
      updated_at: now(),
    })
    .eq("id", rowId)
    .not("status", "in", SETTLED)
    .select("id");
  if (error) console.error("[billing] could not record paid after error; invoice.paid webhook will", rowId, error.message);
  return { status: "paid", totalCents: inv.total, hostedInvoiceUrl: inv.hosted_invoice_url ?? null };
}

/** Record a finalised invoice as open for retry, keeping its id. Never overwrites a settled row. */
async function recordOpenForRetry(
  admin: Admin,
  rowId: string,
  stripeInvoiceId: string,
  failureCode: "finalize_error" | "pay_error",
  message: string,
): Promise<void> {
  const { error } = await admin
    .from("billing_invoices")
    .update({ status: "open", stripe_invoice_id: stripeInvoiceId, failure_code: failureCode, failure_message: message, updated_at: now() })
    .eq("id", rowId)
    .not("status", "in", SETTLED)
    .select("id");
  if (error) console.error(`[billing] could not record ${failureCode}`, rowId, error.message);
}

/** Where the client's "fix it" button goes: the hosted invoice for authentication, else a fresh setup link. */
export async function clientActionUrl(
  clientId: string,
  kind: "failed" | "action_required",
  hostedInvoiceUrl: string | null,
  origin: string,
): Promise<string | null> {
  if (kind === "action_required" && hostedInvoiceUrl) return hostedInvoiceUrl;
  if (!origin) return null;
  const link = await createSetupLink(clientId, null);
  return setupLinkUrl(origin, link.token);
}

// ---- runBilling ----

export interface RunSummary {
  trigger: "cron" | "manual";
  startedAt: string;
  finishedAt: string;
  sweep: SweepResult;
  results: InvoicePeriodResult[];
  counts: Record<InvoiceOutcome, number>;
}

function countOutcomes(results: InvoicePeriodResult[]): Record<InvoiceOutcome, number> {
  const counts: Record<InvoiceOutcome, number> = {
    invoiced: 0,
    skipped_zero: 0,
    skipped_no_card: 0,
    skipped_disabled: 0,
    skipped_suspended: 0,
    already_invoiced: 0,
    usage_unavailable: 0,
    error: 0,
  };
  for (const r of results) counts[r.outcome] += 1;
  return counts;
}

/** A period's outcome that moves the credits cursor past it. */
const CLOSES_PERIOD = new Set<InvoiceOutcome>(["invoiced", "skipped_zero", "already_invoiced"]);

/**
 * The daily job (also "Run billing now" in the console):
 *   1. the retry sweep — due retries, then suspension of clients whose retry is spent;
 *   2. per enabled, unsuspended client: service-fee months due (in advance), then closed credits
 *      weeks (oldest first, stopping at the first that cannot be billed so periods stay
 *      contiguous), then the low-balance check for an early credits charge.
 * A summary row is always written; admins are emailed only on a day that charged or failed.
 */
export async function runBilling(
  trigger: "cron" | "manual",
  opts: { clientId?: string; now?: Date; origin?: string; usage?: UsageProvider } = {},
): Promise<RunSummary> {
  const at = opts.now ?? new Date();
  const startedAt = at.toISOString();
  const origin = opts.origin ?? "";
  const admin = createAdminClient();
  const usage = opts.usage ?? liveUsage;

  let sweep: SweepResult = { retried: 0, recovered: 0, suspended: 0 };
  try {
    sweep = await runRetrySweep(at, origin);
  } catch (e) {
    console.error("[billing] retry sweep failed", e);
  }

  // Read after the sweep: it may have suspended or resumed clients.
  const [configs, clients, billed] = await Promise.all([listClientBilling(), loadClientsIndex(), billedPeriodsByClient()]);

  const results: InvoicePeriodResult[] = [];
  const run = async (cb: ClientBilling, period: ChargePeriod, t: "cron" | "manual" | "threshold") => {
    try {
      const r = await invoicePeriod(cb.clientId, period, t, { origin, usage });
      results.push(r);
      return r;
    } catch (e) {
      // One client's failure (e.g. a config read) must not abort the rest of the run.
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[billing] invoicePeriod ${cb.clientId} ${period.stream} ${periodKeyOf(period)} threw`, e);
      const r: InvoicePeriodResult = {
        clientId: cb.clientId,
        clientName: clients.get(cb.clientId)?.name ?? cb.clientId,
        stream: period.stream,
        periodKey: periodKeyOf(period),
        periodLabel: chargeLabel(period),
        trigger: t,
        outcome: "error",
        status: null,
        totalCents: null,
        stripeInvoiceId: null,
        hostedInvoiceUrl: null,
        error: message,
      };
      results.push(r);
      return r;
    }
  };

  for (const cb of configs) {
    if (opts.clientId && cb.clientId !== opts.clientId) continue;
    if (!cb.enabled || cb.suspension) continue;
    const tz = tzOf(clients.get(cb.clientId)?.timezone);
    const today = localDate(at, tz);
    const billFrom = cb.billFromMonth ?? monthOf(today);
    const done = billed.get(cb.clientId) ?? { feeMonths: [], creditEnds: [] };

    // Stream B: the service fee, in advance.
    if (cb.effective.feeCents > 0) {
      const months = dueFeeMonths({ today, anchorDay: cb.effective.anchorDay, billFromMonth: billFrom, invoicedMonths: done.feeMonths });
      for (const month of months) await run(cb, { stream: "service_fee", month }, trigger);
    }

    // Stream A: closed credits weeks.
    let cursor = creditsCursor(billFrom, done.creditEnds);
    let blocked = false;
    for (const p of dueCreditPeriods(today, cursor)) {
      const r = await run(cb, { stream: "credits", ...p }, trigger);
      if (!CLOSES_PERIOD.has(r.outcome)) {
        blocked = true;
        break;
      }
      cursor = shiftDay(p.to, 1);
    }

    // Low-balance: unbilled usage through today at or over the threshold → bill the closed days now.
    const threshold = cb.effective.lowBalanceCents;
    if (!blocked && threshold != null && cb.card) {
      const early = earlyCreditPeriod(today, cursor);
      if (early) {
        try {
          const [unbilled, billable] = await Promise.all([usage(cb.clientId, tz, cursor, today), usage(cb.clientId, tz, early.from, early.to)]);
          if (thresholdCrossed(unbilled, threshold) && billable != null && billable > 0) {
            await run(cb, { stream: "credits", ...early }, "threshold");
          }
        } catch (e) {
          console.error("[billing] low-balance check failed", cb.clientId, e);
        }
      }
    }
  }

  const counts = countOutcomes(results);
  const summary: RunSummary = { trigger, startedAt, finishedAt: now(), sweep, results, counts };
  const { error: runErr } = await admin.from("billing_runs").insert({
    trigger,
    livemode: stripeLivemode(),
    started_at: startedAt,
    finished_at: summary.finishedAt,
    summary,
  });
  if (runErr) console.error("[billing] could not write billing_runs summary", runErr.message);

  const anyFailure = results.some((r) => r.status === "failed" || r.status === "action_required");
  if (counts.invoiced > 0 || counts.error > 0 || anyFailure || sweep.retried > 0 || sweep.suspended > 0) {
    const lines: RunSummaryLine[] = results.map((r) => ({
      clientName: r.clientName,
      label: `${STREAM_LABEL[r.stream]} · ${r.periodLabel}${r.trigger === "threshold" ? " (low balance)" : ""}`,
      outcome: r.outcome,
      status: r.status,
      totalCents: r.totalCents,
      currency: r.stream === "credits" ? CREDITS_CURRENCY : null,
      error: r.error,
    }));
    await safeNotify("run-summary", () => notifyRunSummary({ trigger, startedAt, lines, sweep }, origin));
  }
  return summary;
}

/** Admin "Retry charge" on a failed/open/action-required invoice. No emails; the UI shows the result. */
export async function retryInvoice(
  rowId: string,
  origin = "",
): Promise<{ ok: boolean; status: InvoiceStatus | null; message: string | null }> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("billing_invoices").select<string, Row>(INVOICE_COLS).eq("id", rowId).maybeSingle();
  if (error) throw new Error(`retryInvoice: ${error.message}`);
  if (!data) return { ok: false, status: null, message: "Invoice not found" };
  const row = rowToInvoice(data);
  if (row.livemode !== stripeLivemode()) {
    return { ok: false, status: row.status, message: "This invoice belongs to the other Stripe mode" };
  }
  if (!row.stripeInvoiceId || !["failed", "open", "action_required", "uncollectible"].includes(row.status)) {
    return { ok: false, status: row.status, message: "This invoice can't be retried" };
  }
  const stripe = getStripe();
  const current = await stripe.invoices.retrieve(row.stripeInvoiceId);

  let outcome: PayOutcome;
  if (current.status === "paid" || current.status === "void" || current.status === "uncollectible") {
    // Stripe already settled it: record that, never overwrite it with a retry result.
    const paidSec = current.status_transitions?.paid_at ?? null;
    outcome = {
      status: invoiceStatusFromStripe(current.status),
      failureCode: null,
      failureMessage: null,
      paidAt: paidSec ? new Date(paidSec * 1000).toISOString() : null,
      hostedInvoiceUrl: current.hosted_invoice_url ?? null,
      invoicePdfUrl: current.invoice_pdf ?? null,
    };
  } else {
    outcome = await payInvoice(stripe, row.stripeInvoiceId, `emma:inv:${rowId}:retry:${randomUUID()}`);
  }
  must(
    "retry: record outcome",
    await admin
      .from("billing_invoices")
      .update({
        status: outcome.status,
        failure_code: outcome.failureCode,
        failure_message: outcome.failureMessage,
        paid_at: outcome.paidAt,
        ...(outcome.hostedInvoiceUrl ? { hosted_invoice_url: outcome.hostedInvoiceUrl } : {}),
        ...(outcome.invoicePdfUrl ? { invoice_pdf_url: outcome.invoicePdfUrl } : {}),
        updated_at: now(),
      })
      .eq("id", rowId),
  );
  // Settling the last unpaid invoice lifts a suspension.
  if (outcome.status === "paid" || outcome.status === "void") {
    await maybeResume(row.clientId, origin).catch((e) => console.error("[billing] resume after retry failed", e));
  }
  return { ok: outcome.status === "paid", status: outcome.status, message: outcome.failureMessage };
}

// ---- Read-only figures for the pages ----

export interface CreditsFigure {
  /** First unbilled day. */
  from: string;
  /** Today (client tz): the window still accruing. */
  to: string;
  /** Unbilled credits so far (markup applied once released); null = could not be loaded (never 0). */
  usageCents: number | null;
  /** The next regular Monday charge. */
  nextChargeDate: string;
}

/** Unbilled AI Power Credits since the last charge, and when they are next charged. */
export async function unbilledCredits(cb: ClientBilling, tz: string, at: Date = new Date()): Promise<CreditsFigure> {
  const today = localDate(at, tz);
  const from = await creditsCursorFor(cb, today);
  let usageCents: number | null = 0;
  if (from <= today) {
    const series = await getUsageSeries(cb.clientId, tz, from, today);
    usageCents = series ? composeInvoice(Math.round(sumRange(series.daily, from, today)), cb.effective.markupBps, 0).totalCents : null;
  }
  // A closed week still unbilled is charged by the next run (today); otherwise next Monday.
  const owedNow = from <= shiftDay(weekStart(today), -1);
  return { from, to: today, usageCents, nextChargeDate: owedNow ? today : nextMonday(today) };
}

/** When the service fee is next charged: the anchor day of the next month not yet invoiced. */
export async function nextFeeCharge(cb: ClientBilling, tz: string, at: Date = new Date()): Promise<string | null> {
  if (cb.effective.feeCents === 0) return null;
  const today = localDate(at, tz);
  const billed = (await billedPeriodsByClient(cb.clientId)).get(cb.clientId);
  return nextFeeChargeDate(today, cb.effective.anchorDay, billed?.feeMonths ?? []);
}
