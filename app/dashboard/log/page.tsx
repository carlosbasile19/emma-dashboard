import { LogView } from "@/components/dashboard/log/LogView";
import { EmptyState } from "@/components/ui/states/EmptyState";
import { ErrorState } from "@/components/ui/states/ErrorState";
import { FreshnessNote } from "@/components/ui/FreshnessNote";
import { getWorkspace } from "@/lib/auth";
import { EMPTY_COPY, ERROR_COPY } from "@/lib/copy";
import { DEFAULT_TZ, parsePage, parseRange, rangeToPeriod, str } from "@/lib/filters";
import { searchThreads } from "@/lib/log-search";
import { fetchCalls, fetchThreadRows, searchCalls } from "@/lib/olivia/service";
import type { Call, Freshness, ListResponse, ThreadRow, WithFreshness } from "@/lib/types";

type SP = Promise<Record<string, string | string[] | undefined>>;

const LIMIT = 25;
const THREADS_LIMIT = 50;
// A search reads further down the thread list than browsing does, so a lead who last messaged
// weeks ago is still findable. Paid only while searching the Conversations tab.
const SEARCH_THREADS_LIMIT = 200;

// A call search crawls the whole window, which can issue up to 25 sequential upstream calls in
// one render — well past the default function duration, so give it more room.
export const maxDuration = 60;

type ThreadsResult = WithFreshness<{ rows: ThreadRow[]; total: number; truncated: boolean }>;

export default async function LogPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const ws = await getWorkspace();
  const tz = ws.timezone ?? DEFAULT_TZ;
  const tab = str(sp.tab, "calls") === "conversations" ? "conversations" : "calls";
  const page = parsePage(sp.page);
  const period = rangeToPeriod(range, tz);
  const q = str(sp.q, "").trim();
  // Deep link (?thread=) opens the chat drawer — used by the lead page's "Open full thread".
  const threadParam = str(sp.thread, "");

  // The corpus crawl is the expensive path (up to 25 sequential upstream requests), so it is
  // paid only when the Calls tab is actually on screen. `q` persists across a tab switch, and
  // switching tabs re-renders this component, so the other tab's search still runs — just not
  // while its results are invisible.
  const searchingCalls = q !== "" && tab === "calls";
  const searchingThreads = q !== "" && tab === "conversations";

  let calls: ListResponse<Call>;
  let callsFreshness: Freshness | null;
  // True when the call crawl did not cover the whole window — surfaced so a partial search
  // never reads as a complete one. `searched` is how many rows it actually covered; the causes
  // range from the 2,500-row page cap down to a single short page, so the note must quote the
  // real number rather than assume the cap.
  let callsTruncated = false;
  let callsSearched = 0;
  let threadsRes: ThreadsResult;
  try {
    // Threads (SMS + DM) are ranked by last activity, not range-scoped — a months-old
    // conversation that got a reply today belongs at the top of the list.
    const threadsPromise = fetchThreadRows({
      limit: searchingThreads ? SEARCH_THREADS_LIMIT : THREADS_LIMIT,
    });

    if (searchingCalls) {
      const [callsRes, tRes] = await Promise.all([
        searchCalls({ ...period, page, limit: LIMIT, q }),
        threadsPromise,
      ]);
      calls = callsRes.data;
      callsFreshness = callsRes.freshness;
      callsTruncated = callsRes.data.truncated;
      callsSearched = callsRes.data.searched;
      threadsRes = tRes;
    } else if (searchingThreads) {
      // Calls are off screen and a search would make them expensive — skip the fetch entirely
      // rather than crawl a corpus nothing renders.
      threadsRes = await threadsPromise;
      calls = { items: [], total: 0, page: 1, limit: LIMIT };
      callsFreshness = null;
    } else {
      // No query → the plain single-request path, unchanged.
      const [callsRes, tRes] = await Promise.all([
        fetchCalls({ ...period, page, limit: LIMIT }),
        threadsPromise,
      ]);
      calls = callsRes.data;
      callsFreshness = callsRes.freshness;
      threadsRes = tRes;
    }
  } catch {
    return <ErrorState copy={ERROR_COPY.logs} />;
  }

  const threads = searchingThreads ? searchThreads(threadsRes.data.rows, q) : threadsRes.data.rows;

  // "Nothing here at all" and "nothing matched your search" are different states with different
  // copy — only the former belongs to this empty state, so it must not fire mid-search.
  if (!q && calls.total === 0 && threads.length === 0) {
    return <EmptyState copy={EMPTY_COPY.logs} />;
  }

  const callPages = Math.max(1, Math.ceil(calls.total / (calls.limit || LIMIT)));

  return (
    <>
      <FreshnessNote freshness={callsFreshness ?? threadsRes.freshness} />
      <LogView
        tab={tab}
        calls={calls.items}
        callTotal={calls.total}
        callPage={Math.min(page, callPages)}
        callPages={callPages}
        callsTruncated={callsTruncated}
        callsSearched={callsSearched}
        threads={threads}
        threadTotal={threads.length}
        threadsPartial={threadsRes.data.truncated}
        initialThreadId={threadParam || null}
        q={q}
      />
    </>
  );
}
