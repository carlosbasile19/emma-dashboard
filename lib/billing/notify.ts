import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import {
  billingCardAdded,
  billingCardRemoved,
  billingNoCard,
  billingPaymentFailedAdmin,
  billingPaymentFailedClient,
  billingPaymentReceived,
  billingResumed,
  billingRunSummary,
  billingSetupLink,
  billingSuspendedAgency,
  billingSuspendedClient,
  billingUsageUnavailable,
} from "@/lib/email/templates";
import { dayLabel, monthLabel } from "@/lib/usage";
import { chargeSummary, type ChargeTerms } from "./copy";
import { agencyContactFor, loadBillingSettings, loadClientBilling, type CardOnFile } from "./config";
import { moneyWithCurrency } from "./money";
import { createSetupLink, setupLinkUrl } from "./setup";
import { STREAM_LABEL, type InvoiceStream } from "./status";

/**
 * Every billing email, in one place. All sends are fail-soft: a Resend error is logged and
 * swallowed, because a card change or an invoice must never be rolled back by a mail outage.
 *
 * This module reads platform admins directly through the service role rather than via
 * `listAgencyTeam()` — that helper gates on `requireAdmin()`, and webhooks and crons have no
 * session.
 */

/**
 * Every platform admin's email plus the optional alerts address. Lower-cased, de-duplicated.
 * Platform-wide mail only (run summaries, usage outages); per-client mail goes to
 * `agencyRecipients`.
 */
export async function adminRecipients(): Promise<string[]> {
  const admin = createAdminClient();
  const [{ data: members }, users, settings] = await Promise.all([
    admin.from("workspace_members").select("user_id").eq("role", "platform_admin"),
    admin.auth.admin.listUsers({ perPage: 1000 }),
    loadBillingSettings(),
  ]);
  const adminIds = new Set((members ?? []).map((m) => m.user_id as string));
  const emails = new Set<string>();
  for (const u of users.data?.users ?? []) {
    if (u.email && adminIds.has(u.id)) emails.add(u.email.toLowerCase());
  }
  if (settings.alertEmail) emails.add(settings.alertEmail.toLowerCase());
  return [...emails];
}

export async function clientDisplayName(clientId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("olivia_clients")
    .select("name")
    .eq("olivia_client_id", clientId)
    .maybeSingle();
  return (data?.name as string | null) ?? clientId;
}

/** "Visa ····4242 (exp 12/30)" */
export function cardLabel(card: CardOnFile | null): string {
  if (!card) return "no card";
  const brand = card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : "Card";
  const exp =
    card.expMonth && card.expYear
      ? ` (exp ${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)})`
      : "";
  return `${brand} ····${card.last4 ?? "????"}${exp}`;
}

async function sendTo(
  recipients: string[],
  msg: { subject: string; html: string; text: string },
  tag: string,
): Promise<void> {
  await Promise.all(
    recipients.map(async (to) => {
      try {
        const { error } = await sendEmail({ to, ...msg });
        if (error) console.error(`[billing:${tag}] email to ${to} failed:`, error);
      } catch (e) {
        console.error(`[billing:${tag}] email to ${to} threw:`, e);
      }
    }),
  );
}

/**
 * The client's "Billing contact at agency": its own address, else the agency default (the alerts
 * email, else the earliest admin). Falls back to every admin rather than dropping an alert.
 */
export async function agencyRecipients(clientId: string): Promise<string[]> {
  try {
    const contact = await agencyContactFor(await loadClientBilling(clientId));
    if (contact) return [contact];
  } catch (e) {
    console.error("[billing] agency contact lookup failed; falling back to all admins", e);
  }
  return adminRecipients();
}

const consoleUrl = (origin: string, clientId: string) => `${origin}/console/billing/${clientId}`;

/** Whether automatic billing is on, for the card emails; null when the lookup fails (never blocks the email). */
async function billingOnFor(clientId: string): Promise<boolean | null> {
  return loadClientBilling(clientId).then(
    (cb) => cb?.enabled === true,
    () => null,
  );
}

export async function notifyCardAdded(clientId: string, card: CardOnFile, origin: string): Promise<void> {
  const [to, clientName, billingOn] = await Promise.all([agencyRecipients(clientId), clientDisplayName(clientId), billingOnFor(clientId)]);
  await sendTo(
    to,
    billingCardAdded({ clientName, cardLabel: cardLabel(card), consoleUrl: consoleUrl(origin, clientId), billingOn }),
    "card-added",
  );
}

export async function notifyCardRemoved(
  clientId: string,
  reason: "removed" | "detached" | "customer_deleted",
  origin: string,
): Promise<void> {
  const [to, clientName, billingOn] = await Promise.all([agencyRecipients(clientId), clientDisplayName(clientId), billingOnFor(clientId)]);
  const detail =
    reason === "removed"
      ? "removed from the Billing page"
      : reason === "detached"
        ? "removed in Stripe"
        : "the Stripe customer was deleted";
  await sendTo(to, billingCardRemoved({ clientName, detail, consoleUrl: consoleUrl(origin, clientId), billingOn }), "card-removed");
}

export interface PaymentFailedArgs {
  clientId: string;
  clientName: string;
  stream: InvoiceStream;
  /** "6 Oct 2026 – 12 Oct 2026" / "November 2026" */
  periodLabel: string;
  currency: string;
  totalCents: number;
  reason: string;
  kind: "failed" | "action_required";
  origin: string;
  /** Where the client's button goes: a fresh setup link, or the hosted invoice for authentication. */
  clientActionUrl: string | null;
}

export async function notifyPaymentFailed(a: PaymentFailedArgs): Promise<void> {
  const [admins, cb] = await Promise.all([agencyRecipients(a.clientId), loadClientBilling(a.clientId)]);
  const periodLabel = `${STREAM_LABEL[a.stream]} · ${a.periodLabel}`;
  const amount = moneyWithCurrency(a.totalCents, a.currency);
  await sendTo(
    admins,
    billingPaymentFailedAdmin({ clientName: a.clientName, periodLabel, amount, reason: a.reason, kind: a.kind, consoleUrl: consoleUrl(a.origin, a.clientId) }),
    "payment-failed-admin",
  );
  if (cb?.billingEmail && a.clientActionUrl) {
    await sendTo(
      [cb.billingEmail],
      billingPaymentFailedClient({
        clientName: a.clientName,
        periodLabel,
        amount,
        reason: a.reason,
        kind: a.kind,
        actionLabel: a.kind === "action_required" ? "Complete payment" : "Update your card",
        actionUrl: a.clientActionUrl,
      }),
      "payment-failed-client",
    );
  }
}

export async function notifyUsageUnavailable(clientId: string, clientName: string, periodLabel: string, origin: string): Promise<void> {
  const to = await adminRecipients();
  await sendTo(to, billingUsageUnavailable({ clientName, periodLabel, consoleUrl: consoleUrl(origin, clientId) }), "usage-unavailable");
}

export async function notifyNoCard(clientId: string, clientName: string, month: string, origin: string): Promise<void> {
  const to = await agencyRecipients(clientId);
  await sendTo(to, billingNoCard({ clientName, periodLabel: monthLabel(month), consoleUrl: consoleUrl(origin, clientId) }), "no-card");
}

export interface RunSummaryLine {
  clientName: string;
  /** "AI Power Credits · 6 Oct 2026 – 12 Oct 2026" */
  label: string;
  outcome: string;
  status: string | null;
  totalCents: number | null;
  /** null = the fee's own currency, not known here: the amount is shown without a code. */
  currency: string | null;
  error: string | null;
}

function describeLine(l: RunSummaryLine): string {
  const amount = l.totalCents == null ? "" : ` ${l.currency ? moneyWithCurrency(l.totalCents, l.currency) : (l.totalCents / 100).toFixed(2)}`;
  switch (l.outcome) {
    case "invoiced":
      return `invoiced${amount} — ${l.status ?? "open"}`;
    case "skipped_no_card":
      return "skipped — no card on file";
    case "skipped_suspended":
      return "skipped — client suspended";
    case "skipped_zero":
      return "nothing to bill";
    case "usage_unavailable":
      return "usage unavailable — will retry tomorrow";
    case "already_invoiced":
      return "already invoiced";
    default:
      return `error: ${l.error ?? "unknown"}`;
  }
}

export async function notifyRunSummary(
  a: { trigger: string; startedAt: string; lines: RunSummaryLine[]; sweep: { retried: number; recovered: number; suspended: number } },
  origin: string,
): Promise<void> {
  const to = await adminRecipients();
  const invoiced = a.lines.filter((l) => l.outcome === "invoiced").length;
  const failed = a.lines.filter((l) => l.status === "failed" || l.status === "action_required" || l.outcome === "error").length;
  const sweep = a.sweep.retried > 0 || a.sweep.suspended > 0
    ? `; ${a.sweep.retried} retried (${a.sweep.recovered} recovered), ${a.sweep.suspended} suspended`
    : "";
  const headline = `${invoiced} invoiced, ${failed} failed${sweep} (${a.trigger})`;
  await sendTo(
    to,
    billingRunSummary({
      headline,
      dateLabel: dayLabel(a.startedAt.slice(0, 10)),
      lines: a.lines.map((l) => `${l.clientName} · ${l.label}: ${describeLine(l)}`),
      consoleUrl: `${origin}/console/billing`,
    }),
    "run-summary",
  );
}

export async function sendSetupLinkEmail(a: {
  clientId: string;
  clientName: string;
  to: string;
  setupUrl: string;
  terms: ChargeTerms;
  expiresInDays: number;
}): Promise<{ error: string | null }> {
  const msg = billingSetupLink({
    clientName: a.clientName,
    setupUrl: a.setupUrl,
    chargeSummary: chargeSummary(a.terms),
    expiresInDays: a.expiresInDays,
  });
  try {
    const { error } = await sendEmail({ to: a.to, ...msg });
    return { error };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unknown send error" };
  }
}

/** The agency's receipt copy for a successful charge (the client gets Stripe's own receipt). */
export async function notifyPaymentReceived(a: {
  clientId: string;
  clientName: string;
  stream: InvoiceStream;
  periodLabel: string;
  totalCents: number;
  currency: string;
  origin: string;
}): Promise<void> {
  const to = await agencyRecipients(a.clientId);
  await sendTo(
    to,
    billingPaymentReceived({
      clientName: a.clientName,
      periodLabel: `${STREAM_LABEL[a.stream]} · ${a.periodLabel}`,
      amount: moneyWithCurrency(a.totalCents, a.currency),
      consoleUrl: consoleUrl(a.origin, a.clientId),
    }),
    "payment-received",
  );
}

/** Suspension notices: the agency (with the manual pause step) and the client's billing contact. */
export async function notifySuspended(clientId: string, reason: string, origin: string): Promise<void> {
  const [agency, cb, clientName] = await Promise.all([agencyRecipients(clientId), loadClientBilling(clientId), clientDisplayName(clientId)]);
  await sendTo(agency, billingSuspendedAgency({ clientName, reason, consoleUrl: consoleUrl(origin, clientId) }), "suspended-agency");
  if (cb?.billingEmail && origin) {
    const link = await createSetupLink(clientId, null);
    await sendTo([cb.billingEmail], billingSuspendedClient({ clientName, actionUrl: setupLinkUrl(origin, link.token) }), "suspended-client");
  }
}

export async function notifyResumed(clientId: string, why: "paid" | "admin", origin: string): Promise<void> {
  const [agency, cb, clientName] = await Promise.all([agencyRecipients(clientId), loadClientBilling(clientId), clientDisplayName(clientId)]);
  await sendTo(agency, billingResumed({ clientName, audience: "agency", why, url: consoleUrl(origin, clientId) }), "resumed-agency");
  if (cb?.billingEmail) {
    await sendTo([cb.billingEmail], billingResumed({ clientName, audience: "client", why, url: `${origin}/dashboard/billing` }), "resumed-client");
  }
}
