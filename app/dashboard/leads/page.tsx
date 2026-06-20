import { LeadsTable } from "@/components/dashboard/leads/LeadsTable";
import { sampleLeads } from "@/lib/sample-data";
import type { LeadSource, LeadStatus } from "@/lib/types";

type SP = Promise<Record<string, string | string[] | undefined>>;

const PER = 8;
const str = (v: string | string[] | undefined, d: string) =>
  typeof v === "string" ? v : d;

// Phase 2: filter/paginate the sample set server-side (mirrors Phase 6's Olivia params).
export default async function LeadsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const status = str(sp.status, "all");
  const source = str(sp.source, "all");

  let rows = sampleLeads;
  if (status !== "all") rows = rows.filter((r) => r.status === (status as LeadStatus));
  if (source !== "all") rows = rows.filter((r) => r.source === (source as LeadSource));

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PER));
  const page = Math.min(Math.max(1, Number(str(sp.page, "1")) || 1), pages);
  const pageRows = rows.slice((page - 1) * PER, page * PER);
  const start = total ? (page - 1) * PER + 1 : 0;
  const end = Math.min(page * PER, total);

  return (
    <LeadsTable
      rows={pageRows}
      total={total}
      page={page}
      pages={pages}
      start={start}
      end={end}
      status={status}
      source={source}
    />
  );
}
