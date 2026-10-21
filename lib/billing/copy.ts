/**
 * User-facing billing copy. Says Emma / Hey Emma; "Skilled Coaching" is the agency's legal
 * entity and the name on the card statement, so the mandate names it too.
 *
 * Two charge streams, always described together: AI Power Credits in USD every Monday, and the
 * agency's monthly service fee (its own amount and currency) on the anchor day. Emma's wholesale
 * price is never part of anything here.
 */
import { moneyWithCurrency } from "./money";

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export const CREDITS_LABEL = "AI Power Credits";
export const SERVICE_FEE_LABEL = "Monthly service fee";

export interface ChargeTerms {
  /** The service fee in `feeCurrency` cents; 0 = no fee. */
  feeCents: number;
  feeCurrency: string;
  anchorDay: number;
}

/** "plus your monthly service fee of $450.00 AUD on the 3rd of each month" — or "" with no fee. */
function feeClause(t: ChargeTerms): string {
  return t.feeCents > 0
    ? `, plus your monthly service fee of ${moneyWithCurrency(t.feeCents, t.feeCurrency)} on the ${ordinal(t.anchorDay)} of each month`
    : "";
}

/** The plan in one sentence: the card setup page, the Billing page and the setup-link email. */
export function chargeSummary(t: ChargeTerms): string {
  return `Your card will be charged weekly (every Monday) for ${CREDITS_LABEL} in USD${feeClause(t)}.`;
}

/** The off-session mandate shown before Checkout. Card-network rules require it. */
export function mandateText(t: ChargeTerms): string {
  const fee =
    t.feeCents > 0
      ? ` and, on the ${ordinal(t.anchorDay)} of each month, the monthly service fee for that month`
      : "";
  return (
    `By saving a card you authorise Hey Emma (Skilled Coaching) to charge it automatically every ` +
    `Monday for the previous week's ${CREDITS_LABEL} (USD), earlier if usage reaches your ` +
    `low-balance limit${fee}. If a charge fails and its retry also fails, service is paused until ` +
    `payment succeeds. You can replace or remove the card at any time from your Billing page.`
  );
}

/** Shown inside Stripe Checkout above the submit button (max 1,200 characters). */
export function checkoutSubmitMessage(t: ChargeTerms): string {
  return `${chargeSummary(t)} You can replace or remove the card at any time from your Billing page.`;
}

/** The client's Billing page before automatic billing has ever run: a card can be saved, nothing is charged. */
export const BILLING_NOT_STARTED_COPY = {
  title: "Automatic billing hasn't started yet",
  body: "You can save a card now. Nothing is charged until your Hey Emma administrator switches automatic billing on for this workspace.",
};

/** Automatic billing was on and has been switched off (earlier invoices exist). */
export const BILLING_PAUSED_COPY = {
  title: "Automatic billing is paused",
  body: "Your Hey Emma administrator has paused automatic billing for this workspace. No new charges are raised while it's paused.",
};

/** The client is suspended for non-payment. */
export const SUSPENDED_COPY = {
  title: "Service paused: payment needed",
  body: "A charge to your card failed and its retry failed too, so your Emma service is paused. Update your card below and the outstanding charges are retried straight away; service resumes as soon as they're paid.",
};
