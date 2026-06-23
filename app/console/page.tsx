import { AgencyOverviewView } from "@/components/console/AgencyOverviewView";
import { DEFAULT_TZ, parseRange, rangeToPeriod } from "@/lib/filters";
import { getAgencyOverview, refreshAgencyClients } from "@/lib/olivia/agency";

export default async function ConsolePage() {
  // Keep the client mirror current (no-op unless the last sync is >10 min old).
  await refreshAgencyClients().catch(() => {});
  const period = rangeToPeriod(parseRange("30d"), DEFAULT_TZ);
  const overview = await getAgencyOverview(period);
  return <AgencyOverviewView overview={overview} />;
}
