import { notFound } from "next/navigation";
import { BillingClientView } from "@/components/console/BillingClientView";
import { billingFeatureEnabled, getBillingSettings, getClientBilling } from "@/lib/billing/config";
import { listInvoices, previewLastClosedMonth, tzOf } from "@/lib/billing/invoices";
import { closedMonthsWithoutInvoice, localDate, nextChargeDate } from "@/lib/billing/schedule";
import { listSetupLinks } from "@/lib/billing/setup";
import { deriveStatus } from "@/lib/billing/status";
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
  const preview = cb?.enabled ? await previewLastClosedMonth(cb, tz) : null;
  const status = deriveStatus({
    enabled: cb?.enabled ?? false,
    hasCard: Boolean(cb?.card),
    lastInvoiceStatus: invoices[0]?.status ?? null,
  });

  return (
    <BillingClientView
      client={{ id: client.id, name: client.name, timezone: client.timezone }}
      cb={cb}
      settings={settings}
      status={status}
      links={links}
      baseUrl={baseUrl}
      invoices={invoices}
      preview={preview}
      chargeableMonths={
        cb?.enabled && cb.billFromMonth
          ? closedMonthsWithoutInvoice(today, cb.billFromMonth, invoices.map((i) => i.periodMonth))
          : []
      }
      nextCharge={cb?.enabled ? nextChargeDate(today, cb.effective.anchorDay) : null}
      notice={one(sp.notice) ?? null}
      error={one(sp.error) ?? null}
      extra={{ outcome: one(sp.outcome), status: one(sp.status), ok: one(sp.ok) }}
    />
  );
}
