import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import {
  billingCardAdded,
  billingCardRemoved,
  billingNoCard,
  billingPaymentFailedAdmin,
  billingPaymentFailedClient,
  billingRunSummary,
  billingSetupLink,
  billingUsageUnavailable,
} from "@/lib/email/templates";
import { centsToMoneyExact, dayLabel, monthLabel } from "@/lib/usage";
import { ordinal } from "./copy";
import { loadBillingSettings, loadClientBilling, type CardOnFile } from "./config";

/**
 * Every billing email, in one place. All sends are fail-soft: a Resend error is logged and
 * swallowed, because a card change or an invoice must never be rolled back by a mail outage.
 *
 * This module reads platform admins directly through the service role rather than via
 * `listAgencyTeam()` — that helper gates on `requireAdmin()`, and webhooks and crons have no
 * session.
 */

/** Every platform admin's email plus the optional alerts address. Lower-cased, de-duplicated. */
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

const consoleUrl = (origin: string, clientId: string) => `${origin}/console/billing/${clientId}`;

/** Whether automatic billing is on, for the card emails; null when the lookup fails (never blocks the email). */
async function billingOnFor(clientId: string): Promise<boolean | null> {
  return loadClientBilling(clientId).then(
    (cb) => cb?.enabled === true,
    () => null,
  );
}

export async function notifyCardAdded(clientId: string, card: CardOnFile, origin: string): Promise<void> {
  const [to, clientName, billingOn] = await Promise.all([adminRecipients(), clientDisplayName(clientId), billingOnFor(clientId)]);
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
  const [to, clientName, billingOn] = await Promise.all([adminRecipients(), clientDisplayName(clientId), billingOnFor(clientId)]);
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
  month: string;
  totalCents: number;
  reason: string;
  kind: "failed" | "action_required";
  origin: string;
  /** Where the client's button goes: a fresh setup link, or the hosted invoice for authentication. */
  clientActionUrl: string | null;
}

export async function notifyPaymentFailed(a: PaymentFailedArgs): Promise<void> {
  const [admins, cb] = await Promise.all([adminRecipients(), loadClientBilling(a.clientId)]);
  const periodLabel = monthLabel(a.month);
  const amount = centsToMoneyExact(a.totalCents);
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

export async function notifyUsageUnavailable(clientId: string, clientName: string, month: string, origin: string): Promise<void> {
  const to = await adminRecipients();
  await sendTo(to, billingUsageUnavailable({ clientName, periodLabel: monthLabel(month), consoleUrl: consoleUrl(origin, clientId) }), "usage-unavailable");
}

export async function notifyNoCard(clientId: string, clientName: string, month: string, origin: string): Promise<void> {
  const to = await adminRecipients();
  await sendTo(to, billingNoCard({ clientName, periodLabel: monthLabel(month), consoleUrl: consoleUrl(origin, clientId) }), "no-card");
}

export interface RunSummaryLine {
  clientName: string;
  month: string;
  outcome: string;
  status: string | null;
  totalCents: number | null;
  error: string | null;
}

function describeLine(l: RunSummaryLine): string {
  const amount = l.totalCents == null ? "" : ` ${centsToMoneyExact(l.totalCents)}`;
  switch (l.outcome) {
    case "invoiced":
      return `invoiced${amount} — ${l.status ?? "open"}`;
    case "skipped_no_card":
      return "skipped — no card on file";
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
  a: { trigger: string; startedAt: string; lines: RunSummaryLine[] },
  origin: string,
): Promise<void> {
  const to = await adminRecipients();
  const invoiced = a.lines.filter((l) => l.outcome === "invoiced").length;
  const failed = a.lines.filter((l) => l.status === "failed" || l.status === "action_required" || l.outcome === "error").length;
  const headline = `${invoiced} invoiced, ${failed} failed (${a.trigger})`;
  await sendTo(
    to,
    billingRunSummary({
      headline,
      dateLabel: dayLabel(a.startedAt.slice(0, 10)),
      lines: a.lines.map((l) => `${l.clientName} · ${monthLabel(l.month)}: ${describeLine(l)}`),
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
  feeCents: number;
  anchorDay: number;
  expiresInDays: number;
}): Promise<{ error: string | null }> {
  const msg = billingSetupLink({
    clientName: a.clientName,
    setupUrl: a.setupUrl,
    feeLabel: a.feeCents > 0 ? centsToMoneyExact(a.feeCents) : "",
    anchorLabel: ordinal(a.anchorDay),
    expiresInDays: a.expiresInDays,
  });
  try {
    const { error } = await sendEmail({ to: a.to, ...msg });
    return { error };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unknown send error" };
  }
}
