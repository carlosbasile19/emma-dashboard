# Calls & Conversations search — Design

**Date:** 2026-08-07
**Status:** Approved design → implementation
**Route:** `/dashboard/log` ("Calls & Conversations")

## Summary

Add a **single search bar** to the log view that finds a lead by **name, phone, or lead ID**
across **both** tabs. On Calls it searches every call in the active date range — not just the
25 rows on the current page. On Conversations it searches a deeper slice of threads than the
50 the tab loads for browsing.

Neither upstream endpoint has a search parameter, so matching happens in our layer, reusing the
corpus-crawl pattern already shipped for Leads search.

## Why this shape (the binding constraints)

- **Upstream has no search, on either endpoint.** `docs/olivia-external-api.md` §5 lists the
  `/calls` params as `from`, `to`, `tz`, `page`, `limit` — no `q`. Same for `/conversations`.
  Filtering must happen in this app.
- **`/calls` ignores `lead_id`.** Already documented at `lib/olivia/service.ts` above
  `fetchCallDetail`. So "resolve the name to a lead id, then ask upstream for that lead's calls"
  is not available — a corpus crawl is the only route.
- **Call rows carry no name at all.** `/calls` returns `lead_id` only; the display name is
  injected by `withLeadNames()` from the cached `lead_id → name` directory
  (`api.getLeadDirectory`). Matching must therefore run **after** enrichment, or a search for
  "maria" would match nothing.
- **Thread rows already carry a name.** `mergeThreadRows` (`lib/threads.ts:44,64`) sets
  `lead_name` from the DM payload or from the directory-enriched conversation. Conversations
  need no extra name plumbing — only more rows to search.
- **Filtering only what's on screen would be a lie.** Calls shows 25 of N; Conversations shows
  the 50 most recently active threads. A search that silently ignores the rest reads as broken.
- **PII is scope-gated.** Without `dashboard:pii`, names and phone numbers are absent from the
  payload entirely. Matching must degrade to ID-only rather than crash.
- **Rate limits are real.** 600 req/min per key, governed locally at 500
  (`lib/olivia/governor.ts`). The calls crawl is ≤25 requests and is paid only on search.

## Behavior

- **One search input**, sharing the row with the existing tab switcher (switcher left, search
  right). It is bound to `?q=` and **persists across a tab switch** — searching "maria" on
  Calls and clicking Conversations re-runs the same search against threads.
- **Empty query = today's behavior, exactly.** No corpus crawl, no deeper thread fetch, no
  extra API calls, no regression to the normal browsing path.
- Typing is debounced **250 ms**, then written to the URL as `?q=`, matching how `tab` and
  `page` already live in the URL. A search is shareable and survives refresh.
- A new query **resets to page 1**. Call matches paginate normally at 25/page.
- **Clearing:** a `×` inside the field clears the search. The zero-match empty state also
  offers a clear action.
- **Matching:** tokens are AND-ed, fields are OR-ed — the same semantics as Leads search.
  - Calls match on resolved lead name, `lead_id`, and the digits of `from_number`/`to_number`.
  - Threads match on `lead_name` and `lead_id` (thread rows carry no phone field).
  - A token must hold **≥3 digits** before it can match a phone number, so "maria" cannot hit a
    number via stray digits.
- **Partial coverage is surfaced, never silent.**
  - Calls, when the crawl hits its cap: *"Searched the most recent N calls in this range."*
    The number quoted is the corpus we actually collected, not the cap — the same three causes
    that make the leads crawl fall short (page cap, missing `total`, short page) apply here.
  - Conversations, when the merged thread list caps out: *"Searched the latest N threads."*
- **No matches** → an empty state naming the search term, with a "Clear search" action,
  distinct from the existing "Quiet on the line" empty state.
- **Date range** still applies to Calls (the crawl is scoped to `?range=`). Conversations are
  deliberately not range-scoped — unchanged from today, because threads rank by last activity.

## Components

### `lib/log-search.ts` (new, pure)

Imports `normalize` / `digitsOnly` / `tokenize` / `MIN_PHONE_DIGITS` from `lib/leads-search.ts`
rather than redefining them, and exports:

- `matchesCall(call: Call, tokens: string[]): boolean`
- `matchesThread(row: ThreadRow, tokens: string[]): boolean`
- `searchCallCorpus(calls, q, page, limit): ListResponse<Call>` — filter then slice, mirroring
  `searchCorpus` including its non-finite `page`/`limit` guards.

Dependency-free and covered by `scripts/log-search-selftest.ts`.

`MIN_PHONE_DIGITS` becomes an export of `lib/leads-search.ts` (it was already defined there).

### `lib/olivia/api.ts` — `getCallsCorpus()`

Pages `/calls` at `limit=100`, caps at 25 pages (~2,500 calls), reuses `hasMorePages`, and
returns `{ items, truncated, searched }`. Applies the same post-loop "a short page is not
necessarily the end" check as `getLeadsCorpus`, so a locked response that omits `total` reports
`truncated` instead of silently claiming completeness.

**Pages in parallel, unlike the leads crawl.** Measured against a real 10,664-call month, the
sequential version took **47s** — past a comfortable margin under this route's 60s
`maxDuration`. Batching pages 2..N six at a time brings the crawl itself to ~2s. This is only
safe because page 1 reports `total`, so the page count is known up front instead of being
discovered one request at a time; when `total` is missing the parallel phase is skipped entirely
and the result is marked truncated. Six concurrent requests stays well inside the 500 req/min
governor.

### `lib/olivia/service.ts` — `searchCalls()`

Caches the corpus under a new `calls-corpus` endpoint with a new
`callsCorpus: { fresh: 120, stale: 600 }` tier. **`q` is deliberately not part of the cache
key** — including it would write a cache entry per keystroke. The corpus is passed through
`withLeadNames()` **before** filtering, then `searchCallCorpus` filters and re-paginates.

### `app/dashboard/log/page.tsx`

- Reads `q` from `searchParams`.
- Routes to `searchCalls()` only when `q` is non-empty; the no-query path is untouched.
- Requests `SEARCH_THREADS_LIMIT` (200) instead of `THREADS_LIMIT` (50) from `fetchThreadRows`
  when `q` is present, then filters the merged rows through `matchesThread`.
- Adds `export const maxDuration = 60`, matching the leads page — a crawl can issue up to 25
  sequential upstream calls in one render.
- The all-empty `EmptyState` short-circuit must not fire during a search; a search that matches
  nothing is a different state with different copy.

### `components/dashboard/log/LogView.tsx`

Adds the debounced `SearchInput` (same shape as `LeadsTable`'s: self-echo guard, trim-before-
compare, `×` to clear) and the per-tab zero-match and truncation notes. The tab-switch handler
keeps `q` and resets `page`.

### `lib/copy.ts` — `LOG_SEARCH_EMPTY(query, kind)`

Returns `EmptyCopy` for `kind: "calls" | "conversations"`, eliding long terms the way
`LEADS_SEARCH_EMPTY` does.

## Error handling

- Corpus crawl failure falls through the existing `try/catch` to `ErrorState`, same as today.
- Lead-directory failure stays best-effort: names fall back to the `lead_id`, and a search then
  matches on ID only rather than throwing.
- A deep-linked `?thread=` still opens the chat drawer even when a search is active.

## Testing

`scripts/log-search-selftest.ts`, run via `npm run test:logsearch`, covering: name/phone/ID
matching, multi-token AND, case-insensitivity, the ≥3-digit phone guard, PII-absent rows
degrading to ID-only, pagination slicing, and non-finite `page`/`limit` coercion.

## Verified

Manually exercised against live data on 2026-08-07 (both tabs, two clients):

- Calls search on a small client returned 8 Patrick Edwards calls including rows 3–4 weeks old
  that were not on page 1 — confirming the crawl reaches past the current page.
- Conversations search on SOLVI matched one SMS thread; footer read "1 matching thread".
- The truncation note rendered correctly on SOLVI ("Searched the most recent 2,500 calls in this
  range.") alongside the zero-match empty state.
- `q` survived a tab switch in both directions.

## Known limitation (pre-existing, not introduced here)

`getLeadDirectory` caps at 2,500 leads and pages **sequentially**. On SOLVI (4,459 leads) the
overflow already falls back to raw `lead_id` in the log, which means a **name** search cannot
match those older leads' calls — they are only reachable by id or phone. The sequential crawl
also dominates a cold-cache log render (~30s) for both the searched and unsearched paths. Both
behaviours predate this change and are cached (fresh 300s / stale 1800s); fixing them touches
every log view, so it is deliberately left alone here.

## Out of scope

- Transcript / message-body search (PII-gated and frequently absent — results would be
  inconsistent).
- Any change to the un-searched browsing path.
- Range-scoping the Conversations tab.
