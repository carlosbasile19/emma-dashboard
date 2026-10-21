import { renderShell } from "./layout";

const MAGIC_HELP =
  "When you accept, we'll email you a one-click magic link to sign in — no password needed.";

export interface WorkspaceInviteArgs {
  inviterName: string;
  clientName: string;
  email: string;
  acceptUrl: string;
  expiresInDays: number;
}

export function workspaceInvite(
  a: WorkspaceInviteArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `${a.inviterName} added you to the ${a.clientName} workspace on Hey Emma.`,
    eyebrow: "Workspace invitation",
    heading: "You've been invited to Hey Emma",
    bodyParagraphs: [
      `${a.inviterName} invited you to the ${a.clientName} workspace on Hey Emma — your read-only view of leads, calls, campaigns and outcomes from Emma.`,
    ],
    cta: { label: "Accept your invitation", url: a.acceptUrl },
    notes: [`This invite is just for ${a.email} and expires in ${a.expiresInDays} days.`, MAGIC_HELP],
  });
  return { subject: `You're invited to ${a.clientName} on Hey Emma`, html, text };
}

export interface TeamInviteArgs {
  inviterName: string;
  email: string;
  acceptUrl: string;
  expiresInDays: number;
}

export function teamInvite(
  a: TeamInviteArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `${a.inviterName} invited you to the Hey Emma console as an admin.`,
    eyebrow: "Team invitation",
    heading: "You've been invited to the agency team",
    bodyParagraphs: [
      `${a.inviterName} invited you to join the Hey Emma agency team as an admin — full console access: every client workspace, team management and invites.`,
    ],
    cta: { label: "Join the team", url: a.acceptUrl },
    notes: [`This invite is just for ${a.email} and expires in ${a.expiresInDays} days.`, MAGIC_HELP],
  });
  return { subject: "You're invited to the Hey Emma agency team", html, text };
}

export interface MagicLinkArgs {
  verifyUrl: string;
  code: string;
}

export function magicLink(
  a: MagicLinkArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: "Your one-click link to sign in to Hey Emma.",
    eyebrow: "Sign in",
    heading: "Here's your magic link",
    bodyParagraphs: ["Click below to sign in to Hey Emma. This link works once and expires soon."],
    cta: { label: "Sign in to Hey Emma", url: a.verifyUrl },
    notes: [
      `Prefer to type it? Enter this code: ${a.code}`,
      "If you didn't request this, you can safely ignore this email.",
    ],
  });
  return { subject: "Your Hey Emma sign-in link", html, text };
}

export interface SupabaseEmailData {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
}

/**
 * Build the verification link that lands on /auth/callback (which calls verifyOtp with
 * { type, token_hash }). Uses the redirect_to Supabase passes (already our callback URL);
 * falls back to site_url + /auth/callback if redirect_to is empty.
 */
export function buildVerifyUrl(d: SupabaseEmailData): string {
  const base = d.redirect_to && d.redirect_to.length > 0 ? d.redirect_to : `${d.site_url}/auth/callback`;
  const u = new URL(base);
  u.searchParams.set("token_hash", d.token_hash);
  u.searchParams.set("type", d.email_action_type);
  return u.toString();
}

// ---- Billing ----
// All billing mail reuses the shell. Admin mail links to the console; client mail links to a
// card-setup page or the Stripe-hosted invoice. Copy says Emma / Hey Emma only.

export interface BillingSetupLinkArgs {
  clientName: string;
  setupUrl: string;
  /** The full charge sentence (lib/billing/copy.ts `chargeSummary`): both streams, the agency's fee and currency. */
  chargeSummary: string;
  expiresInDays: number;
}

export function billingSetupLink(
  a: BillingSetupLinkArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `Add a card to ${a.clientName}'s Hey Emma account for automatic billing.`,
    eyebrow: "Billing setup",
    heading: "Add a card for automatic billing",
    bodyParagraphs: [
      a.chargeSummary,
      "Add a card securely with Stripe — it takes a minute, and you can replace or remove it at any time from your Billing page.",
    ],
    cta: { label: "Add your card", url: a.setupUrl },
    notes: [`This link expires in ${a.expiresInDays} days. Only use it if you manage billing for ${a.clientName}.`],
  });
  return { subject: `Add a card for ${a.clientName} on Hey Emma`, html, text };
}

export interface BillingCardAddedArgs {
  clientName: string;
  cardLabel: string;
  consoleUrl: string;
  /** Automatic billing is on for the client (a card can be saved before it is); null = unknown. */
  billingOn: boolean | null;
}

export function billingCardAdded(
  a: BillingCardAddedArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `${a.clientName} added ${a.cardLabel}.`,
    eyebrow: "Billing",
    heading: "A card was added",
    bodyParagraphs: [
      a.billingOn === true
        ? `${a.clientName} now has ${a.cardLabel} on file. Automatic billing will charge it on the next charge date.`
        : a.billingOn === false
          ? `${a.clientName} now has ${a.cardLabel} on file. Automatic billing is off for this client, so nothing is charged until you switch it on in the console.`
          : `${a.clientName} now has ${a.cardLabel} on file.`,
    ],
    cta: { label: "Open billing", url: a.consoleUrl },
  });
  return { subject: `Card added: ${a.clientName}`, html, text };
}

export interface BillingCardRemovedArgs {
  clientName: string;
  /** "removed from the Billing page" / "removed in Stripe" / "the Stripe customer was deleted" */
  detail: string;
  consoleUrl: string;
  /** Automatic billing is on for the client; null = unknown. */
  billingOn: boolean | null;
}

export function billingCardRemoved(
  a: BillingCardRemovedArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `${a.clientName} no longer has a card on file.`,
    eyebrow: "Billing",
    heading: "A card was removed",
    bodyParagraphs: [
      a.billingOn === true
        ? `${a.clientName} no longer has a card on file (${a.detail}). Their next charge will be skipped until a new card is added — send them a setup link from the console.`
        : a.billingOn === false
          ? `${a.clientName} no longer has a card on file (${a.detail}). Automatic billing is off for this client; send them a setup link from the console before you switch it on.`
          : `${a.clientName} no longer has a card on file (${a.detail}).`,
    ],
    cta: { label: "Open billing", url: a.consoleUrl },
  });
  return { subject: `Card removed: ${a.clientName}`, html, text };
}

export interface BillingPaymentFailedAdminArgs {
  clientName: string;
  /** "AI Power Credits · 6 Oct 2026 – 12 Oct 2026" */
  periodLabel: string;
  amount: string;
  reason: string;
  kind: "failed" | "action_required";
  consoleUrl: string;
}

export function billingPaymentFailedAdmin(
  a: BillingPaymentFailedAdminArgs,
): { subject: string; html: string; text: string } {
  const needsAuth = a.kind === "action_required";
  const { html, text } = renderShell({
    preheader: `${a.clientName}'s ${a.amount} payment for ${a.periodLabel} did not go through.`,
    eyebrow: "Billing",
    heading: needsAuth ? "A payment needs the client's authentication" : "A payment failed",
    bodyParagraphs: [
      `The ${a.amount} invoice for ${a.periodLabel} could not be charged to ${a.clientName}'s card.`,
      `Reason: ${a.reason}`,
      needsAuth
        ? "The client has been emailed a link to authenticate the payment with their bank. Nothing further is needed from you unless they don't complete it."
        : "The charge is retried once in about a day. If the retry fails too, the client is suspended: no new charges are raised and you'll be asked to pause their service in Emma. The client has been emailed a link to update their card; a new card retries the charge straight away.",
    ],
    cta: { label: "Open billing", url: a.consoleUrl },
  });
  return {
    subject: `${needsAuth ? "Payment needs authentication" : "Payment failed"}: ${a.clientName} · ${a.periodLabel}`,
    html,
    text,
  };
}

export interface BillingPaymentFailedClientArgs {
  clientName: string;
  /** "AI Power Credits · 6 Oct 2026 – 12 Oct 2026" */
  periodLabel: string;
  amount: string;
  reason: string;
  kind: "failed" | "action_required";
  actionLabel: string;
  actionUrl: string;
}

export function billingPaymentFailedClient(
  a: BillingPaymentFailedClientArgs,
): { subject: string; html: string; text: string } {
  const needsAuth = a.kind === "action_required";
  const { html, text } = renderShell({
    preheader: `Your Hey Emma payment of ${a.amount} for ${a.periodLabel} needs attention.`,
    eyebrow: "Billing",
    heading: needsAuth ? "Please authenticate your payment" : "We couldn't charge your card",
    bodyParagraphs: [
      `The ${a.amount} charge for ${a.clientName} (${a.periodLabel}) ${needsAuth ? "needs a quick confirmation with your bank" : "could not be charged to the card on file"}.`,
      `Reason: ${a.reason}`,
      needsAuth
        ? "Use the button below to complete the payment securely with Stripe. If it isn't completed within about a day, your Emma service is paused until it is."
        : "Add a new card below and we'll retry the charge straight away. Otherwise we retry once in about a day; if that fails too, your Emma service is paused until payment succeeds.",
    ],
    cta: { label: a.actionLabel, url: a.actionUrl },
  });
  return { subject: `Action needed: your Hey Emma payment for ${a.periodLabel}`, html, text };
}

export interface BillingUsageUnavailableArgs {
  clientName: string;
  periodLabel: string;
  consoleUrl: string;
}

export function billingUsageUnavailable(
  a: BillingUsageUnavailableArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `${a.clientName}'s ${a.periodLabel} invoice was not created.`,
    eyebrow: "Billing",
    heading: "Usage could not be loaded",
    bodyParagraphs: [
      `Emma's usage figures for ${a.clientName} (${a.periodLabel}) could not be loaded, so no AI Power Credits invoice was created and nothing was charged. The daily run will try again tomorrow.`,
      "If this repeats, check the Usage report for the same days — a figure that is missing there is missing here.",
    ],
    cta: { label: "Open billing", url: a.consoleUrl },
  });
  return { subject: `Could not bill ${a.clientName} for ${a.periodLabel}`, html, text };
}

export interface BillingNoCardArgs {
  clientName: string;
  periodLabel: string;
  consoleUrl: string;
}

export function billingNoCard(
  a: BillingNoCardArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `${a.clientName} has no card on file; ${a.periodLabel} was not charged.`,
    eyebrow: "Billing",
    heading: "No card on file",
    bodyParagraphs: [
      `A charge for ${a.periodLabel} is due for ${a.clientName}, but they have no card on file, so nothing was charged. Send them a setup link from the console; everything owed is charged on the next run after a card is added.`,
    ],
    cta: { label: "Open billing", url: a.consoleUrl },
  });
  return { subject: `No card on file: ${a.clientName} (${a.periodLabel} not charged)`, html, text };
}

export interface BillingRunSummaryArgs {
  /** "2 invoiced, 1 failed" */
  headline: string;
  dateLabel: string;
  /** One line per charge, already formatted. */
  lines: string[];
  consoleUrl: string;
}

export function billingRunSummary(
  a: BillingRunSummaryArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `Billing run ${a.dateLabel}: ${a.headline}.`,
    eyebrow: "Billing run",
    heading: `Billing run · ${a.dateLabel}`,
    bodyParagraphs: [a.headline, ...a.lines],
    cta: { label: "Open billing", url: a.consoleUrl },
  });
  return { subject: `Billing run ${a.dateLabel}: ${a.headline}`, html, text };
}

export interface BillingPaymentReceivedArgs {
  clientName: string;
  /** "AI Power Credits · 6 Oct 2026 – 12 Oct 2026" */
  periodLabel: string;
  /** "$120.40 USD" */
  amount: string;
  consoleUrl: string;
}

/** The agency's receipt copy: the client gets Stripe's own receipt. */
export function billingPaymentReceived(
  a: BillingPaymentReceivedArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `${a.clientName} paid ${a.amount}.`,
    eyebrow: "Billing receipt",
    heading: "Payment received",
    bodyParagraphs: [`${a.clientName} was charged ${a.amount} for ${a.periodLabel}. The payment succeeded.`],
    cta: { label: "Open billing", url: a.consoleUrl },
  });
  return { subject: `Payment received: ${a.clientName} · ${a.amount}`, html, text };
}

export interface BillingSuspendedAgencyArgs {
  clientName: string;
  reason: string;
  consoleUrl: string;
}

export function billingSuspendedAgency(
  a: BillingSuspendedAgencyArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `${a.clientName} is suspended for non-payment. Pause their service in Emma.`,
    eyebrow: "Billing",
    heading: "Client suspended: action needed",
    bodyParagraphs: [
      `${a.clientName} has been suspended for non-payment. ${a.reason}.`,
      "No new charges are raised while they're suspended. Emma can't pause calls automatically yet, so pause this client's campaigns in Emma now to stop calls and credit use, then tick \"Service paused in Emma\" in the console.",
      "The suspension lifts itself as soon as the outstanding charges are paid; the client has been emailed a link to update their card.",
    ],
    cta: { label: "Open billing", url: a.consoleUrl },
  });
  return { subject: `Suspended: ${a.clientName} (payment failed twice)`, html, text };
}

export interface BillingSuspendedClientArgs {
  clientName: string;
  actionUrl: string;
}

export function billingSuspendedClient(
  a: BillingSuspendedClientArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `Your Emma service for ${a.clientName} is paused until payment succeeds.`,
    eyebrow: "Billing",
    heading: "Your Emma service is paused",
    bodyParagraphs: [
      `A charge for ${a.clientName} failed and its retry failed too, so your Emma service is paused.`,
      "Update your card below: the outstanding charges are retried straight away and your service resumes as soon as they're paid.",
    ],
    cta: { label: "Update your card", url: a.actionUrl },
  });
  return { subject: `Your Emma service for ${a.clientName} is paused`, html, text };
}

export interface BillingResumedArgs {
  clientName: string;
  /** Agency copy says what to do next; client copy just confirms. */
  audience: "agency" | "client";
  /** "paid": the outstanding charges were paid; "admin": the agency lifted it. */
  why: "paid" | "admin";
  url: string;
}

export function billingResumed(a: BillingResumedArgs): { subject: string; html: string; text: string } {
  const agency = a.audience === "agency";
  const { html, text } = renderShell({
    preheader: `${a.clientName}'s Emma service can resume.`,
    eyebrow: "Billing",
    heading: agency ? "Suspension lifted" : "Your Emma service is back on",
    bodyParagraphs: agency
      ? [
          a.why === "paid"
            ? `${a.clientName}'s outstanding charges are paid, so their suspension has lifted.`
            : `${a.clientName}'s suspension was lifted from the console. Outstanding charges get one more retry.`,
          "If you paused their campaigns in Emma, resume them now. Missed charges are caught up on the next billing run.",
        ]
      : [`Thanks, payment for ${a.clientName} went through. Your Emma service is back on.`],
    cta: { label: agency ? "Open billing" : "Open billing", url: a.url },
  });
  return { subject: agency ? `Suspension lifted: ${a.clientName}` : `Your Emma service for ${a.clientName} is back on`, html, text };
}
