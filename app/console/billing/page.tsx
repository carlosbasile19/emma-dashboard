import { notFound } from "next/navigation";
import { BillingOverview, type BillingOverviewRow } from "@/components/console/BillingOverview";
import {
  billingFeatureEnabled,
  billingMarkupEnabled,
  defaultAgencyContact,
  getBillingSettings,
  listClientBilling,
} from "@/lib/billing/config";
import { lastBillingRun, listInvoices, tzOf, type InvoiceRow } from "@/lib/billing/invoices";
import { creditsChargeDate, localDate } from "@/lib/billing/schedule";
import { deriveStatus, paymentIssue } from "@/lib/billing/status";
import { listAgencyClients, refreshAgencyClients } from "@/lib/olivia/agency";
import { stripeLivemode } from "@/lib/stripe/client";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const count = (v: string | string[] | undefined) => (typeof v === "string" && /^\d{1,6}$/.test(v) ? v : undefined);

export default async function ConsoleBillingPage({ searchParams }: { searchParams: SP }) {
  if (!billingFeatureEnabled()) notFound();
  const sp = await searchParams;
  await refreshAgencyClients().catch(() => {});
  const [settings, configs, clients, invoices, lastRun] = await Promise.all([
    getBillingSettings(),
    listClientBilling(),
    listAgencyClients(),
    listInvoices(),
    lastBillingRun(),
  ]);
  const defaultContact = await defaultAgencyContact(settings).catch(() => null);
  // Newest first, so the first row per client is its latest invoice.
  const byClient = new Map<string, InvoiceRow[]>();
  for (const inv of invoices) byClient.set(inv.clientId, [...(byClient.get(inv.clientId) ?? []), inv]);
  const byId = new Map(configs.map((c) => [c.clientId, c]));
  const now = new Date();
  const rows: BillingOverviewRow[] = clients.map((client) => {
    const cb = byId.get(client.id) ?? null;
    const mine = byClient.get(client.id) ?? [];
    const today = localDate(now, tzOf(client.timezone));
    return {
      client: { id: client.id, name: client.name, timezone: client.timezone },
      cb,
      status: deriveStatus({
        enabled: cb?.enabled ?? false,
        hasCard: Boolean(cb?.card),
        suspended: Boolean(cb?.suspension),
        issue: paymentIssue(mine.map((i) => i.status)),
      }),
      nextCredits: cb?.enabled && !cb.suspension ? creditsChargeDate(today) : null,
      lastInvoice: mine[0] ?? null,
    };
  });
  return (
    <BillingOverview
      settings={settings}
      defaultContact={defaultContact}
      markupEnabled={billingMarkupEnabled()}
      rows={rows}
      lastRun={lastRun}
      livemode={stripeLivemode()}
      notice={one(sp.notice) ?? null}
      error={one(sp.error) ?? null}
      runInfo={{ invoiced: count(sp.invoiced), errors: count(sp.errors) }}
    />
  );
}
