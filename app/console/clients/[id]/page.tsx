import { notFound } from "next/navigation";
import { ClientDetailView } from "@/components/console/ClientDetailView";
import { DEFAULT_TZ, parseRange, rangeToPeriod } from "@/lib/filters";
import { getClientDetail } from "@/lib/olivia/agency";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const period = rangeToPeriod(parseRange("30d"), DEFAULT_TZ);
  const detail = await getClientDetail(id, period);
  if (!detail) notFound();
  return <ClientDetailView detail={detail} />;
}
