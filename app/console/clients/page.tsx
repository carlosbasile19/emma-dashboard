import { ClientsTable } from "@/components/console/ClientsTable";
import { DEFAULT_TZ, parseRange, rangeToPeriod } from "@/lib/filters";
import { getAgencyOverview } from "@/lib/olivia/agency";

export default async function ConsoleClientsPage() {
  const period = rangeToPeriod(parseRange("30d"), DEFAULT_TZ);
  const { perClient } = await getAgencyOverview(period);
  // Surface the busiest workspaces first.
  const clients = [...perClient].sort((a, b) => b.bookings - a.bookings || b.leads - a.leads);
  return <ClientsTable clients={clients} />;
}
