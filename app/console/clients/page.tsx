import { ClientsTable } from "@/components/console/ClientsTable";
import { DEFAULT_TZ, parseRange, rangeToPeriod } from "@/lib/filters";
import { getAgencyOverview, getMirrorSyncedAt } from "@/lib/olivia/agency";

export default async function ConsoleClientsPage() {
  const period = rangeToPeriod(parseRange("30d"), DEFAULT_TZ);
  const [{ perClient }, syncedAt] = await Promise.all([
    getAgencyOverview(period),
    getMirrorSyncedAt(),
  ]);
  // Busiest first, but float not-yet-onboarded workspaces (no members) to the top.
  const clients = [...perClient].sort(
    (a, b) =>
      Number(a.memberCount > 0) - Number(b.memberCount > 0) ||
      b.bookings - a.bookings ||
      b.leads - a.leads,
  );
  return <ClientsTable clients={clients} syncedAt={syncedAt} />;
}
