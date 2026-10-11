import { notFound } from "next/navigation";
import { BillingOverview, type BillingOverviewRow } from "@/components/console/BillingOverview";
import { billingFeatureEnabled, getBillingSettings, listClientBilling } from "@/lib/billing/config";
import { lastBillingRun, latestInvoiceByClient, tzOf } from "@/lib/billing/invoices";
import { localDate, nextChargeDate } from "@/lib/billing/schedule";
import { deriveStatus } from "@/lib/billing/status";
import { listAgencyClients, refreshAgencyClients } from "@/lib/olivia/agency";
import { stripeLivemode } from "@/lib/stripe/client";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const count = (v: string | string[] | undefined) => (typeof v === "string" && /^\d{1,6}$/.test(v) ? v : undefined);

export default async function ConsoleBillingPage({ searchParams }: { searchParams: SP }) {
  if (!billingFeatureEnabled()) notFound();
  const sp = await searchParams;
  await refreshAgencyClients().catch(() => {});
  const [settings, configs, clients, latest, lastRun] = await Promise.all([
    getBillingSettings(),
    listClientBilling(),
    listAgencyClients(),
    latestInvoiceByClient(),
    lastBillingRun(),
  ]);
  const byId = new Map(configs.map((c) => [c.clientId, c]));
  const now = new Date();
  const rows: BillingOverviewRow[] = clients.map((client) => {
    const cb = byId.get(client.id) ?? null;
    const lastInvoice = latest.get(client.id) ?? null;
    const today = localDate(now, tzOf(client.timezone));
    return {
      client: { id: client.id, name: client.name, timezone: client.timezone },
      cb,
      status: deriveStatus({
        enabled: cb?.enabled ?? false,
        hasCard: Boolean(cb?.card),
        lastInvoiceStatus: lastInvoice?.status ?? null,
      }),
      nextCharge: cb?.enabled ? nextChargeDate(today, cb.effective.anchorDay) : null,
      lastInvoice,
    };
  });
  return (
    <BillingOverview
      settings={settings}
      rows={rows}
      lastRun={lastRun}
      livemode={stripeLivemode()}
      notice={one(sp.notice) ?? null}
      error={one(sp.error) ?? null}
      runInfo={{ invoiced: count(sp.invoiced), errors: count(sp.errors) }}
    />
  );
}
