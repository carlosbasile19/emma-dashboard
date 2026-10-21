import { notFound } from "next/navigation";
import { BillingClientView } from "@/components/console/BillingClientView";
import {
  billingFeatureEnabled,
  billingMarkupEnabled,
  defaultAgencyContact,
  defaultBillingEmail,
  getBillingSettings,
  getClientBilling,
} from "@/lib/billing/config";
import { listInvoices, nextFeeCharge, tzOf, unbilledCredits } from "@/lib/billing/invoices";
import { chargeableFeeMonths, localDate } from "@/lib/billing/schedule";
import { listSetupLinks } from "@/lib/billing/setup";
import { deriveStatus, paymentIssue } from "@/lib/billing/status";
import { listAgencyClients } from "@/lib/olivia/agency";
import { getRequestOrigin } from "@/lib/origin";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function ConsoleBillingClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SP;
}) {
  if (!billingFeatureEnabled()) notFound();
  const { id } = await params;
  const sp = await searchParams;
  const clients = await listAgencyClients(); // requireAdmin() inside — the client id must be one of ours
  const client = clients.find((c) => c.id === id);
  if (!client) notFound();

  const [settings, cb, links, baseUrl, invoices] = await Promise.all([
    getBillingSettings(),
    getClientBilling(id),
    listSetupLinks(id),
    getRequestOrigin(),
    listInvoices(id),
  ]);
  const tz = tzOf(client.timezone);
  const today = localDate(new Date(), tz);
  const [credits, nextFee, suggestedEmail, defaultContact] = await Promise.all([
    cb?.enabled ? unbilledCredits(cb, tz) : null,
    cb?.enabled ? nextFeeCharge(cb, tz) : null,
    // Who a setup link goes to when there is no billing contact yet. Only a suggestion: never fatal.
    cb?.billingEmail ? null : defaultBillingEmail(id).catch(() => null),
    defaultAgencyContact(settings).catch(() => null),
  ]);
  const status = deriveStatus({
    enabled: cb?.enabled ?? false,
    hasCard: Boolean(cb?.card),
    suspended: Boolean(cb?.suspension),
    issue: paymentIssue(invoices.map((i) => i.status)),
  });
  const feeMonthsDone = invoices.filter((i) => i.stream === "service_fee").map((i) => i.periodKey);

  return (
    <BillingClientView
      client={{ id: client.id, name: client.name, timezone: client.timezone }}
      cb={cb}
      settings={settings}
      markupEnabled={billingMarkupEnabled()}
      suggestedEmail={suggestedEmail}
      defaultContact={defaultContact}
      status={status}
      links={links}
      baseUrl={baseUrl}
      invoices={invoices}
      credits={credits}
      nextFee={nextFee}
      chargeableFeeMonths={
        cb?.enabled && cb.billFromMonth && cb.effective.feeCents > 0
          ? chargeableFeeMonths(today, cb.billFromMonth, feeMonthsDone)
          : []
      }
      canChargeCredits={Boolean(cb?.enabled && credits && credits.from < today)}
      notice={one(sp.notice) ?? null}
      error={one(sp.error) ?? null}
      extra={{ outcome: one(sp.outcome), status: one(sp.status), ok: one(sp.ok) }}
    />
  );
}
