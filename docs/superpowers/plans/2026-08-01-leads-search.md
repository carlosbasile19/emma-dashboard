# Leads Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a search bar to `/dashboard/leads` that finds a lead by name, phone, email, or lead ID across every lead in the active date range.

**Architecture:** The upstream Olivia `/leads` endpoint has no search parameter, so matching happens in this app. When a query is present, we page the upstream list into a Supabase-cached **corpus** (keyed on window + filters, deliberately **not** on the query text), filter it in memory with a pure module, and re-paginate the matches. An empty query keeps today's single-request browsing path untouched.

**Tech Stack:** Next.js 15 App Router (server components), React 19, TypeScript, Tailwind v4, Supabase-backed response cache. Tests are `scripts/*-selftest.ts` run with `tsx` via `npm run test:*` — there is no vitest/jest in this repo.

**Spec:** `docs/superpowers/specs/2026-08-01-leads-search-design.md`

## Global Constraints

- **Branding:** all user-facing copy says "Emma". Never write the upstream vendor name ("Olivia") in anything a user can read. Internal identifiers, module paths, and code comments keep `olivia`.
- **Corpus cap:** `LEAD_CORPUS_PAGE_SIZE = 100`, `LEAD_CORPUS_MAX_PAGES = 25` (≈2,500 leads). Hitting the cap sets `truncated: true` and is surfaced in the UI — never silently.
- **Cache key excludes the query.** The corpus cache key is `{from, to, tz, status, source, stage_id}`. Adding `q` to it would create a cache entry per keystroke.
- **Empty query = zero behavioral change.** No corpus crawl, no extra API calls on the normal browsing path.
- **PII is scope-gated.** Without `dashboard:pii`, `first_name`/`last_name`/`email`/`phone` are absent from the payload. Matching must degrade to ID-only, never throw.
- **URL is the state.** Search lives at `?q=`, alongside the existing `status`, `source`, `page` params.
- **Verification commands:** `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run test:leadsearch`.

---

### Task 1: Pure search module

The matching and pagination logic, with no React and no network, so it can be exercised by a selftest script.

**Files:**
- Create: `lib/leads-search.ts`
- Create: `scripts/leads-search-selftest.ts`
- Modify: `package.json:5-14` (scripts block — add `test:leadsearch`)

**Interfaces:**
- Consumes: `Lead` and `ListResponse<T>` from `@/lib/types` (`lib/types.ts:214`, `lib/types.ts:479`).
- Produces:
  - `normalize(s: string): string`
  - `digitsOnly(s: string): string`
  - `tokenize(q: string): string[]`
  - `matchesLead(lead: Lead, tokens: string[]): boolean`
  - `searchCorpus(leads: Lead[], q: string, page: number, limit: number): ListResponse<Lead>`
  - `hasMorePages(fetched: number, total: number, lastPageCount: number, pageSize: number): boolean`

- [ ] **Step 1: Add the npm script**

In `package.json`, inside `"scripts"`, add this line after `"test:besttimes"`:

```json
    "test:leadsearch": "tsx scripts/leads-search-selftest.ts"
```

Remember to add a comma to the end of the previous `"test:besttimes"` line.

- [ ] **Step 2: Write the failing test**

Create `scripts/leads-search-selftest.ts`:

```ts
import assert from "node:assert/strict";
import {
  digitsOnly,
  hasMorePages,
  matchesLead,
  normalize,
  searchCorpus,
  tokenize,
} from "../lib/leads-search";
import type { Lead } from "../lib/types";

/** Minimal Lead fixture — only the fields search touches; the rest satisfy the type. */
function lead(over: Partial<Lead> & { id: string }): Lead {
  return {
    status: "new",
    source: "csv_import",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    total_calls: 0,
    ...over,
  } as Lead;
}

const maria = lead({
  id: "9b1e4c22-0000-4000-8000-000000000001",
  first_name: "Maria",
  last_name: "Santos",
  email: "maria@gmail.com",
  phone: "(077) 0090-0123",
});
const ana = lead({
  id: "9b1e4c22-0000-4000-8000-000000000002",
  first_name: "Ana Maria",
  last_name: "Lopez",
  email: "ana.lopez@outlook.com",
  phone: "+1 415 555 0134",
});
// A lead as it arrives WITHOUT the dashboard:pii scope — no name/email/phone at all.
const redacted = lead({ id: "9b1e4c22-0000-4000-8000-00000000abcd" });

const find = (q: string, rows: Lead[] = [maria, ana, redacted]) =>
  searchCorpus(rows, q, 1, 25).items.map((l) => l.id);

(() => {
  // Helpers
  assert.equal(normalize("  MaRiA  "), "maria");
  assert.equal(digitsOnly("(077) 0090-0123"), "0770090123");
  assert.deepEqual(tokenize("  maria   santos "), ["maria", "santos"]);
  assert.deepEqual(tokenize("   "), []);

  // 1. Name, case-insensitive — matches both Marias.
  assert.deepEqual(find("maria"), [maria.id, ana.id]);
  assert.deepEqual(find("MARIA"), [maria.id, ana.id]);

  // 2. Multi-token across separate first/last columns.
  assert.deepEqual(find("maria santos"), [maria.id]);

  // 3. Multi-token negative — every token must match.
  assert.deepEqual(find("maria jones"), []);

  // 4. Email substring.
  assert.deepEqual(find("@gmail"), [maria.id]);

  // 5. Phone — punctuation on either side is ignored.
  assert.deepEqual(find("07700900123"), [maria.id]);
  assert.deepEqual(find("(077) 0090-0123"), [maria.id]);

  // 6. Phone guard — tokens under 3 digits never match a phone number.
  assert.deepEqual(find("01"), []);

  // 7. Lead ID — full paste and fragment.
  assert.deepEqual(find(maria.id), [maria.id]);
  assert.deepEqual(find("000000000002"), [ana.id]);

  // 8. PII-absent lead — ID still matches; a name query does not.
  assert.deepEqual(find("abcd"), [redacted.id]);
  assert.equal(matchesLead(redacted, tokenize("maria")), false);

  // 9. Empty / whitespace query returns everything untouched.
  assert.deepEqual(find(""), [maria.id, ana.id, redacted.id]);
  assert.deepEqual(find("   "), [maria.id, ana.id, redacted.id]);

  // 10. Pagination over 30 matches at limit 25.
  const many = Array.from({ length: 30 }, (_, i) =>
    lead({ id: `id-${i}`, first_name: "Dup", last_name: `Lead${i}` }),
  );
  const p1 = searchCorpus(many, "dup", 1, 25);
  const p2 = searchCorpus(many, "dup", 2, 25);
  assert.equal(p1.items.length, 25);
  assert.equal(p2.items.length, 5);
  assert.equal(p1.total, 30);
  assert.equal(p2.total, 30);
  assert.equal(p2.page, 2);
  assert.equal(p2.limit, 25);
  assert.equal(p2.items[0].id, "id-25");

  // Crawl loop control — a short page ends the crawl; so does reaching `total`.
  assert.equal(hasMorePages(100, 250, 100, 100), true);
  assert.equal(hasMorePages(250, 250, 50, 100), false); // short page
  assert.equal(hasMorePages(200, 200, 100, 100), false); // fetched === total
  assert.equal(hasMorePages(100, 100, 100, 100), false); // exactly one full page
  assert.equal(hasMorePages(0, 0, 0, 100), false); // empty window

  console.log("leads-search-selftest: all assertions passed");
})();
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:leadsearch`
Expected: FAIL — `Cannot find module '../lib/leads-search'`.

- [ ] **Step 4: Write the implementation**

Create `lib/leads-search.ts`:

```ts
import type { Lead, ListResponse } from "@/lib/types";

/**
 * In-app lead search. Upstream /leads has no search parameter (external API guide §5), so
 * matching runs here over a locally-paged corpus. Pure and dependency-free — see
 * `scripts/leads-search-selftest.ts`.
 */

/** Tokens shorter than this never match a phone, so "maria" can't hit a number via stray digits. */
const MIN_PHONE_DIGITS = 3;

/** Reduce a string to comparable form: trimmed and lowercased. */
export function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Strip everything that is not a digit, so "(077) 0090-0123" → "0770090123". */
export function digitsOnly(s: string): string {
  return s.replace(/\D+/g, "");
}

/** Split a raw query into non-empty, normalized search tokens. */
export function tokenize(q: string): string[] {
  return normalize(q).split(/\s+/).filter(Boolean);
}

/**
 * True when EVERY token matches at least one field (AND across tokens, OR across fields).
 * That's what makes "maria santos" work when first and last names are separate columns.
 * Fields absent without the dashboard:pii scope simply match nothing.
 */
export function matchesLead(lead: Lead, tokens: string[]): boolean {
  if (!tokens.length) return true;

  const first = normalize(lead.first_name ?? "");
  const last = normalize(lead.last_name ?? "");
  const joined = [first, last].filter(Boolean).join(" ");
  const email = normalize(lead.email ?? "");
  const id = normalize(lead.id);
  const phone = digitsOnly(lead.phone ?? "");

  return tokens.every((t) => {
    if (first.includes(t) || last.includes(t) || joined.includes(t)) return true;
    if (email.includes(t)) return true;
    if (id.includes(t)) return true;
    const d = digitsOnly(t);
    return d.length >= MIN_PHONE_DIGITS && phone.length > 0 && phone.includes(d);
  });
}

/** Filter a corpus by `q`, then slice to a page. An empty query returns everything. */
export function searchCorpus(
  leads: Lead[],
  q: string,
  page: number,
  limit: number,
): ListResponse<Lead> {
  const tokens = tokenize(q);
  const matches = tokens.length ? leads.filter((l) => matchesLead(l, tokens)) : leads;
  const size = Math.max(1, limit);
  const p = Math.max(1, page);
  const start = (p - 1) * size;
  return { items: matches.slice(start, start + size), total: matches.length, page: p, limit: size };
}

/**
 * Should the corpus crawl request another page? A short page means we've hit the end;
 * otherwise keep going until we've collected `total`.
 */
export function hasMorePages(
  fetched: number,
  total: number,
  lastPageCount: number,
  pageSize: number,
): boolean {
  if (lastPageCount < pageSize) return false;
  return fetched < total;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:leadsearch`
Expected: PASS — `leads-search-selftest: all assertions passed`

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/leads-search.ts scripts/leads-search-selftest.ts package.json
git commit -m "feat(leads): pure search matching and pagination module

Upstream /leads has no search param, so matching runs in-app. Tokens are
ANDed across fields (name, email, phone, id) so 'maria santos' matches
separate first/last columns. Phone matching needs 3+ digits.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Corpus crawl and cached search service

Page the upstream list into a cached corpus and expose a session-scoped `searchLeads()`.

**Files:**
- Modify: `lib/olivia/api.ts` (add `getLeadsCorpus` after `getLeadDirectory`, which ends at line 209)
- Modify: `lib/olivia/cache.ts:26` (add a `leadsCorpus` tier next to `leadDirectory`)
- Modify: `lib/olivia/service.ts` (add `searchLeads` after `fetchLeads`, which ends at line 172)

**Interfaces:**
- Consumes: `hasMorePages` and `searchCorpus` from `@/lib/leads-search` (Task 1). Existing `getLeads(clientId, params, h)` (`lib/olivia/api.ts:135`), `cachedFetch` / `TIERS` (`lib/olivia/cache.ts:18,137`), `rec` and `Opts` (`lib/olivia/service.ts:46,51`), `getSessionClientId` (`@/lib/auth`).
- Produces:
  - `api.getLeadsCorpus(clientId: string, params: LeadsParams, h?: Hints): Promise<{ items: Lead[]; truncated: boolean }>`
  - `TIERS.leadsCorpus`
  - `type LeadsSearchResult = ListResponse<Lead> & { truncated: boolean }`
  - `searchLeads(params: LeadsParams & { q: string }, opts?: Opts): Promise<WithFreshness<LeadsSearchResult>>`

- [ ] **Step 1: Add the cache tier**

In `lib/olivia/cache.ts`, inside the `TIERS` object, directly after the `leadDirectory` entry (line 29), add:

```ts
  // Full lead corpus backing in-app search. Paging the whole list is expensive, so the fresh
  // window is longer than `leads` — a search result up to ~2 min behind live is an acceptable
  // trade for not re-crawling on every keystroke.
  leadsCorpus: { fresh: 120, stale: 600 },
```

- [ ] **Step 2: Add the corpus crawl**

In `lib/olivia/api.ts`, immediately after `getLeadDirectory` (ends line 209), add:

```ts
const LEAD_CORPUS_PAGE_SIZE = 100; // API max per page
const LEAD_CORPUS_MAX_PAGES = 25; // safety cap (~2500 leads); overflow is reported, not hidden

/**
 * Every lead in the window, for in-app search. Upstream /leads has no search parameter
 * (guide §5), so the list is paged in full and filtered locally. `status`/`source` ride
 * along so a filtered search crawls less. `truncated` is true when the cap cut the crawl
 * short — callers MUST surface that rather than imply a complete result.
 */
export async function getLeadsCorpus(
  clientId: string,
  params: LeadsParams,
  h: Hints = {},
): Promise<{ items: Lead[]; truncated: boolean }> {
  const items: Lead[] = [];
  let truncated = false;

  for (let page = 1; page <= LEAD_CORPUS_MAX_PAGES; page++) {
    const res = await getLeads(
      clientId,
      { ...params, page, limit: LEAD_CORPUS_PAGE_SIZE },
      h,
    );
    items.push(...res.items);
    const pageSize = res.limit || LEAD_CORPUS_PAGE_SIZE;
    if (!hasMorePages(items.length, res.total, res.items.length, pageSize)) break;
    if (page === LEAD_CORPUS_MAX_PAGES) {
      truncated = true;
      console.warn(
        "[olivia] lead search corpus truncated at %d leads (total=%d) — search covers newest rows only",
        items.length,
        res.total,
      );
    }
  }

  return { items, truncated };
}
```

Add the import at the top of `lib/olivia/api.ts`, alongside the existing imports:

```ts
import { hasMorePages } from "@/lib/leads-search";
```

- [ ] **Step 3: Add the cached search service**

In `lib/olivia/service.ts`, immediately after `fetchLeads` (ends line 172), add:

```ts
export type LeadsSearchResult = ListResponse<Lead> & { truncated: boolean };

/**
 * Search leads by name / phone / email / id across the whole window. Upstream has no search
 * param, so we cache the CORPUS (keyed on window + filters) and filter it in memory.
 * `q` is deliberately NOT part of the cache key — including it would write a cache entry
 * per keystroke.
 */
export async function searchLeads(
  params: LeadsParams & { q: string },
  opts: Opts = {},
): Promise<WithFreshness<LeadsSearchResult>> {
  const { q, page = 1, limit = 25, ...corpus } = params;
  const clientId = await getSessionClientId();
  const cached = await cachedFetch({
    clientId,
    endpoint: "leads-corpus",
    params: rec(corpus),
    tier: TIERS.leadsCorpus,
    force: opts.force,
    fetcher: () => api.getLeadsCorpus(clientId, corpus),
  });
  return {
    data: { ...searchCorpus(cached.data.items, q, page, limit), truncated: cached.data.truncated },
    freshness: cached.freshness,
  };
}
```

Add the import at the top of `lib/olivia/service.ts`, after the `mergeThreadRows` import:

```ts
import { searchCorpus } from "@/lib/leads-search";
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `Lead` or `ListResponse` are reported as unused-but-imported in `service.ts`, they are already imported at `lib/olivia/service.ts:24,33` — do not re-import them.

- [ ] **Step 5: Re-run the pure tests**

Run: `npm run test:leadsearch`
Expected: PASS — Task 1's assertions still hold (`hasMorePages` and `searchCorpus` are unchanged, just newly consumed).

- [ ] **Step 6: Commit**

```bash
git add lib/olivia/api.ts lib/olivia/cache.ts lib/olivia/service.ts
git commit -m "feat(leads): cached lead corpus behind searchLeads

Pages /leads at limit=100 up to 25 pages and caches the result keyed on
window + filters, never on the query text. Truncation is returned to the
caller so the UI can say what it actually searched.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Page wiring and search copy

Branch the leads page on `?q=` and add the search-specific empty state.

**Files:**
- Modify: `lib/copy.ts` (append a standalone export after the `ERROR_COPY` block)
- Modify: `app/dashboard/leads/page.tsx:1-56` (whole file)

**Interfaces:**
- Consumes: `searchLeads` (Task 2), `str` (`lib/filters.ts:122`), `EmptyCopy` (`components/ui/states/EmptyState.tsx:3`).
- Produces:
  - `LEADS_SEARCH_EMPTY: EmptyCopy` exported from `@/lib/copy`
  - `LeadsTable` receives two new props: `q: string`, `truncated: boolean`

- [ ] **Step 1: Add the search empty copy**

In `lib/copy.ts`, at the end of the file (after the `ERROR_COPY` object closes), add:

```ts
/**
 * Empty state for a search that matched nothing — distinct from an unfiltered empty list.
 * `EMPTY_COPY` is keyed by NavKey, so search copy cannot be a member of it.
 */
export const LEADS_SEARCH_EMPTY: EmptyCopy = {
  title: "No leads match that search",
  body: "Nothing in this range matches. Try fewer words, a phone number, or widen the date range.",
  cta: "Clear filters",
};
```

`EmptyCopy` is already imported at `lib/copy.ts:2` — do not re-import it.

- [ ] **Step 2: Rewrite the leads page**

Replace the entire contents of `app/dashboard/leads/page.tsx` with:

```tsx
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
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors **only** on the `<LeadsTable …>` call in this file, reporting that `q` and/or `truncated` are not valid props. That is expected — Task 4 adds them. Any error in another file, or any error here that is not about those two props, must be fixed before continuing.

- [ ] **Step 4: Commit**

```bash
git add lib/copy.ts app/dashboard/leads/page.tsx
git commit -m "feat(leads): route ?q= to searchLeads on the leads page

Empty query keeps the existing single-request path. Adds search-specific
empty copy, since EMPTY_COPY is keyed by NavKey.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The search input

Add the debounced search field to the filter bar and wire the empty/truncated states.

**Files:**
- Modify: `components/dashboard/leads/LeadsTable.tsx:1-234` (props, filter bar, empty state, new `SearchInput` sub-component)

**Interfaces:**
- Consumes: `LEADS_SEARCH_EMPTY` (Task 3), existing `setParam` (`components/dashboard/leads/LeadsTable.tsx:40-51`), `EMPTY_COPY` (`@/lib/copy`).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Update imports and props**

In `components/dashboard/leads/LeadsTable.tsx`, change the React import on line 4 to:

```tsx
import { useCallback, useEffect, useState } from "react";
```

Change the copy import on line 7 to:

```tsx
import { EMPTY_COPY, LEADS_SEARCH_EMPTY } from "@/lib/copy";
```

Add `q` and `truncated` to the destructured params and to the props type (lines 17-35), so the signature reads:

```tsx
export function LeadsTable({
  rows,
  total,
  page,
  pages,
  start,
  end,
  status,
  source,
  q,
  truncated,
}: {
  rows: Lead[];
  total: number;
  page: number;
  pages: number;
  start: number;
  end: number;
  status: string;
  source: string;
  q: string;
  truncated: boolean;
}) {
```

- [ ] **Step 2: Update the filter flag and clear action**

Replace lines 53-54 with:

```tsx
  const filtered = status !== "all" || source !== "all" || q !== "";
  const clearFilters = () => setParam({ status: null, source: null, q: null, page: null });
```

- [ ] **Step 3: Add the input to the filter bar**

In the filter bar `<div>` (starts line 59), insert the `SearchInput` as the **first** child, immediately before the status `<Select>`:

```tsx
        <SearchInput value={q} onChange={(v) => setParam({ q: v, page: null })} />
```

Then, directly after the filter bar `</div>` (line 88), add the truncation note:

```tsx
      {truncated && q ? (
        <p className="-mt-2 mb-4 font-mono text-[11.5px] text-muted">
          Searched the most recent 2,500 leads in this range.
        </p>
      ) : null}
```

- [ ] **Step 4: Point the empty state at the right copy**

Replace line 92 with:

```tsx
          <EmptyState copy={q ? LEADS_SEARCH_EMPTY : EMPTY_COPY.leads} onAction={clearFilters} />
```

- [ ] **Step 5: Add the SearchInput component**

At the end of `components/dashboard/leads/LeadsTable.tsx`, after the `PageButton` component, add:

```tsx
const DEBOUNCE_MS = 250;

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  // Re-sync when the URL changes from outside the field (Clear filters, browser back).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // Debounce the URL write so typing doesn't fire a navigation per keystroke.
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onChange(draft), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, value, onChange]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-muted">
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="9" cy="9" r="6" />
          <path d="M13.5 13.5 17 17" strokeLinecap="round" />
        </svg>
      </span>
      <input
        type="search"
        aria-label="Search leads"
        placeholder="Search leads…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="w-[220px] rounded-[10px] border border-ink/10 bg-white py-[9px] pl-[32px] pr-[30px] font-display text-[13px] text-ink placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none"
      />
      {draft ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setDraft("");
            onChange("");
          }}
          className="absolute right-[9px] top-1/2 -translate-y-1/2 cursor-pointer px-1 text-[13px] leading-none text-muted hover:text-ink"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
```

Note: the native `type="search"` clear button is suppressed via `[&::-webkit-search-cancel-button]:appearance-none` so only our `×` shows.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. The two expected errors from Task 3 Step 3 are now resolved.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: build succeeds, `/dashboard/leads` compiles.

- [ ] **Step 8: Verify in the running app**

Run `npm run dev`, sign in, and check on `/dashboard/leads`:

1. **No query** — page loads exactly as before; the field is empty.
2. **Type a partial name** — after ~250ms the URL gains `?q=…`, the list narrows, the count line reflects matches, and `page` resets to 1.
3. **Go to page 2, then search** — you land on page 1 of the results, not an empty page 2.
4. **Refresh with `?q=` set** — the field is still populated and results still filtered.
5. **`×`** — clears only the search; Status/Source stay as they were.
6. **Clear filters** — clears the search *and* both selects.
7. **Nonsense query** — the "No leads match that search" empty state renders with a working Clear filters button.
8. **Paste a lead ID** from a row — that single lead comes back.

- [ ] **Step 9: Commit**

```bash
git add components/dashboard/leads/LeadsTable.tsx
git commit -m "feat(leads): debounced search input in the leads filter bar

Search lives at ?q= alongside the existing filters, so it is shareable and
survives refresh. Truncated corpus crawls say so rather than implying a
complete result.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| Search input first in the filter bar, styled like the selects | 4 |
| Empty query = today's behavior, no extra calls | 3 (branch), 2 (crawl only under `searchLeads`) |
| Search covers the whole `?range=` window, status/source applied | 2, 3 |
| 250 ms debounce → `?q=` in the URL | 4 |
| New query resets to page 1 | 3 (`page: null` from 4), 4 |
| `×` clears search; "Clear filters" clears everything | 4 |
| No matches → search-specific empty state | 3 (copy), 4 (wiring) |
| Truncation surfaced under the filter bar, search-only | 2 (flag), 3 (prop), 4 (render) |
| Token AND / field OR matching | 1 |
| Name, email, phone (≥3 digits), ID rules | 1 |
| PII-absent degrades to ID-only | 1 (test 8) |
| `getLeadsCorpus` with 100/page, 25-page cap | 2 |
| `leadsCorpus` tier at 120/600 | 2 |
| Cache key excludes `q` | 2 |
| Hydration: `q` seeds client state from a server prop | 4 |
| Selftest script + npm script, 10 cases | 1 |
