import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeLivemode } from "@/lib/stripe/client";
import { loadClientBilling } from "./config";
import { clientDisplayName, notifyPaymentReceived, notifyResumed, notifySuspended } from "./notify";
import { payInvoice, type PayOutcome } from "./pay";
import { MAX_RETRIES, RETRY_AFTER_MS } from "./schedule";
import { invoiceStatusFromStripe, isInvoiceStatus, isInvoiceStream, isUnpaid, type InvoiceStatus, type InvoiceStream } from "./status";
import { dayLabel, monthLabel } from "@/lib/usage";

/**
 * Failed charge → one retry → suspension → automatic resume.
 *
 *   1. A charge that fails (either stream) gets `next_retry_at` = failure + RETRY_AFTER_MS.
 *   2. The daily run retries it once (`retry_count` 0 → 1). A new card saved in the meantime
 *      retries every unpaid charge immediately instead.
 *   3. Still unpaid after its retry → the client is suspended: no new charges are raised, the
 *      console shows it, and the agency + client are emailed. The upstream platform has no pause
 *      API, so stopping calls is a manual step the agency records in the console.
 *   4. When the last unpaid invoice is paid (new card, Stripe's own retry, an admin retry, or
 *      marked paid in Stripe) the suspension clears itself and both sides are emailed.
 *
 * Every transition is a conditional update, so concurrent webhooks, crons and admin clicks
 * produce one state change and one email.
 */

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

const UNPAID_FILTER = "(failed,action_required,uncollectible)";

interface UnpaidRow {
  id: string;
  clientId: string;
  status: InvoiceStatus;
  stripeInvoiceId: string | null;
  retryCount: number;
  nextRetryAt: string | null;
  stream: InvoiceStream;
  periodKey: string;
  periodTo: string | null;
  totalCents: number;
  currency: string;
}

function toUnpaid(r: Row): UnpaidRow {
  const status = String(r.status);
  return {
    id: String(r.id),
    clientId: String(r.olivia_client_id),
    status: isInvoiceStatus(status) ? status : "failed",
    stripeInvoiceId: text(r.stripe_invoice_id),
    retryCount: typeof r.retry_count === "number" ? r.retry_count : 0,
    nextRetryAt: text(r.next_retry_at),
    stream: isInvoiceStream(String(r.stream)) ? (r.stream as InvoiceStream) : "credits",
    periodKey: String(r.period_key),
    periodTo: text(r.period_to),
    totalCents: typeof r.total_cents === "number" ? r.total_cents : 0,
    currency: text(r.currency) ?? "usd",
  };
}

const UNPAID_COLS =
  "id, olivia_client_id, status, stripe_invoice_id, retry_count, next_retry_at, stream, period_key, period_to, total_cents, currency";

async function unpaidRows(clientId?: string): Promise<UnpaidRow[]> {
  let q = createAdminClient()
    .from("billing_invoices")
    .select<string, Row>(UNPAID_COLS)
    .eq("livemode", stripeLivemode())
    .filter("status", "in", UNPAID_FILTER);
  if (clientId) q = q.eq("olivia_client_id", clientId);
  const { data, error } = await q;
  if (error) throw new Error(`unpaid invoices: ${error.message}`);
  return (data ?? []).map(toUnpaid);
}

/**
 * Called when a row has just moved into failed / action_required. Schedules its one retry, or,
 * when the retry is already spent, suspends. Never throws: a failure here must not undo the
 * status write that triggered it (the next daily sweep repairs a missed schedule).
 */
export async function onChargeFailed(rowId: string, origin: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("billing_invoices").select<string, Row>(UNPAID_COLS).eq("id", rowId).maybeSingle();
    if (error || !data) return;
    const row = toUnpaid(data);
    if (row.retryCount < MAX_RETRIES) {
      await admin
        .from("billing_invoices")
        .update({ next_retry_at: new Date(Date.now() + RETRY_AFTER_MS).toISOString(), updated_at: now() })
        .eq("id", rowId)
        .is("next_retry_at", null);
    } else {
      await suspendClient(row.clientId, "A charge failed and its retry failed too", rowId, origin);
    }
  } catch (e) {
    console.error("[billing] onChargeFailed", rowId, e);
  }
}

/** Write an attempt's outcome. Never moves a paid / void row. Returns whether the status changed. */
async function recordOutcome(rowId: string, outcome: PayOutcome): Promise<boolean> {
  const { data, error } = await createAdminClient()
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
    .eq("id", rowId)
    .not("status", "in", "(paid,void)")
    .select("id");
  if (error) throw new Error(`record retry outcome: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * One payment attempt on an unpaid row: Stripe's current state first (it may have collected on
 * its own), then pay. An authentication request cannot be retried off-session; it is only re-read.
 */
export async function attemptRow(row: UnpaidRow, origin: string): Promise<PayOutcome | null> {
  if (!row.stripeInvoiceId) return null;
  const stripe = getStripe();
  const current = await stripe.invoices.retrieve(row.stripeInvoiceId);
  // Stripe can still collect an uncollectible (written-off) invoice; only a void one is final.
  const payable = current.status === "open" || current.status === "uncollectible";
  let outcome: PayOutcome;
  if (!payable || row.status === "action_required") {
    const paidSec = current.status_transitions?.paid_at ?? null;
    outcome = {
      status: payable ? row.status : invoiceStatusFromStripe(current.status),
      failureCode: null,
      failureMessage: payable ? "Payment still needs authentication" : null,
      paidAt: paidSec ? new Date(paidSec * 1000).toISOString() : null,
      hostedInvoiceUrl: current.hosted_invoice_url ?? null,
      invoicePdfUrl: current.invoice_pdf ?? null,
    };
  } else {
    outcome = await payInvoice(stripe, row.stripeInvoiceId, `emma:inv:${row.id}:retry:${randomUUID()}`);
  }
  const changed = await recordOutcome(row.id, outcome);
  if (changed && outcome.status === "paid") {
    // Same receipt the first attempt would have sent; the conditional write makes it once-only.
    const periodLabel =
      row.stream === "service_fee"
        ? monthLabel(row.periodKey)
        : row.periodTo && row.periodTo !== row.periodKey
          ? `${dayLabel(row.periodKey)} – ${dayLabel(row.periodTo)}`
          : dayLabel(row.periodKey);
    await notifyPaymentReceived({
      clientId: row.clientId,
      clientName: await clientDisplayName(row.clientId),
      stream: row.stream,
      periodLabel,
      totalCents: row.totalCents,
      currency: row.currency,
      origin,
    }).catch((e) => console.error("[billing] receipt after retry failed", e));
  }
  return outcome;
}

/**
 * Retry every unpaid charge for a client now (a new card was just saved, or an admin asked).
 * Each counts as that row's retry. Returns how many are still unpaid afterwards.
 */
export async function retryUnpaidNow(clientId: string, origin: string): Promise<number> {
  let stillUnpaid = 0;
  for (const row of await unpaidRows(clientId)) {
    try {
      await createAdminClient()
        .from("billing_invoices")
        .update({ retry_count: row.retryCount + 1, next_retry_at: null, updated_at: now() })
        .eq("id", row.id);
      const outcome = await attemptRow(row, origin);
      if (!outcome || isUnpaid(outcome.status)) {
        stillUnpaid += 1;
        await suspendClient(clientId, "A charge failed and its retry failed too", row.id, origin);
      }
    } catch (e) {
      stillUnpaid += 1;
      console.error("[billing] retryUnpaidNow", row.id, e);
    }
  }
  await maybeResume(clientId, origin);
  return stillUnpaid;
}

export interface SweepResult {
  retried: number;
  recovered: number;
  suspended: number;
}

/**
 * The daily sweep, before any new charges: run due retries, repair rows that missed their
 * schedule, and suspend any client whose retry is spent. Per-row failures are logged, never thrown.
 */
export async function runRetrySweep(at: Date, origin: string): Promise<SweepResult> {
  const result: SweepResult = { retried: 0, recovered: 0, suspended: 0 };
  const admin = createAdminClient();
  for (const row of await unpaidRows()) {
    try {
      if (row.retryCount >= MAX_RETRIES) {
        if (await suspendClient(row.clientId, "A charge failed and its retry failed too", row.id, origin)) result.suspended += 1;
        continue;
      }
      if (!row.nextRetryAt) {
        // Missed its schedule (e.g. a crash after the failure write): schedule it now.
        await admin
          .from("billing_invoices")
          .update({ next_retry_at: new Date(at.getTime() + RETRY_AFTER_MS).toISOString(), updated_at: now() })
          .eq("id", row.id)
          .is("next_retry_at", null);
        continue;
      }
      if (Date.parse(row.nextRetryAt) > at.getTime()) continue;
      // Claim the retry: only the run that clears this exact schedule performs it.
      const { data: claimed, error } = await admin
        .from("billing_invoices")
        .update({ retry_count: row.retryCount + 1, next_retry_at: null, updated_at: now() })
        .eq("id", row.id)
        .eq("next_retry_at", row.nextRetryAt)
        .select("id");
      if (error || (claimed?.length ?? 0) === 0) continue;
      result.retried += 1;
      const outcome = await attemptRow(row, origin);
      if (outcome && !isUnpaid(outcome.status)) {
        result.recovered += 1;
        await maybeResume(row.clientId, origin);
      } else if (await suspendClient(row.clientId, "A charge failed and its retry failed too", row.id, origin)) {
        result.suspended += 1;
      }
    } catch (e) {
      console.error("[billing] retry sweep row failed", row.id, e);
    }
  }
  return result;
}

/** Suspend a client (once). Returns true when this call suspended it. */
export async function suspendClient(clientId: string, reason: string, rowId: string | null, origin: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("client_billing")
    .update({
      suspended_at: now(),
      suspended_reason: reason,
      suspended_invoice_id: rowId,
      service_paused_at: null,
      updated_at: now(),
    })
    .eq("olivia_client_id", clientId)
    .is("suspended_at", null)
    .select("olivia_client_id");
  if (error) throw new Error(`suspend client: ${error.message}`);
  const changed = (data?.length ?? 0) > 0;
  if (changed) {
    console.warn("[billing] client suspended", { clientId, rowId, reason });
    await notifySuspended(clientId, reason, origin).catch((e) => console.error("[billing] suspended notification failed", e));
  }
  return changed;
}

/** Clear the suspension once nothing is owed. Returns true when this call lifted it. */
export async function maybeResume(clientId: string, origin: string): Promise<boolean> {
  const cb = await loadClientBilling(clientId);
  if (!cb?.suspension) return false;
  if ((await unpaidRows(clientId)).length > 0) return false;
  return clearSuspension(clientId, cb.suspension.at, origin, "paid");
}

/**
 * Admin override: lift the suspension without payment (e.g. paid by bank transfer). Outstanding
 * charges get one fresh retry; if that fails too, the client is suspended again.
 */
export async function liftSuspension(clientId: string, origin: string): Promise<boolean> {
  const cb = await loadClientBilling(clientId);
  if (!cb?.suspension) return false;
  const admin = createAdminClient();
  for (const row of await unpaidRows(clientId)) {
    await admin
      .from("billing_invoices")
      .update({ retry_count: 0, next_retry_at: new Date(Date.now() + RETRY_AFTER_MS).toISOString(), updated_at: now() })
      .eq("id", row.id);
  }
  return clearSuspension(clientId, cb.suspension.at, origin, "admin");
}

async function clearSuspension(clientId: string, suspendedAt: string, origin: string, why: "paid" | "admin"): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("client_billing")
    .update({
      suspended_at: null,
      suspended_reason: null,
      suspended_invoice_id: null,
      service_paused_at: null,
      updated_at: now(),
    })
    .eq("olivia_client_id", clientId)
    .eq("suspended_at", suspendedAt)
    .select("olivia_client_id");
  if (error) throw new Error(`resume client: ${error.message}`);
  const changed = (data?.length ?? 0) > 0;
  if (changed) {
    console.warn("[billing] client resumed", { clientId, why });
    await notifyResumed(clientId, why, origin).catch((e) => console.error("[billing] resumed notification failed", e));
  }
  return changed;
}

/** The agency records that it paused (or un-paused) the client in Emma by hand. */
export async function setServicePaused(clientId: string, paused: boolean): Promise<void> {
  const { error } = await createAdminClient()
    .from("client_billing")
    .update({ service_paused_at: paused ? now() : null, updated_at: now() })
    .eq("olivia_client_id", clientId)
    .not("suspended_at", "is", null);
  if (error) throw new Error(`service paused flag: ${error.message}`);
}
