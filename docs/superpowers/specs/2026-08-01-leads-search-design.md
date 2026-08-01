# Leads search — Design

**Date:** 2026-08-01
**Status:** Approved design → ready for implementation plan
**Route:** `/dashboard/leads` ("Leads")

## Summary

Add a **search bar** to the Leads tab that finds a lead by **name, phone, email, or lead ID**
across every lead in the active date range — not just the 25 rows on the current page.

The upstream `/leads` endpoint has no search parameter, so matching happens in our layer: when
(and only when) a search term is present, we page the upstream list into a cached **corpus**,
filter it in memory, and re-paginate the matches.

## Why this shape (the binding constraints)

- **Upstream has no search.** `docs/olivia-external-api.md` §5 lists the only `/leads` query
  params as `from`, `to`, `tz`, `page`, `limit`, `status`, `source`. There is no `q`/`search`.
  Server-side search is therefore impossible; filtering must happen in this app.
- **Filtering only the current page would be a lie.** The table shows 25 of N. A search that
  silently ignores pages 2..N reads as broken. Search must cover the whole range.
- **Paging the corpus is an established pattern here.** `getLeadDirectory()`
  (`lib/olivia/api.ts:181`) already crawls `/leads` at `limit=100` up to a page cap and caches
  the result. Leads search reuses that shape rather than inventing a new one.
- **PII is scope-gated.** Without `dashboard:pii`, `first_name`/`last_name`/`email`/`phone`
  are **absent from the payload entirely** (§5 "PII (very important)"). Matching must degrade
  to ID-only rather than crash. The table already null-guards this via `hasPii()`.
- **Rate limits are real.** 600 req/min per key, governed locally at 500 (`lib/olivia/governor.ts`).
  A corpus crawl is ≤25 requests, and is paid only on search, never on plain browsing.

## Behavior

- **Search input** is the first control in the existing filter bar, left of the Status and
  Source selects, styled to match them.
- **Empty query = today's behavior, exactly.** No corpus crawl, no extra API calls, no
  regression to the normal browsing path.
- **Non-empty query** searches every lead in the current `?range=` window (7d / 30d / 90d),
  with Status and Source still applied on top.
- Typing is debounced **250 ms**, then written to the URL as `?q=`, matching how `status`,
  `source`, and `page` already live in the URL. A search is shareable and survives refresh.
- A new query **resets to page 1** (same as changing any filter). Matches paginate normally at
  25/page, and the existing `start–end of total` line reports match counts.
- **Clearing:** a `×` inside the field clears only the search; "Clear filters" clears search,
  status, and source together. "Clear filters" now appears when a search is active.
- **No matches** → empty state naming the search term, with a clear action.
- **Truncation is surfaced, never silent.** If the range holds more leads than the corpus cap,
  a muted line renders directly under the filter bar while a search is active: *"Searched the
  most recent 2,500 leads in this range."* It appears only when `truncated` is true and only
  during a search — never on the normal browsing path.

### Matching rules

The query is split on whitespace into tokens. **Every token must match, and each token may
match any field** (AND across tokens, OR across fields). This is what makes `maria santos`
work when first and last names are separate columns.

Per token, case-insensitively:

| Field | Rule |
|---|---|
| Name | substring of `first_name`, of `last_name`, or of the two joined |
| Email | substring of `email` — so `@gmail` works |
| Phone | **only if the token holds ≥3 digits**; both sides reduced to digits, so `07700900123` matches `(077) 0090-0123` |
| Lead ID | substring of `id` — paste an ID or fragment to jump straight to it |

The ≥3-digit guard on phone stops a name like `maria` from matching a phone through stray
digits, and stops a 1-character query from matching every number in the list.

When the key lacks `dashboard:pii`, the name/phone/email fields are absent, so they match
nothing and ID search still works. No special-casing, no crash.

## Components & data flow

```
LeadsTable (client)  ──debounced ?q=──►  LeadsPage (server)
                                              │
                                    q empty ──┴── q present
                                        │            │
                                  fetchLeads    searchLeads
                                 (1 request)         │
                                              cachedFetch("leads-corpus",
                                                {from,to,status,source})   ◄── key excludes q
                                                         │
                                              getLeadsCorpus() — pages /leads
                                                at limit=100, cap 25 pages
                                                         │
                                              matchesLead() filter → slice to page
```

### `lib/leads-search.ts` — new pure module (no React, no network)

```ts
/** Reduce a string to comparable form: lowercased, trimmed. */
export function normalize(s: string): string;

/** Strip everything that is not a digit. */
export function digitsOnly(s: string): string;

/** Split a raw query into non-empty search tokens. */
export function tokenize(q: string): string[];

/** True when every token matches at least one field of `lead`. Empty query → true. */
export function matchesLead(lead: Lead, tokens: string[]): boolean;

/** Filter + paginate a corpus. Returns the same shape as ListResponse<Lead>. */
export function searchCorpus(
  leads: Lead[],
  q: string,
  page: number,
  limit: number,
): { items: Lead[]; total: number; page: number; limit: number };
```

Pure and dependency-free, so it is exercised by a selftest script (below) rather than needing
network or React.

### `lib/olivia/api.ts` — add the corpus crawl

```ts
const LEAD_CORPUS_PAGE_SIZE = 100; // API max per page
const LEAD_CORPUS_MAX_PAGES = 25;  // ~2500 leads; matches the lead-directory cap

/**
 * Every lead in the window, for in-app search. Upstream /leads has no search param, so the
 * list is paged in full and filtered locally. `status`/`source` are passed upstream so a
 * filtered search crawls less.
 */
export async function getLeadsCorpus(
  clientId: string,
  params: LeadsParams,
  h?: Hints,
): Promise<{ items: Lead[]; truncated: boolean }>;
```

Loop mirrors `getLeadDirectory`: break when a short page arrives or `page * pageSize >= total`;
set `truncated: true` when the cap is hit with rows still outstanding.

### `lib/olivia/cache.ts` — one new tier

```ts
// Full lead corpus for search. Paging the list is expensive, so the fresh window is longer
// than `leads`; a search result up to ~2 min behind live is an acceptable trade.
leadsCorpus: { fresh: 120, stale: 600 },
```

### `lib/olivia/service.ts` — new `searchLeads()`

Wraps `getLeadsCorpus` in `cachedFetch` keyed on `{from, to, tz, status, source}` — **`q` is
deliberately excluded from the cache key** so typing does not create a cache entry per
keystroke. The corpus is cached; the filter runs in memory on every request.

Returns `WithFreshness<ListResponse<Lead> & { truncated: boolean }>` so the page can render the
existing `FreshnessNote` and the truncation note.

### `app/dashboard/leads/page.tsx` — branch on `q`

```ts
const q = str(sp.q, "").trim();
result = q
  ? await searchLeads({ ...rangeToPeriod(range, tz), q, page, limit: LIMIT, status, source })
  : await fetchLeads({ ...rangeToPeriod(range, tz), page, limit: LIMIT, status, source });
```

Existing `ErrorState` handling and pagination math are unchanged. Pass `q` and `truncated`
down to `LeadsTable`.

### `components/dashboard/leads/LeadsTable.tsx` — the input

A `SearchInput` sub-component beside the existing `Select` and `PageButton` sub-components,
matching their styling (`rounded-[10px] border border-ink/10 bg-white font-display text-[13px]`):

- Local `useState` seeded from the `q` prop for instant typing
- `useEffect` + `setTimeout` 250 ms → `setParam({ q: value || null, page: null })`, cleared on
  each keystroke; skips the write when the value already equals the `q` prop (so a URL-driven
  re-render does not echo back)
- Leading magnifier icon; trailing `×` button shown only when non-empty
- `aria-label="Search leads"`, `type="search"`

The existing `filtered` flag becomes `status !== "all" || source !== "all" || q !== ""`, and
`clearFilters` also clears `q`.

### `lib/copy.ts` — search-specific empty copy

`EMPTY_COPY` is a `Record<CopyKey, EmptyCopy>` keyed off `NavKey`, so search copy cannot be a
new key there. Add a standalone export instead:

```ts
/** Empty state for a leads search that matched nothing (distinct from an unfiltered empty list). */
export const LEADS_SEARCH_EMPTY: EmptyCopy = {
  title: "No leads match that search",
  body: "Nothing in this range matches. Try fewer words, a phone number, or widen the date range.",
  cta: "Clear filters",
};
```

`LeadsTable` picks `LEADS_SEARCH_EMPTY` when `q` is non-empty, `EMPTY_COPY.leads` otherwise.

## Hydration

`q` arrives as a server-rendered prop and seeds client state directly, so the first client
render matches the server render. The debounce timer only starts on a real keystroke
(post-hydration), so no SSR/client mismatch is introduced.

## Testing

Following the repo convention (`scripts/*-selftest.ts` + an npm script — there is no
vitest/jest here), add `scripts/leads-search-selftest.ts` wired as `"test:leadsearch"`.

Cases, against fixture leads (no network):

1. Name — `maria` matches `Maria Santos`; case-insensitive
2. Multi-token — `maria santos` matches across separate first/last columns
3. Multi-token negative — `maria jones` does **not** match `Maria Santos`
4. Email — `@gmail` matches `maria@gmail.com`
5. Phone — `07700900123` matches stored `(077) 0090-0123`
6. Phone guard — a 1–2 digit token does not match phones
7. ID — a lead-ID fragment matches; full pasted ID matches
8. PII-absent lead (no name/phone/email fields) — ID search still matches, name search does not
9. Empty/whitespace query — returns everything, unpaginated behavior intact
10. Pagination — 30 matches at `limit=25` → page 1 has 25, page 2 has 5, `total` is 30

## Out of scope

- Fuzzy / typo-tolerant matching. Substring matching is predictable; fuzzy needs a real index.
- Searching call transcripts or conversation bodies — a different endpoint and a different
  feature.
- Persisting recent searches.
- Raising the 2,500-lead cap. If real workspaces exceed it, the fix is upstream search support,
  not a bigger crawl.
