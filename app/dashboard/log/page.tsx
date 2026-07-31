import { LogView } from "@/components/dashboard/log/LogView";
import { EmptyState } from "@/components/ui/states/EmptyState";
import { ErrorState } from "@/components/ui/states/ErrorState";
import { FreshnessNote } from "@/components/ui/FreshnessNote";
import { getWorkspace } from "@/lib/auth";
import { EMPTY_COPY, ERROR_COPY } from "@/lib/copy";
import { DEFAULT_TZ, parsePage, parseRange, rangeToPeriod, str } from "@/lib/filters";
import { fetchCalls, fetchThreadRows } from "@/lib/olivia/service";

type SP = Promise<Record<string, string | string[] | undefined>>;

const LIMIT = 25;
const THREADS_LIMIT = 50;

export default async function LogPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const ws = await getWorkspace();
  const tz = ws.timezone ?? DEFAULT_TZ;
  const tab = str(sp.tab, "calls") === "conversations" ? "conversations" : "calls";
  const page = parsePage(sp.page);
  const period = rangeToPeriod(range, tz);
  // Deep link (?thread=) opens the chat drawer — used by the lead page's "Open full thread".
  const threadParam = str(sp.thread, "");

  let callsRes, threadsRes;
  try {
    // Threads (SMS + DM) are ranked by last activity, not range-scoped — a months-old
    // conversation that got a reply today belongs at the top of the list.
    [callsRes, threadsRes] = await Promise.all([
      fetchCalls({ ...period, page, limit: LIMIT }),
      fetchThreadRows({ limit: THREADS_LIMIT }),
    ]);
  } catch {
    return <ErrorState copy={ERROR_COPY.logs} />;
  }

  const calls = callsRes.data;
  const threads = threadsRes.data.rows;

  if (calls.total === 0 && threads.length === 0) {
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
        threads={threads}
        threadTotal={threadsRes.data.total}
        threadsPartial={threadsRes.data.truncated}
        initialThreadId={threadParam || null}
      />
    </>
  );
}
