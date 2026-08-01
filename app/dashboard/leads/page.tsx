import { LeadsTable } from "@/components/dashboard/leads/LeadsTable";
import { ErrorState } from "@/components/ui/states/ErrorState";
import { FreshnessNote } from "@/components/ui/FreshnessNote";
import { getWorkspace } from "@/lib/auth";
import { ERROR_COPY } from "@/lib/copy";
import { DEFAULT_TZ, parsePage, parseRange, rangeToPeriod, str } from "@/lib/filters";
import { fetchLeads, searchLeads } from "@/lib/olivia/service";
import type { Freshness, Lead, ListResponse } from "@/lib/types";

type SP = Promise<Record<string, string | string[] | undefined>>;

const LIMIT = 25;

// A search crawls the whole corpus, which can issue up to 25 sequential upstream calls in one
// render — well past the default function duration, so give it more room.
export const maxDuration = 60;

export default async function LeadsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const ws = await getWorkspace();
  const tz = ws.timezone ?? DEFAULT_TZ;
  const status = str(sp.status, "all");
  const source = str(sp.source, "all");
  const q = str(sp.q, "").trim();
  const page = parsePage(sp.page);

  const query = {
    ...rangeToPeriod(range, tz),
    page,
    limit: LIMIT,
    status: status === "all" ? undefined : status,
    source: source === "all" ? undefined : source,
  };

  let data: ListResponse<Lead>;
  let freshness: Freshness;
  // True only when the corpus crawl hit its page cap — surfaced so a partial search never
  // reads as a complete one.
  let truncated = false;
  try {
    // No query → the plain single-request path, unchanged. Only a real search pays for the
    // corpus crawl.
    if (q) {
      const res = await searchLeads({ ...query, q });
      data = res.data;
      freshness = res.freshness;
      truncated = res.data.truncated;
    } else {
      const res = await fetchLeads(query);
      data = res.data;
      freshness = res.freshness;
    }
  } catch {
    return <ErrorState copy={ERROR_COPY.leads} />;
  }

  const { items, total, limit } = data;
  const pages = Math.max(1, Math.ceil(total / (limit || LIMIT)));
  const clampedPage = Math.min(page, pages);
  const start = total ? (clampedPage - 1) * (limit || LIMIT) + 1 : 0;
  const end = Math.min(clampedPage * (limit || LIMIT), total);

  return (
    <>
      <FreshnessNote freshness={freshness} />
      <LeadsTable
        rows={items}
        total={total}
        page={clampedPage}
        pages={pages}
        start={start}
        end={end}
        status={status}
        source={source}
        q={q}
        truncated={truncated}
      />
    </>
  );
}
