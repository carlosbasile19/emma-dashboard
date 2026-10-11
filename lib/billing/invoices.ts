import "server-only";
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
import { dueMonths, localDate, monthOf, nextChargeDate, prevMonth } from "./schedule";
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
  let q = admin.from("billing_invoices").select<string, Row>(INVOICE_COLS).order("period_month", { ascending: false });
  if (clientId) q = q.eq("olivia_client_id", clientId);
  const { data, error } = await q;
  if (error) throw new Error(`listInvoices: ${error.message}`);
  return (data ?? []).map((r) => rowToInvoice(r));
}

/** Every month that has a row, in any status, per client. */
export async function invoicedMonthsByClient(): Promise<Map<string, string[]>> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("billing_invoices").select("olivia_client_id, period_month");
  if (error) throw new Error(`invoicedMonthsByClient: ${error.message}`);
  const out = new Map<string, string[]>();
  for (const r of data ?? []) {
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

/** Pay a finalised invoice now. A decline is an outcome, not an exception; anything else throws. */
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
    if (e instanceof Stripe.errors.StripeCardError || e instanceof Stripe.errors.StripeInvalidRequestError) {
      const code = e.code ?? null;
      return {
        status: code && AUTH_CODES.has(code) ? "action_required" : "failed",
        failureCode: ("decline_code" in e && typeof e.decline_code === "string" ? e.decline_code : null) ?? code ?? "payment_failed",
        failureMessage: e.message,
        paidAt: null,
        hostedInvoiceUrl: null,
        invoicePdfUrl: null,
      };
    }
    throw e;
  }
}

async function findStripeInvoice(stripe: Stripe, clientId: string, month: string): Promise<Stripe.Invoice | null> {
  try {
    const res = await stripe.invoices.search({
      query: `metadata['emma_client_id']:'${clientId}' AND metadata['emma_period']:'${month}'`,
      limit: 1,
    });
    return res.data[0] ?? null;
  } catch {
    return null;
  }
}

type Admin = ReturnType<typeof createAdminClient>;

type Reservation =
  | { kind: "reserved"; rowId: string }
  | { kind: "exists"; row: { id: string; status: string; createdAt: string; stripeInvoiceId: string | null } }
  | { kind: "error"; message: string };

async function reserveMonth(
  admin: Admin,
  cols: Row,
  clientId: string,
  month: string,
): Promise<Reservation> {
  const { data, error } = await admin.from("billing_invoices").insert(cols).select("id").single();
  if (!error && data) return { kind: "reserved", rowId: String(data.id) };
  if (error?.code !== "23505") return { kind: "error", message: error?.message ?? "reserve failed" };
  const { data: row } = await admin
    .from("billing_invoices")
    .select("id, status, created_at, stripe_invoice_id")
    .eq("olivia_client_id", clientId)
    .eq("period_month", month)
    .maybeSingle();
  if (!row) return { kind: "error", message: "reservation vanished" };
  return {
    kind: "exists",
    row: {
      id: String(row.id),
      status: String(row.status),
      createdAt: String(row.created_at),
      stripeInvoiceId: text(row.stripe_invoice_id),
    },
  };
}

/** A `reserved` row older than this came from a crashed run and is reconciled, not respected. */
const RESERVATION_STALE_MS = 60 * 60 * 1000;

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
  if (!cb.card || !cb.stripeCustomerId || cb.stripeLivemode !== live) {
    // Once per due month, not once per day.
    if (cb.noCardAlertedMonth !== month) {
      await safeNotify("no-card", () => notifyNoCard(clientId, clientName, month, origin));
      await updateClientBillingColumns(clientId, { no_card_alerted_month: month });
    }
    return result("skipped_no_card");
  }

  const tz = tzOf(client?.timezone);
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

  // 1. Reserve the month.
  let reservation = await reserveMonth(admin, reserveCols, clientId, month);
  if (reservation.kind === "exists") {
    const { row } = reservation;
    const stale = row.status === "reserved" && Date.now() - Date.parse(row.createdAt) > RESERVATION_STALE_MS;
    if (!stale) {
      return result("already_invoiced", {
        status: isInvoiceStatus(row.status) ? row.status : null,
        stripeInvoiceId: row.stripeInvoiceId,
      });
    }
    // A crashed run. Adopt a finalised Stripe invoice if one exists, delete a draft, start over.
    const found = await findStripeInvoice(stripe, clientId, month);
    if (found && found.status !== "draft") {
      const status = invoiceStatusFromStripe(found.status);
      await admin
        .from("billing_invoices")
        .update({
          stripe_invoice_id: found.id,
          status,
          hosted_invoice_url: found.hosted_invoice_url ?? null,
          invoice_pdf_url: found.invoice_pdf ?? null,
          total_cents: found.total,
          updated_at: now(),
        })
        .eq("id", row.id);
      return result("already_invoiced", { status, stripeInvoiceId: found.id, totalCents: found.total });
    }
    if (found) await stripe.invoices.del(found.id).catch(() => undefined);
    await admin.from("billing_invoices").delete().eq("id", row.id);
    reservation = await reserveMonth(admin, reserveCols, clientId, month);
  }
  if (reservation.kind !== "reserved") {
    return result("error", { error: reservation.kind === "error" ? reservation.message : "could not reserve the month" });
  }
  const rowId = reservation.rowId;

  // 2. Usage. null releases the reservation so tomorrow's run retries. Never $0.
  const raw = await (opts.usage ?? liveUsage)(clientId, tz, from, to);
  if (raw == null) {
    await admin.from("billing_invoices").delete().eq("id", rowId);
    await safeNotify("usage-unavailable", () => notifyUsageUnavailable(clientId, clientName, month, origin));
    return result("usage_unavailable");
  }

  // 3. Lines.
  const lines = composeInvoice(raw, cb.effective.markupBps, cb.effective.feeCents);
  const lineCols: Row = {
    raw_usage_cents: lines.rawUsageCents,
    markup_bps: lines.markupBps,
    billed_usage_cents: lines.billedUsageCents,
    fee_cents: lines.feeCents,
    total_cents: lines.totalCents,
  };
  if (lines.totalCents === 0) {
    await admin.from("billing_invoices").update({ ...lineCols, status: "skipped_zero", updated_at: now() }).eq("id", rowId);
    return result("skipped_zero", { status: "skipped_zero", totalCents: 0 });
  }

  // 4. Stripe.
  const k = `emma:inv:${rowId}`;
  const label = monthLabel(month);
  try {
    const invoice = await stripe.invoices.create(
      {
        customer: cb.stripeCustomerId,
        collection_method: "charge_automatically",
        auto_advance: true,
        currency: "usd",
        pending_invoice_items_behavior: "exclude",
        description: `Emma · ${label}`,
        statement_descriptor: "HEY EMMA",
        metadata: { emma_client_id: clientId, emma_period: month },
      },
      { idempotencyKey: `${k}:create` },
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
    const finalized = await stripe.invoices.finalizeInvoice(
      invoice.id,
      { auto_advance: true },
      { idempotencyKey: `${k}:finalize` },
    );
    await admin
      .from("billing_invoices")
      .update({
        ...lineCols,
        stripe_invoice_id: finalized.id,
        hosted_invoice_url: finalized.hosted_invoice_url ?? null,
        invoice_pdf_url: finalized.invoice_pdf ?? null,
        status: "open",
        finalized_at: now(),
        updated_at: now(),
      })
      .eq("id", rowId);

    const outcome = await payInvoice(stripe, finalized.id, `${k}:pay`);
    const hostedInvoiceUrl = outcome.hostedInvoiceUrl ?? finalized.hosted_invoice_url ?? null;
    await admin
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
      .eq("id", rowId);

    if (outcome.status === "failed" || outcome.status === "action_required") {
      const failedKind = outcome.status;
      await safeNotify("payment-failed", async () =>
        notifyPaymentFailed({
          clientId,
          clientName,
          month,
          totalCents: lines.totalCents,
          reason: outcome.failureMessage ?? "Payment declined",
          kind: failedKind,
          origin,
          clientActionUrl: await clientActionUrl(clientId, failedKind, hostedInvoiceUrl, origin),
        }),
      );
    }
    return result("invoiced", {
      status: outcome.status,
      totalCents: lines.totalCents,
      stripeInvoiceId: finalized.id,
      hostedInvoiceUrl,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin
      .from("billing_invoices")
      .update({ ...lineCols, status: "failed", failure_code: "stripe_error", failure_message: message, updated_at: now() })
      .eq("id", rowId);
    return result("error", { status: "failed", error: message });
  }
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
  await admin.from("billing_runs").insert({
    trigger,
    livemode: stripeLivemode(),
    started_at: startedAt,
    finished_at: summary.finishedAt,
    summary,
  });

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
  const { data } = await admin.from("billing_invoices").select<string, Row>(INVOICE_COLS).eq("id", rowId).maybeSingle();
  if (!data) return { ok: false, status: null, message: "Invoice not found" };
  const row = rowToInvoice(data);
  if (!row.stripeInvoiceId || !["failed", "open", "action_required"].includes(row.status)) {
    return { ok: false, status: row.status, message: "This invoice can't be retried" };
  }
  const outcome = await payInvoice(getStripe(), row.stripeInvoiceId, `emma:inv:${rowId}:retry:${Date.now()}`);
  await admin
    .from("billing_invoices")
    .update({
      status: outcome.status,
      failure_code: outcome.failureCode,
      failure_message: outcome.failureMessage,
      paid_at: outcome.paidAt,
      updated_at: now(),
    })
    .eq("id", rowId);
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
