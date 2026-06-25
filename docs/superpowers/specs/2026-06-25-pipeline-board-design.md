# Read-only Pipeline board (replacing Trends) — Design

**Date:** 2026-06-25
**Status:** Approved design (adversarially reviewed against the codebase) → ready for implementation plan
**Route affected:** `/dashboard/trends` (repurposed; path and `NavKey` stay `trends`)

## Summary

Replace the existing `/dashboard/trends` time-series page with a **read-only Kanban
board** that mirrors the client's sales pipeline, sourced from the Olivia external
dashboard API. The board shows one column per pipeline stage with a live lead-count
badge and the current occupants of each stage as cards. No editing, no drag-to-move,
no stage/pipeline management — a pure read-only mirror.

This reuses the app's existing server-side proxy, SWR cache, rate governor, and shared
UI conventions. The genuinely new surface is the pipeline data model (`/pipelines`
endpoint + types), the board UI, and two Server Actions (load-more, force-refresh).

## Goals

- Render the client's pipeline(s) as a Kanban board: one column per stage, cards = the
  leads currently in that stage.
- Column badge counts are **authoritative** (from `stage.lead_count`), never derived by
  tallying returned cards.
- Read-only: no move/edit affordances anywhere.
- Stay within the app's existing all-SSR + Server Action idiom; no new client-side data
  library and no new public REST surface.
- Keep the Olivia API key server-side (already guaranteed by `lib/olivia/*`).

## Non-goals (YAGNI)

- No editing, drag-to-move, stage reordering, or pipeline/stage CRUD.
- No date-range filtering on the board (stage-filtered leads are window-exempt).
- No realtime/websocket updates — refresh is a manual, explicit force-refresh.
- No campaign filtering on this route.

## Background / current state

Findings from codebase exploration (file references current as of 2026-06-25):

- **Trends page today:** `app/dashboard/trends/page.tsx` is an async server component
  rendering 4 metric cards (calls / pickups / bookings / spend) via `TrendChart`
  (Recharts), fed by `fetchTimeseries()`. `app/dashboard/trends/loading.tsx` exists and
  renders `<Skeleton variant="charts" />`.
- **No existing internal "pipelines" page.** "The pipelines structure" we mirror is the
  Olivia *external* pipeline model, not an existing screen.
- **Server-side proxy already exists and is the pattern to follow:**
  - `lib/olivia/client.ts` — `oliviaFetch<T>()` (server-only) injects `x-api-key` from
    `process.env.OLIVIA_API_KEY`, base `OLIVIA_API_BASE`; handles 429 retries; throws
    typed `OliviaError` with `.status` and `.code`. (The relevant cache is the Supabase
    SWR cache below — **not** the Next.js Data Cache.)
  - `lib/olivia/api.ts` — typed endpoint bindings. `ANALYTICS = "/api/external/v1"`.
    `getLeads(clientId, params)` calls `/clients/{cid}/leads` and passes params straight
    through, returning `{ items, total, page, limit }`. `LeadsParams = DateParams &
    PageParams & { status?: string; source?: string }` — **no `stage_id` yet**. **No
    `getPipelines` yet.** `Hints` (type) and `cid` (helper) are **module-private** (not
    exported); `getCampaigns` is the existing no-param binding pattern.
  - `lib/olivia/service.ts` — session-scoped wrappers; every call derives `clientId` from
    `getSessionClientId()` (browser never supplies it). `fetchLeads()` returns
    `WithFreshness<ListResponse<Lead>>` (so `res.data.items/.total/.page/.limit` and
    `res.freshness`). `fetchCampaigns` is the no-param analog (`params: {}`). An `Opts`
    type with a `force` flag already exists and is threaded into `cachedFetch`.
  - `lib/olivia/cache.ts` — stale-while-revalidate via Supabase `response_cache`, keyed by
    client + endpoint + params. `cachedFetch({ clientId, endpoint, params, tier, fetcher,
    force? })`. **Critical:** `if (row && !force && ageSec < tier.fresh) return
    fresh(...)` — within the fresh window it returns cached data with **no upstream call**
    and `stale:false`. The only way to bypass the fresh window is `force: true` via a
    Server Action. `TIERS` is `as const satisfies Record<string, Tier>`; `leads:
    { fresh: 30, stale: 60 }`.
  - `lib/olivia/governor.ts` — token-bucket rate limiter (~500/min).
- **Auth:** `middleware.ts` gates all dashboard routes; `getSessionClientId()`
  (`lib/auth.ts`) is the single source of tenant identity and **throws `AuthError`**
  (with `.status`) when unauthenticated.
- **Shared UI:**
  - `components/ui/Card.tsx`, `components/ui/Badge.tsx` — `Badge({ kind: BadgeKind, value:
    string })`; disposition colors live only under `BADGE_COLORS.disp`, source under
    `BADGE_COLORS.source`; unknown values fall back to `#5C6B6D`. `tint()` does
    `parseInt(hex.slice(1),16)` → garbage on a non-`#RRGGBB` input.
  - `components/ui/states/EmptyState.tsx` — **`"use client"`**; renders a CTA button only
    when `copy.cta` is set (calls `onAction`).
  - `components/ui/states/ErrorState.tsx` — **`"use client"`**; default retry calls
    `window.location.reload()`, plus an always-present "Contact support" button.
  - `components/ui/FreshnessNote.tsx` — **returns `null` when `!freshness.stale`**; only
    renders a "Showing cached data … — refreshing" warning when stale. It does **not**
    render an "updated Xm ago" line on a fresh load.
  - `components/ui/states/Skeleton.tsx` — `SkeletonVariant` =
    `cards|charts|donuts|funnel|campaigns|table` (**no board/column variant**).
  - `components/dashboard/Header.tsx` — already calls `usePathname()`; hardcodes a private
    `RANGES` const and renders the 7d/30d/90d buttons + a required-prop `campaignOptions`
    `<select>` **unconditionally**; renders the H1 from `SCREEN_TITLES` via
    `titleFor(pathname)`; also renders the workspace badge + `WorkspaceSwitcher`.
  - `components/dashboard/Sidebar.tsx` — renders `{item.label}` from `NAV_ITEMS` (no
    literals). `app/dashboard/layout.tsx` renders one shared `<Header>` for **all**
    dashboard routes (always passing `campaignOptions`), with no per-route branch.
  - `lib/design.ts` — `NAV_ITEMS` (`{ key: "trends", label: "Trends", … }`),
    `SCREEN_TITLES` (`trends: "Trends"`), `NavKey` (closed union), `STAGE_COLORS`,
    `CHART_PALETTE`, `tint()`, `badgeColor()`.
  - `lib/copy.ts` — `EMPTY_COPY`/`ERROR_COPY` are `Record<CopyKey, …>` where
    `CopyKey = Exclude<NavKey, "design">` — a **closed** key set. The existing
    `EMPTY_COPY.trends`/`ERROR_COPY.trends` use time-series wording ("Widen the date
    range", "Reset to last 90 days", "time-series service timed out").
  - `lib/format.ts` — `fullName(first, last)` returns `string | null` (null when PII
    redacted); `shortId(id)` returns `id.split("-")[0]` (~8 hex chars, e.g. `bd61032d`,
    **no `Lead ` prefix**); `relTime(iso)` returns `""` only when the date is NaN —
    `relTime(null)` is unsafe (`new Date(null)` = epoch 1970).
- **Lead type** (`lib/types.ts`) already has: `status`, `source`, `tags`, `industry`,
  `timezone`, `created_at`, `updated_at`, `last_call_at`,
  `last_disposition: CallDisposition | null`, `total_calls`,
  `stage_entered_at?: string | null`, and PII fields. **Missing:** `stage_id`,
  `pipeline_id`.
- **`TrendChart`** (`components/charts/TrendChart.tsx`) is imported **only** by the trends
  page — it becomes fully dead once the page is replaced. **`fetchTimeseries`/
  `getTimeseries`** are still used by Overview (`app/dashboard/page.tsx`) and
  `lib/olivia/snapshots.ts` — **must be kept**.

## Architecture decision

**Approach A — SSR + Server Actions** (chosen over a client-fetch hybrid and a leanest
no-load-more variant):

- The server component fetches `/pipelines` (structure + authoritative counts) and, in
  parallel, page 1 (limit 50) of leads for **the initially-selected pipeline's stages
  only**, then renders the board server-side on first paint. Other tabs' stage leads are
  fetched lazily when that tab is first activated.
- **Refresh** is a `refreshBoard()` **Server Action** (force-refresh) — `router.refresh()`
  alone is insufficient (see below).
- **Load more** per column calls a `loadStageLeads()` **Server Action** that returns the
  next page of cards; a light client column wrapper appends them.

Rationale: matches the app's existing all-SSR pattern, introduces no client-side data
library and no new public REST endpoint, and populates the visible pipeline's columns on
first paint.

**Cost bound:** the per-navigation re-fetch cost is bounded by the **fresh window — 30s
for both the `leads` and `pipelines` tiers** (within 30s, navigations hit cache with no
upstream call). The stale windows (60s leads / 120s pipelines) only affect on-error /
contention serving, not the no-upstream short-circuit. Worst-case first-paint fan-out =
`1 (pipelines) + N (stages in the default pipeline)` upstream calls, well under the
~500/min governor for realistic pipelines (≈5–15 stages).

**Refresh requires `force: true` (was a blocker):** data flows through the Supabase SWR
cache, **not** the Next.js Data Cache, so `router.refresh()` re-runs the RSC but
`cachedFetch` still short-circuits to cached data inside the 30s fresh window — the button
would appear broken. Therefore `refreshBoard()` calls `fetchPipelines({ force: true })`
**and** re-fetches page-1 leads for the selected pipeline's stages with `{ force: true }`,
returns the fresh structure + prefetched map, and `PipelineBoard` swaps that result into
client state (it may also call `router.refresh()` afterward purely to re-render the tree).
Prefetched page-1 leads must be force-refreshed too, or columns show stale cards even
after the badge count moves.

## Data model additions (`lib/types.ts`)

```ts
export const STAGE_TYPES = ["open", "won", "lost"] as const;
export type StageType = (typeof STAGE_TYPES)[number];

export interface PipelineStage {
  id: string;
  name: string;
  color: string;                 // #RRGGBB — column accent + badge (validate; may be bad)
  stage_type: StageType;
  order_index: number;
  archived_at: string | null;    // non-null = archived column still holding leads
  lead_count: number;            // LIVE count — authoritative badge source
}

export interface Pipeline {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  is_default: boolean;           // agency-level default
  is_client_default: boolean;    // == default_pipeline_id; show first
  order_index: number;
  archived_at: string | null;
  lead_count: number;            // pipeline total (sum of its stages)
  stages: PipelineStage[];
}

export interface PipelinesResponse {
  client_id: string;
  default_pipeline_id: string | null;
  pipelines: Pipeline[];
}
```

Add two fields to the existing `Lead` interface:

```ts
  stage_id?: string | null;
  pipeline_id?: string | null;
```

## Data layer

### `lib/olivia/api.ts`
- Add `stage_id?: string` to `LeadsParams` (params already pass straight through; `getLeads`
  needs no other change).
- Add `PipelinesResponse` to the existing `import type { … } from "@/lib/types"` block.
- Add `getPipelines` **inside `api.ts`** (so it can use the file-local `Hints` type and
  `cid()` helper, which are not exported):
  ```ts
  export function getPipelines(clientId: string, h: Hints = {}) {
    return oliviaFetch<PipelinesResponse>(
      `${ANALYTICS}/clients/${cid(clientId)}/pipelines`,
      { ...h },
    );
  }
  ```
- **Required scope (source of truth):** per the Olivia external API contract, `/pipelines`
  and `/leads` require the agency key's **`dashboard:read`** scope; PII lead fields
  additionally require `dashboard:pii`. A missing scope returns `403 forbidden_scope`.

### `lib/olivia/service.ts`
- Add `PipelinesResponse` to the type import list.
- Add `fetchPipelines` (no-param analog of `fetchCampaigns`):
  ```ts
  export async function fetchPipelines(
    opts: Opts = {},
  ): Promise<WithFreshness<PipelinesResponse>> {
    const clientId = await getSessionClientId();
    return cachedFetch({
      clientId,
      endpoint: "pipelines",
      params: {},
      tier: TIERS.pipelines,
      force: opts.force,
      fetcher: () => api.getPipelines(clientId),
    });
  }
  ```
- `fetchLeads()` already accepts `LeadsParams`; once `stage_id` is in the type it works
  unchanged. The board calls it with `{ stage_id, page, limit: 50 }` and **no** `from`/`to`.

### `lib/olivia/cache.ts`
- Add to `TIERS`: `pipelines: { fresh: 30, stale: 120 }`.
- Stage-filtered leads reuse the existing `leads` tier (30s/60s). Each column caches under
  its own `stage_id` key automatically (params are part of the cache key).

### Server Actions — `app/dashboard/trends/actions.ts` (`"use server"`)
Imports: `import { fetchLeads, fetchPipelines } from "@/lib/olivia/service";` plus the
`Lead`/`StageType`/etc. types and `OliviaError`/`AuthError` as needed. All actions derive
`clientId` from the session inside the service calls; they never trust a client-supplied
client id. A forged `stageId` can only read within the caller's own client scope (Olivia
returns that stage's leads or an empty set).

```ts
// Serializable result shapes
type StageLeadsResult =
  | { ok: true; items: Lead[]; total: number; page: number; limit: number }
  | { ok: false; code: string };

export async function loadStageLeads(
  stageId: string,
  page: number,
): Promise<StageLeadsResult> {
  if (!stageId) return { ok: false, code: "bad_request" };
  try {
    const res = await fetchLeads({ stage_id: stageId, page, limit: 50 });
    return {
      ok: true,
      items: res.data.items,
      total: res.data.total,
      page,
      limit: res.data.limit,
    };
  } catch (e) {
    const code =
      e instanceof OliviaError ? e.code : e instanceof AuthError ? "unauthorized" : "error";
    return { ok: false, code };
  }
}
```
`refreshBoard(pipelineId)` force-refreshes `/pipelines` and the given pipeline's page-1
stage leads (`Promise.allSettled`, each `{ force: true }`), returning the fresh
`PipelinesResponse` + prefetched map + freshness; per-stage failures degrade to
`{ ok: false, code }` entries in the map (board stays up).

## Page & component structure

```
app/dashboard/trends/
  page.tsx        (server) fetch pipelines; Promise.allSettled page-1 leads for the
                  selected pipeline's stages → <PipelineBoard>
  actions.ts      (server) loadStageLeads(stageId, page); refreshBoard(pipelineId)
  loading.tsx     REPLACE existing (<Skeleton variant="charts"/>) → column-shell skeleton

components/dashboard/pipeline/
  PipelineBoard.tsx   (client) tab switching (if >1 pipeline), Refresh button (refreshBoard),
                      "updated {relTime}" line, FreshnessNote (stale only); holds prefetched
                      map in client state and swaps it on refresh
  StageColumn.tsx     (client) header (accent + heading + count badge) + card list +
                      "Load more" (loadStageLeads) + inline per-column ErrorState/retry
  LeadCard.tsx        presentational: NO hooks, NO server-only imports — importable by a
                      client component; takes already-serialized lead view data as props
                      (works for the server page's page-1 AND client-appended pages)

components/ui/states/Skeleton.tsx   add a `board` variant (horizontally-scrolling column shells)
```

The page passes the `pipelines` structure plus a prefetched map keyed by
**`${pipelineId}::${stageId}`** (stage-id global uniqueness is not guaranteed across
pipelines, so the composite key avoids cross-tab collisions). Map value is a discriminated
union: `{ ok: true; items: Lead[]; total: number; limit: number } | { ok: false; code:
string }`. `StageColumn` starts from its prefetched entry and calls `loadStageLeads` for
subsequent pages; `PipelineBoard` lazily prefetches a pipeline's stage leads when its tab
is first activated.

## Board layout & UX

```
 Pipeline                                   updated 1m ago ·  [⟳ Refresh]
 ┌─ [Sales Pipeline] ─ [Reactivation] ──┐     ← tabs only if >1 visible pipeline
 ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
 │▎New    12│ │▎Working 8│ │▎Booked  3│ │✓ Won   21│ │ Lost   5 │  ← badge = stage.lead_count
 ├──────────┤ ├──────────┤ ├──────────┤ ├──────────┤ ├──────────┤
 │ Jane D.  │ │ Lead     │ │ M. Ross  │ │ A. Kim   │ │ (greyed) │
 │ bd61032d │ │ 7f3a9c20 │ │          │ │          │ │          │
 │ ☎ 3 · 2d │ │ ☎ 1 · 5h │ │ ☎ 6 · 1d │ │ ☎ 9 ·12d │ │          │
 │ [callbk] │ │ [vmail]  │ │ [booked] │ │ [booked] │ │          │
 ├──────────┤ └──────────┘ └──────────┘ └──────────┘ └──────────┘
 │ Load more│   (shown only while hasMore)
 └──────────┘
```

- **Columns:** horizontal scroll, fixed width (~300px). **Sort/partition:** active
  (non-archived) stages first by `order_index`, then archived stages **with
  `lead_count > 0`** appended at the end (also by `order_index`). Archived stages with
  `lead_count` 0 are **hidden**. This prevents a greyed column interleaving the live flow.
- **Accent color:** use `stage.color` if it is a valid `#RRGGBB`; otherwise fall back to a
  `CHART_PALETTE`/`STAGE_COLORS` color (by stage index) **before** calling `tint()` (tint
  produces garbage on bad hex).
- **Badge count:** **always `stage.lead_count`** (authoritative live count). Never tally
  the returned `/leads` cards for the badge. The badge may **not** equal the eventual sum
  of loaded cards (the live count and the leads-endpoint total can legitimately diverge);
  this is expected — do not assert equality.
- **Won/Lost precedence:** `lost` stages always render **muted/grey, overriding
  `stage.color`**; `won` keeps `stage.color` plus a ✓ marker; `open` uses `stage.color`.
- **Archived stages** (`archived_at` non-null, shown only if `lead_count > 0`): greyed and
  collapsed.
- **Card content:**
  - Label: `fullName(lead.first_name, lead.last_name) ?? \`Lead ${shortId(lead.id)}\``
    (never an empty card; PII-absent → `Lead bd61032d`-style).
  - Meta: `☎ {total_calls}`; append ` · {relTime(stage_entered_at)}` **only when
    `stage_entered_at` is truthy** (never pass null/undefined to `relTime`) — otherwise no
    trailing separator.
  - Disposition: `lead.last_disposition ? <Badge kind="disp" value={lead.last_disposition}
    /> : null`.
  - Source: `<Badge kind="source" value={lead.source} />`.
  - Cards are **non-interactive plain elements** — no drag handles, no edit/click
    affordances. (Optional future add: click → existing read-only `LeadDrawer`.)
- **Multiple pipelines:** tabs over **visible (non-archived)** pipelines, ordered
  `is_client_default` first then `order_index`. Default-selected tab = the client-default
  pipeline **if it is visible**, else the first visible pipeline by `order_index`.
  Archived pipelines are hidden. Single visible pipeline → no tabs.
- **"Updated" line + Refresh:** `PipelineBoard` renders an **always-visible "updated
  {relTime(freshness.fetchedAt)}"** element (this is NOT `FreshnessNote`, which only shows
  a stale banner) next to a **Refresh** button wired to `refreshBoard(activePipelineId)`.
  `FreshnessNote` is still rendered to surface the stale warning when `freshness.stale`.

### Accessibility
- Wrap the columns in a labeled, focusable scroll region (`role="group"`,
  `aria-label="Pipeline stages"`, `tabindex={0}` for keyboard arrow-scroll).
- Render each stage name as a heading element.
- Give each count badge an accessible label (e.g. `aria-label="12 leads"`).
- Use reduced-motion-safe scrolling.

### Header changes (commit to Header-internal route-awareness)
`Header.tsx` already calls `usePathname()`. Gate the **range-button block** and the
**campaign `<select>` block** behind `pathname.startsWith("/dashboard/trends")` so both
are hidden on the board route, while preserving the H1 title, workspace badge, and
`WorkspaceSwitcher`. (The "layout doesn't pass controls" alternative is not viable —
`layout.tsx` renders one shared `<Header>` for all routes and `campaignOptions` is a
required prop.) **Acceptance criterion:** the other dashboard routes (Overview, Funnel,
Outcomes, Agents, Leads, Log, etc.) still render both filters unchanged.

### Nav + title relabel (in `lib/design.ts`, not the Sidebar)
Set `NAV_ITEMS` `trends.label` → `"Pipeline"` **and** `SCREEN_TITLES.trends` →
`"Pipeline"`. The `NavKey` stays `"trends"` (path unchanged), so `titleFor`, the copy maps,
and routing keys remain valid. The Sidebar/Header render these automatically (no literal
edits there).

## Error, empty & loading states

- **Whole-board failure** (`fetchPipelines` throws): catch in `page.tsx`; render a
  board-level `ErrorState`. For `OliviaError.code === "forbidden_scope"` (403), use copy
  explaining the dashboard can't read this client's pipeline right now (friendly prose,
  consistent with existing `ERROR_COPY` tone — **do not** surface the raw `dashboard:read`
  token; the scope requirement is documented in the Data layer, not shown to users).
  `client_not_found` (404) shouldn't occur (client from session) but is handled
  defensively with the same generic load-failure copy.
- **Single-column failure** (initial prefetch or load-more): handled at a different layer
  from board-wide errors. The prefetch uses `Promise.allSettled`, so one stage's failure
  yields a `{ ok: false, code }` map entry; `loadStageLeads` catches and returns the same
  shape. `StageColumn` renders an inline `ErrorState` with a **column-scoped `onRetry`**
  that re-calls `loadStageLeads` (not the default `window.location.reload()`); the rest of
  the board stays up. (Note: `ErrorState` always renders a "Contact support" button — keep
  it, or parameterize it out if undesired during implementation.)
- **Empty stage** (`lead_count` 0): normal empty column (no error).
- **Empty/zero-state pipelines:**
  - Render the **"no pipelines"** `EmptyState` when the count of **visible (non-archived)**
    pipelines is 0 (not raw `pipelines.length`).
  - A visible pipeline with **zero non-archived stages** renders a per-pipeline empty
    state inside its tab.
  - Empty-state copy is passed with **no `cta`** so `EmptyState` renders no button
    (read-only board has no reset action).
- **Load-more stop math:** `loadStageLeads` returns `limit`. `hasMore =
  accumulatedItems.length < res.total && lastPage.items.length === limit`. Hide "Load more"
  when `hasMore` is false. `stage.lead_count` drives the **badge**; `res.total` (the
  leads-endpoint total under the `stage_id` filter) drives **load-more**.
- **Copy (closed key set):** `CopyKey = Exclude<NavKey, "design">`, so new keys cannot be
  added without extending `NavKey`. Since the route keeps `NavKey "trends"`, **rewrite
  `EMPTY_COPY.trends` and `ERROR_COPY.trends` in place** with board language (remove the
  "Reset to last 90 days" CTA and date-range wording), e.g. empty → title "This pipeline
  has no leads yet" (no `cta`); error → generic "We couldn't load the pipeline" prose.
  States not covered by the per-`NavKey` `Record` (the `forbidden_scope` message; the
  "no pipelines" vs "empty pipeline" distinction) use **inline literal copy** in the board
  components, not the `Record`.
- **Loading:** REPLACE `loading.tsx` to render the new `Skeleton` `board` variant
  (column-shell skeletons).

## Files touched (summary)

- `lib/types.ts` — add `STAGE_TYPES`, `StageType`, `PipelineStage`, `Pipeline`,
  `PipelinesResponse`; add `stage_id`, `pipeline_id` to `Lead`.
- `lib/olivia/api.ts` — add `stage_id` to `LeadsParams`; import `PipelinesResponse`; add
  `getPipelines` (uses file-local `Hints`/`cid`).
- `lib/olivia/service.ts` — import `PipelinesResponse`; add `fetchPipelines`.
- `lib/olivia/cache.ts` — add `pipelines: { fresh: 30, stale: 120 }` to `TIERS`.
- `lib/copy.ts` — rewrite `EMPTY_COPY.trends` + `ERROR_COPY.trends` in place (board copy).
- `lib/design.ts` — `NAV_ITEMS.trends.label` → "Pipeline"; `SCREEN_TITLES.trends` →
  "Pipeline".
- `app/dashboard/trends/page.tsx` — replace with board server component.
- `app/dashboard/trends/actions.ts` — `loadStageLeads`, `refreshBoard` server actions.
- `app/dashboard/trends/loading.tsx` — REPLACE with board-variant skeleton.
- `components/dashboard/pipeline/{PipelineBoard,StageColumn,LeadCard}.tsx` — new.
- `components/ui/states/Skeleton.tsx` — add `board` variant.
- `components/dashboard/Header.tsx` — hide range buttons + campaign select on
  `/dashboard/trends` via `usePathname()`; keep them on all other routes.
- **DELETE** `components/charts/TrendChart.tsx` (sole importer is the trends page; also
  removes its `TrendPoint` type).
- **DO NOT TOUCH** `fetchTimeseries`/`getTimeseries` and the `timeseries` tier — still used
  by Overview (`app/dashboard/page.tsx`) and `lib/olivia/snapshots.ts`.

## Open decisions (defaulted; override if needed)

1. Keep path `/dashboard/trends` and `NavKey "trends"`; relabel display to "Pipeline"
   (vs. a new `/dashboard/pipeline` route + redirect + new `NavKey`). **Default:
   relabel-display-only.**
2. Cards are non-clickable. **Default: no `LeadDrawer` on click** (optional future add).
3. Multiple pipelines render as tabs. **Default: tabs.**
4. Assume the agency key carries `dashboard:pii` (the Leads page already shows names);
   cards degrade gracefully to `Lead {shortId}` labels if absent.
