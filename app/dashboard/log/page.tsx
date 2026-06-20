import { LogView } from "@/components/dashboard/log/LogView";
import { EmptyState } from "@/components/ui/states/EmptyState";
import { ErrorState } from "@/components/ui/states/ErrorState";
import { FreshnessNote } from "@/components/ui/FreshnessNote";
import { getWorkspace } from "@/lib/auth";
import { EMPTY_COPY, ERROR_COPY } from "@/lib/copy";
import { DEFAULT_TZ, parsePage, parseRange, rangeToPeriod, str } from "@/lib/filters";
import { fetchCalls, fetchConversations } from "@/lib/olivia/service";

type SP = Promise<Record<string, string | string[] | undefined>>;

const LIMIT = 25;

export default async function LogPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const ws = await getWorkspace();
  const tz = ws.timezone ?? DEFAULT_TZ;
  const tab = str(sp.tab, "calls") === "conversations" ? "conversations" : "calls";
  const page = parsePage(sp.page);
  const period = rangeToPeriod(range, tz);

  let callsRes, convRes;
  try {
    [callsRes, convRes] = await Promise.all([
      fetchCalls({ ...period, page, limit: LIMIT }),
      fetchConversations({ ...period, page: 1, limit: 50 }),
    ]);
  } catch {
    return <ErrorState copy={ERROR_COPY.logs} />;
  }

  const calls = callsRes.data;
  const convos = convRes.data.items;

  if (calls.total === 0 && convos.length === 0) {
    return <EmptyState copy={EMPTY_COPY.logs} />;
  }

  const callPages = Math.max(1, Math.ceil(calls.total / (calls.limit || LIMIT)));

  return (
    <>
      <FreshnessNote freshness={callsRes.freshness} />
      <LogView
        tab={tab}
        calls={calls.items}
        callTotal={calls.total}
        callPage={Math.min(page, callPages)}
        callPages={callPages}
        conversations={convos}
      />
    </>
  );
}
