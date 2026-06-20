import { LeadsTable } from "@/components/dashboard/leads/LeadsTable";
import { ErrorState } from "@/components/ui/states/ErrorState";
import { FreshnessNote } from "@/components/ui/FreshnessNote";
import { getWorkspace } from "@/lib/auth";
import { ERROR_COPY } from "@/lib/copy";
import { DEFAULT_TZ, parsePage, parseRange, rangeToPeriod, str } from "@/lib/filters";
import { fetchLeads } from "@/lib/olivia/service";

type SP = Promise<Record<string, string | string[] | undefined>>;

const LIMIT = 25;

export default async function LeadsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const ws = await getWorkspace();
  const tz = ws.timezone ?? DEFAULT_TZ;
  const status = str(sp.status, "all");
  const source = str(sp.source, "all");
  const page = parsePage(sp.page);

  let result;
  try {
    result = await fetchLeads({
      ...rangeToPeriod(range, tz),
      page,
      limit: LIMIT,
      status: status === "all" ? undefined : status,
      source: source === "all" ? undefined : source,
    });
  } catch {
    return <ErrorState copy={ERROR_COPY.leads} />;
  }

  const { items, total, limit } = result.data;
  const pages = Math.max(1, Math.ceil(total / (limit || LIMIT)));
  const clampedPage = Math.min(page, pages);
  const start = total ? (clampedPage - 1) * (limit || LIMIT) + 1 : 0;
  const end = Math.min(clampedPage * (limit || LIMIT), total);

  return (
    <>
      <FreshnessNote freshness={result.freshness} />
      <LeadsTable
        rows={items}
        total={total}
        page={clampedPage}
        pages={pages}
        start={start}
        end={end}
        status={status}
        source={source}
      />
    </>
  );
}
