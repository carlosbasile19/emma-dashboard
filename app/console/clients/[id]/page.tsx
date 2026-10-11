import { notFound } from "next/navigation";
import { ClientDetailView, type ClientBillingSummary } from "@/components/console/ClientDetailView";
import { billingFeatureEnabled, getClientBilling } from "@/lib/billing/config";
import { listInvoices, tzOf } from "@/lib/billing/invoices";
import { cardLabel } from "@/lib/billing/notify";
import { localDate, nextChargeDate } from "@/lib/billing/schedule";
import { deriveStatus, STATUS_LABEL } from "@/lib/billing/status";
import { DEFAULT_TZ, parseRange, rangeToPeriod } from "@/lib/filters";
import { getClientDetail } from "@/lib/olivia/agency";
import { dayLabel } from "@/lib/usage";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const period = rangeToPeriod(parseRange("30d"), DEFAULT_TZ);
  const detail = await getClientDetail(id, period);
  if (!detail) notFound();

  let billing: ClientBillingSummary | null = null;
  if (billingFeatureEnabled()) {
    // The billing card is a convenience: a billing read failure must not break the client page.
    try {
      const [cb, invoices] = await Promise.all([getClientBilling(id), listInvoices(id)]);
      const status = deriveStatus({
        enabled: cb?.enabled ?? false,
        hasCard: Boolean(cb?.card),
        lastInvoiceStatus: invoices[0]?.status ?? null,
      });
      billing = {
        statusLabel: STATUS_LABEL[status],
        cardLabel: cardLabel(cb?.card ?? null),
        nextCharge: cb?.enabled
          ? dayLabel(nextChargeDate(localDate(new Date(), tzOf(detail.client.timezone)), cb.effective.anchorDay))
          : null,
      };
    } catch (e) {
      console.error("[billing] client detail summary failed", e);
    }
  }
  return <ClientDetailView detail={detail} billing={billing} />;
}
