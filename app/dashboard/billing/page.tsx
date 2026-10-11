import { notFound, redirect } from "next/navigation";
import { ErrorState } from "@/components/ui/states/ErrorState";
import { BillingDisabled, BillingView } from "@/components/dashboard/billing/BillingView";
import { getWorkspace } from "@/lib/auth";
import { billingFeatureEnabled, getClientBilling } from "@/lib/billing/config";
import { estimateCurrentMonth, listInvoices, tzOf } from "@/lib/billing/invoices";
import { reconcileCheckoutSession } from "@/lib/billing/setup";
import { ERROR_COPY } from "@/lib/copy";
import { getRequestOrigin } from "@/lib/origin";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * The client's Billing page. Reachable only through the session's active workspace. Returning
 * from Stripe lands here with `session_id`; the card is confirmed server-side and the browser is
 * sent to a clean URL so a refresh doesn't re-run the reconcile.
 */
export default async function BillingPage({ searchParams }: { searchParams: SP }) {
  if (!billingFeatureEnabled()) notFound();
  const sp = await searchParams;
  const ws = await getWorkspace();
  let cb;
  try {
    cb = await getClientBilling(ws.clientId);
  } catch (e) {
    console.error("[billing] could not load billing config:", e);
    return <ErrorState copy={ERROR_COPY.billing} />;
  }
  if (!cb?.enabled) return <BillingDisabled />;

  const sessionId = one(sp.session_id);
  if (sessionId) {
    // Never throws to the member: anything but a confirmed (or already-adopted) card is a notice.
    let ok = false;
    try {
      const result = await reconcileCheckoutSession(sessionId, ws.clientId, await getRequestOrigin());
      ok = result.ok || result.reason === "already_adopted";
    } catch (e) {
      console.error("[billing] checkout reconcile failed:", e);
    }
    redirect(ok ? "/dashboard/billing?notice=card_added" : "/dashboard/billing?error=setup");
  }

  const tz = tzOf(ws.timezone);
  let invoices, figure;
  try {
    [invoices, figure] = await Promise.all([listInvoices(ws.clientId), estimateCurrentMonth(cb, tz)]);
  } catch (e) {
    console.error("[billing] could not load invoices/estimate:", e);
    return <ErrorState copy={ERROR_COPY.billing} />;
  }
  const notice = one(sp.notice) ?? (one(sp.setup) === "cancelled" ? "setup_cancelled" : null);

  return (
    <BillingView
      clientName={ws.name}
      card={cb.card}
      billingEmail={cb.billingEmail}
      anchorDay={cb.effective.anchorDay}
      estimate={{
        label: figure.label,
        usageCents: figure.lines?.billedUsageCents ?? null,
        feeCents: cb.effective.feeCents,
        totalCents: figure.lines?.totalCents ?? null,
        nextChargeDate: figure.nextChargeDate,
      }}
      invoices={invoices}
      notice={notice}
      error={one(sp.error) ?? null}
    />
  );
}
