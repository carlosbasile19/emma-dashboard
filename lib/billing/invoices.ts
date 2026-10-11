import "server-only";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { getUsageSeries } from "@/lib/olivia/usage";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeLivemode } from "@/lib/stripe/client";
import { monthBounds, monthLabel, sumRange } from "@/lib/usage";
import {
  listClientBilling,
  loadClientBilling,
  updateClientBillingColumns,
  type ClientBilling,
} from "./config";
import { composeInvoice, type InvoiceLines } from "./money";
import {
  notifyNoCard,
  notifyPaymentFailed,
  notifyRunSummary,
  notifyUsageUnavailable,
  type RunSummaryLine,
} from "./notify";
import { dueMonths, localDate, monthOf, nextChargeDate, prevMonth, shouldAlertNoCard } from "./schedule";
import { createSetupLink, setupLinkUrl } from "./setup";
import { invoiceStatusFromStripe, isInvoiceStatus, type InvoiceStatus } from "./status";

/**
 * The monthly charge. `invoiceMonth` is the one path that creates a Stripe Invoice; the cron,
 * the admin's "Charge now" and the livecheck all go through it.
 *
 * Billing-safety rules, in the order the code applies them:
 *   1. The (client, month) row is RESERVED before Stripe is called — the unique constraint is
 *      the lock, so two runs can never bill a month twice and a crash leaves a visible row.
 *   2. Usage that fails to load is `null`: the reservation is released, admins are told, and
 *      tomorrow's run retries. Never $0.
 *   3. Every Stripe create carries an idempotency key built from the reservation id, so a replay
 *      within 24h returns the same objects and a fresh reservation never collides.
 *   4. Pay synchronously so the run reports a real outcome; Stripe's automatic collection keeps
 *      retrying a decline afterwards.
 */

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
}

const INVOICE_COLS =
  "id, olivia_client_id, period_month, period_from, period_to, tz, raw_usage_cents, markup_bps, " +
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
  return {
    id: String(r.id),
    clientId: String(r.olivia_client_id),
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
  };
}

/** Newest month first. */
export async function listInvoices(clientId?: string): Promise<InvoiceRow[]> {
  const admin = createAdminClient();
  let q = admin
    .from("billing_invoices")
    .select<string, Row>(INVOICE_COLS)
    .eq("livemode", stripeLivemode())
    .order("period_month", { ascending: false });
  if (clientId) q = q.eq("olivia_client_id", clientId);
  const { data, error } = await q;
  if (error) throw new Error(`listInvoices: ${error.message}`);
  return (data ?? []).map((r) => rowToInvoice(r));
}

/**
 * Months that count as "done" for scheduling, this Stripe mode only. A `reserved` row (a crashed
 * run) and a `failed` row with no Stripe invoice are NOT done: they resurface so recovery runs.
 */
export async function invoicedMonthsByClient(): Promise<Map<string, string[]>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("billing_invoices")
    .select("olivia_client_id, period_month, status, stripe_invoice_id")
    .eq("livemode", stripeLivemode());
  if (error) throw new Error(`invoicedMonthsByClient: ${error.message}`);
  const out = new Map<string, string[]>();
  for (const r of data ?? []) {
    if (r.status === "reserved" || (r.status === "failed" && !r.stripe_invoice_id)) continue;
    const id = r.olivia_client_id as string;
    out.set(id, [...(out.get(id) ?? []), r.period_month as string]);
  }
  return out;
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
  | "already_invoiced"
  | "usage_unavailable"
  | "error";

export interface InvoiceMonthResult {
  clientId: string;
  clientName: string;
  month: string;
  outcome: InvoiceOutcome;
  status: InvoiceStatus | null;
  totalCents: number | null;
  stripeInvoiceId: string | null;
  hostedInvoiceUrl: string | null;
  error: string | null;
}

export interface PayOutcome {
  status: InvoiceStatus;
  failureCode: string | null;
  failureMessage: string | null;
  paidAt: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
}

const AUTH_CODES = new Set(["authentication_required", "invoice_payment_intent_requires_action"]);

/**
 * Pay a finalised invoice now. A card decline or an authentication request is an outcome, not an
 * exception; EVERYTHING else (bad request, network, auth, rate limit) rethrows so the caller records
 * a `stripe_error` instead of mistaking it for a decline.
 */
export async function payInvoice(stripe: Stripe, invoiceId: string, idempotencyKey: string): Promise<PayOutcome> {
  try {
    const paid = await stripe.invoices.pay(invoiceId, {}, { idempotencyKey });
    const paidAtSec = paid.status_transitions?.paid_at ?? null;
    return {
      status: invoiceStatusFromStripe(paid.status),
      failureCode: null,
      failureMessage: null,
      paidAt: paidAtSec ? new Date(paidAtSec * 1000).toISOString() : null,
      hostedInvoiceUrl: paid.hosted_invoice_url ?? null,
      invoicePdfUrl: paid.invoice_pdf ?? null,
    };
  } catch (e) {
    if (e instanceof Stripe.errors.StripeError) {
      const code = e.code ?? null;
      const decline = typeof e.decline_code === "string" ? e.decline_code : null;
      const needsAuth = (code != null && AUTH_CODES.has(code)) || (decline != null && AUTH_CODES.has(decline));
      if (needsAuth || e.type === "StripeCardError") {
        return {
          status: needsAuth ? "action_required" : "failed",
          failureCode: decline ?? code ?? "payment_failed",
          failureMessage: e.message,
          paidAt: null,
          hostedInvoiceUrl: null,
          invoicePdfUrl: null,
        };
      }
    }
    throw e;
  }
}

/** Throws on any Stripe error: recovery must fail CLOSED, never read an outage as "nothing exists". */
async function lookupExistingInvoice(
  stripe: Stripe,
  stripeInvoiceId: string | null,
  clientId: string,
  month: string,
): Promise<Stripe.Invoice | null> {
  if (stripeInvoiceId) return stripe.invoices.retrieve(stripeInvoiceId);
  const res = await stripe.invoices.search({
    query: `metadata['emma_client_id']:'${clientId}' AND metadata['emma_period']:'${month}'`,
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

async function reserveMonth(admin: Admin, cols: Row, clientId: string, month: string): Promise<Reservation> {
  const { data, error } = await admin.from("billing_invoices").insert(cols).select("id").single();
  if (!error && data) return { kind: "reserved", rowId: String(data.id) };
  if (error?.code !== "23505") return { kind: "error", message: error?.message ?? "reserve failed" };
  const { data: row, error: readErr } = await admin
    .from("billing_invoices")
    .select("id, status, created_at, stripe_invoice_id, livemode")
    .eq("olivia_client_id", clientId)
    .eq("period_month", month)
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

export async function invoiceMonth(
  clientId: string,
  month: string,
  trigger: "cron" | "manual",
  opts: { usage?: UsageProvider; createdBy?: string | null; origin?: string } = {},
): Promise<InvoiceMonthResult> {
  const admin = createAdminClient();
  const stripe = getStripe();
  const live = stripeLivemode();
  const origin = opts.origin ?? "";
  const client = (await loadClientsIndex()).get(clientId);
  const clientName = client?.name ?? clientId;
  const result = (outcome: InvoiceOutcome, extra: Partial<InvoiceMonthResult> = {}): InvoiceMonthResult => ({
    clientId,
    clientName,
    month,
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
  // Never invoice a month that has not closed in the client's timezone.
  if (month >= monthOf(localDate(new Date(), tz))) {
    return result("error", { error: "The current month cannot be invoiced until it closes" });
  }
  if (!cb.billFromMonth || month < cb.billFromMonth) {
    return result("error", { error: "Month is before this client's bill-from month" });
  }
  const { from, to } = monthBounds(month);
  const reserveCols: Row = {
    olivia_client_id: clientId,
    period_month: month,
    period_from: from,
    period_to: to,
    tz,
    currency: "usd",
    status: "reserved",
    trigger,
    created_by: opts.createdBy ?? null,
    livemode: live,
  };
  // One id per call: Stripe idempotency keys are scoped to this attempt, so a deleted draft's id is
  // never replayed. Cross-attempt safety comes from the unique row and the fail-closed recovery.
  const attemptId = randomUUID();

  // 1. Reserve the month (the unique constraint is the lock).
  const reservation = await reserveMonth(admin, reserveCols, clientId, month);
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
        error: `A ${row.livemode ? "live" : "sandbox"} invoice row already exists for this month; delete it before billing in this mode`,
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
      found = await lookupExistingInvoice(stripe, row.stripeInvoiceId, clientId, month);
    } catch (e) {
      console.error("[billing] recovery lookup failed", clientId, month, e);
      return result("error", { error: "Stripe lookup failed during recovery; row left untouched" });
    }
    const reservedFields = {
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
      console.warn("[billing] recovered invoice", { clientId, month, stripeInvoiceId: found.id, status });
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
      // 3. Usage. null releases the reservation so tomorrow's run retries. Never $0.
      const raw = await (opts.usage ?? liveUsage)(clientId, tz, from, to);
      if (raw == null) {
        must("release reservation", await admin.from("billing_invoices").delete().eq("id", rowId));
        await safeNotify("usage-unavailable", () => notifyUsageUnavailable(clientId, clientName, month, origin));
        return result("usage_unavailable");
      }

      // 4. Lines. Markup once, on the month total.
      lines = composeInvoice(raw, cb.effective.markupBps, cb.effective.feeCents);
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
      const label = monthLabel(month);
      const invoice = await stripe.invoices.create(
        {
          customer: cb.stripeCustomerId,
          collection_method: "charge_automatically",
          auto_advance: false,
          currency: "usd",
          pending_invoice_items_behavior: "exclude",
          description: `Emma · ${label}`,
          statement_descriptor: "HEY EMMA",
          metadata: { emma_client_id: clientId, emma_period: month },
        },
        { idempotencyKey: `${k}:create` },
      );
      stripeInvoiceId = invoice.id;
      // Record the id BEFORE adding lines so a crash leaves a row that points at the draft.
      must(
        "record stripe invoice id",
        await admin.from("billing_invoices").update({ ...lineCols, stripe_invoice_id: invoice.id, updated_at: now() }).eq("id", rowId),
      );
      if (lines.billedUsageCents > 0) {
        await stripe.invoiceItems.create(
          {
            customer: cb.stripeCustomerId,
            invoice: invoice.id,
            amount: lines.billedUsageCents,
            currency: "usd",
            description: `Emma usage · ${label}`,
          },
          { idempotencyKey: `${k}:usage` },
        );
      }
      if (lines.feeCents > 0) {
        await stripe.invoiceItems.create(
          {
            customer: cb.stripeCustomerId,
            invoice: invoice.id,
            amount: lines.feeCents,
            currency: "usd",
            description: `Monthly fee · ${label}`,
          },
          { idempotencyKey: `${k}:fee` },
        );
      }
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

    if (outcomeChanged && (outcome.status === "failed" || outcome.status === "action_required")) {
      const failedKind = outcome.status;
      await safeNotify("payment-failed", async () =>
        notifyPaymentFailed({
          clientId,
          clientName,
          month,
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
  results: InvoiceMonthResult[];
  counts: Record<InvoiceOutcome, number>;
}

function countOutcomes(results: InvoiceMonthResult[]): Record<InvoiceOutcome, number> {
  const counts: Record<InvoiceOutcome, number> = {
    invoiced: 0,
    skipped_zero: 0,
    skipped_no_card: 0,
    skipped_disabled: 0,
    already_invoiced: 0,
    usage_unavailable: 0,
    error: 0,
  };
  for (const r of results) counts[r.outcome] += 1;
  return counts;
}

/**
 * The daily job (also "Run billing now" in the console). Clients are processed one at a time
 * and their due months oldest first. A summary row is always written; admins are emailed only
 * on a day that invoiced or failed.
 */
export async function runBilling(
  trigger: "cron" | "manual",
  opts: { clientId?: string; now?: Date; origin?: string; usage?: UsageProvider } = {},
): Promise<RunSummary> {
  const at = opts.now ?? new Date();
  const startedAt = at.toISOString();
  const admin = createAdminClient();
  const [configs, clients, invoiced] = await Promise.all([
    listClientBilling(),
    loadClientsIndex(),
    invoicedMonthsByClient(),
  ]);

  const results: InvoiceMonthResult[] = [];
  for (const cb of configs) {
    if (opts.clientId && cb.clientId !== opts.clientId) continue;
    if (!cb.enabled) continue;
    const today = localDate(at, tzOf(clients.get(cb.clientId)?.timezone));
    const months = dueMonths({
      today,
      anchorDay: cb.effective.anchorDay,
      billFromMonth: cb.billFromMonth ?? monthOf(today),
      invoicedMonths: invoiced.get(cb.clientId) ?? [],
    });
    for (const month of months) {
      try {
        results.push(await invoiceMonth(cb.clientId, month, trigger, { origin: opts.origin, usage: opts.usage }));
      } catch (e) {
        // One client's failure (e.g. a config read) must not abort the rest of the run.
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[billing] invoiceMonth ${cb.clientId} ${month} threw`, e);
        results.push({
          clientId: cb.clientId,
          clientName: clients.get(cb.clientId)?.name ?? cb.clientId,
          month,
          outcome: "error",
          status: null,
          totalCents: null,
          stripeInvoiceId: null,
          hostedInvoiceUrl: null,
          error: message,
        });
      }
    }
  }

  const counts = countOutcomes(results);
  const summary: RunSummary = { trigger, startedAt, finishedAt: now(), results, counts };
  const { error: runErr } = await admin.from("billing_runs").insert({
    trigger,
    livemode: stripeLivemode(),
    started_at: startedAt,
    finished_at: summary.finishedAt,
    summary,
  });
  if (runErr) console.error("[billing] could not write billing_runs summary", runErr.message);

  const anyFailure = results.some((r) => r.status === "failed" || r.status === "action_required");
  if (counts.invoiced > 0 || counts.error > 0 || anyFailure) {
    const lines: RunSummaryLine[] = results.map((r) => ({
      clientName: r.clientName,
      month: r.month,
      outcome: r.outcome,
      status: r.status,
      totalCents: r.totalCents,
      error: r.error,
    }));
    await safeNotify("run-summary", () => notifyRunSummary({ trigger, startedAt, lines }, opts.origin ?? ""));
  }
  return summary;
}

/** Admin "Retry charge" on a failed/open/action-required invoice. No emails; the UI shows the result. */
export async function retryInvoice(
  rowId: string,
): Promise<{ ok: boolean; status: InvoiceStatus | null; message: string | null }> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("billing_invoices").select<string, Row>(INVOICE_COLS).eq("id", rowId).maybeSingle();
  if (error) throw new Error(`retryInvoice: ${error.message}`);
  if (!data) return { ok: false, status: null, message: "Invoice not found" };
  const row = rowToInvoice(data);
  if (row.livemode !== stripeLivemode()) {
    return { ok: false, status: row.status, message: "This invoice belongs to the other Stripe mode" };
  }
  if (!row.stripeInvoiceId || !["failed", "open", "action_required"].includes(row.status)) {
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
  return { ok: outcome.status === "paid", status: outcome.status, message: outcome.failureMessage };
}

// ---- Read-only figures for the pages ----

export interface MonthFigure {
  month: string;
  label: string;
  /** null = usage could not be loaded (never 0). */
  lines: InvoiceLines | null;
}

/** The client Billing page's "Next charge": month-to-date usage with the markup, plus the fee. */
export async function estimateCurrentMonth(
  cb: ClientBilling,
  tz: string,
  at: Date = new Date(),
): Promise<MonthFigure & { nextChargeDate: string }> {
  const today = localDate(at, tz);
  const month = monthOf(today);
  const from = `${month}-01`;
  const series = await getUsageSeries(cb.clientId, tz, from, today);
  const raw = series ? Math.round(sumRange(series.daily, from, today)) : null;
  return {
    month,
    label: monthLabel(month),
    lines: raw == null ? null : composeInvoice(raw, cb.effective.markupBps, cb.effective.feeCents),
    nextChargeDate: nextChargeDate(today, cb.effective.anchorDay),
  };
}

/** The console's raw → billed preview for the last closed month (normal cache, not forced). */
export async function previewLastClosedMonth(cb: ClientBilling, tz: string, at: Date = new Date()): Promise<MonthFigure> {
  const month = prevMonth(monthOf(localDate(at, tz)));
  const { from, to } = monthBounds(month);
  const series = await getUsageSeries(cb.clientId, tz, from, to);
  const raw = series ? Math.round(sumRange(series.daily, from, to)) : null;
  return {
    month,
    label: monthLabel(month),
    lines: raw == null ? null : composeInvoice(raw, cb.effective.markupBps, cb.effective.feeCents),
  };
}
