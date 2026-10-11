/**
 * User-facing billing copy. Says Emma / Hey Emma; "Skilled Coaching" is the agency's legal
 * entity and the name on the card statement, so the mandate names it too.
 */
import { centsToMoneyExact } from "@/lib/usage";

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

/** The off-session mandate shown before Checkout. Card-network rules require it. */
export function mandateText(anchorDay: number): string {
  return (
    `By saving a card you authorise Hey Emma (Skilled Coaching) to charge it automatically on the ` +
    `${ordinal(anchorDay)} of each month for the previous month's Emma usage plus the monthly fee ` +
    `shown on your Billing page. You can replace or remove the card at any time from your Billing page.`
  );
}

/** Shown inside Stripe Checkout above the submit button (max 1,200 characters). */
export const CHECKOUT_SUBMIT_MESSAGE =
  "Your card will be charged automatically each month for your Emma usage and monthly fee. " +
  "You can replace or remove it at any time from your Billing page.";

/** The plan in one line, for the client's Billing page while automatic billing is off. */
export function chargeTermsText(anchorDay: number, feeCents: number): string {
  const fee = feeCents > 0 ? ` plus a ${centsToMoneyExact(feeCents)} monthly fee` : "";
  return `When automatic billing is on, your card is charged on the ${ordinal(anchorDay)} of each month for the previous month's Emma usage${fee}.`;
}

/** The client's Billing page before automatic billing has ever run: a card can be saved, nothing is charged. */
export const BILLING_NOT_STARTED_COPY = {
  title: "Automatic billing hasn't started yet",
  body: "You can save a card now. Nothing is charged until your Hey Emma administrator switches automatic billing on for this workspace.",
};

/** Automatic billing was on and has been switched off (earlier invoices exist). */
export const BILLING_PAUSED_COPY = {
  title: "Automatic billing is paused",
  body: "Your Hey Emma administrator has paused automatic monthly billing for this workspace. No new monthly invoices are raised while it's paused.",
};
