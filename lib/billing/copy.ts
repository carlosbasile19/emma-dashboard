/**
 * User-facing billing copy. Says Emma / Hey Emma; "Skilled Coaching" is the agency's legal
 * entity and the name on the card statement, so the mandate names it too.
 */

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

export const BILLING_DISABLED_COPY = {
  title: "Billing isn't set up for this workspace",
  body: "Your Hey Emma administrator hasn't switched on automatic billing here yet. Nothing is charged until they do.",
};
