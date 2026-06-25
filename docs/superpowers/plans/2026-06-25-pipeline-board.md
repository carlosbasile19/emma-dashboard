# Read-only Pipeline Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/dashboard/trends` time-series page with a read-only Kanban board that mirrors the client's Olivia sales pipeline (one column per stage, cards = current occupants).

**Architecture:** SSR-first board following the spec `docs/superpowers/specs/2026-06-25-pipeline-board-design.md`. The server page fetches `/pipelines` + page-1 leads for the default pipeline's stages and renders `PipelineBoard`. Two Server Actions handle load-more (`loadStageLeads`), lazy tab activation (`loadPipelineStages`), and force-refresh (`refreshBoard`). All data flows through the existing server-only `lib/olivia/*` proxy (key stays server-side; client id derived from session). Tricky pure logic (stage sort/partition, color fallback, label/meta, pagination math, default-tab selection) lives in a tested `lib/pipeline/board.ts` module.

**Tech Stack:** Next.js 15.5.9 (App Router, async `searchParams`/`params`), React 19 (`useTransition` async actions, Server Actions), TypeScript 5.7 (strict + `noUncheckedIndexedAccess`), Tailwind CSS v4 (custom theme tokens: `ink`, `muted`, `lavender`, `lavender-deep`, `warm`, `violet`, `warning`, `danger`).

## Global Constraints

- **No test framework exists.** Verify pure logic with a `tsx` self-test script (mirrors the existing `email:selftest` convention; relative imports, `node:assert/strict`). Verify everything else with `npx tsc --noEmit` (type gate) and, for the final task, `npm run build` + `npm run lint`. Do **not** add vitest/jest.
- **Strict TS + `noUncheckedIndexedAccess`:** every indexed access is `T | undefined`; guard with `?? <fallback>` or `!` (only when provably non-empty).
- **Path alias:** `@/*` → repo root. Self-test *script* files use **relative** imports (`../lib/...`); all app/lib/component files use `@/`.
- **Tenant safety:** never accept a client id from the browser. All Olivia access goes through `lib/olivia/service.ts`, which derives the client from `getSessionClientId()`. Server actions only take `stageId`/`pipelineId`/`page`.
- **Authoritative counts:** column badge = `stage.lead_count` (never tally returned cards). The badge may legitimately differ from the sum of loaded cards — do not assert equality.
- **Read-only:** no drag/edit/move affordances anywhere.
- **Keep, do not delete:** `fetchTimeseries`/`getTimeseries` and the `timeseries` TIER (used by Overview + `lib/olivia/snapshots.ts`). Only `TrendChart` becomes dead.
- **Route/key unchanged:** path stays `/dashboard/trends`, `NavKey` stays `"trends"`. Only display labels change.
- **Commit after every task.** Conventional-commit messages, prefix `feat(pipeline):` (or `chore(pipeline):` for deletions). End each commit message body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Pipeline data-model types

**Files:**
- Modify: `lib/types.ts` (append new section; add 2 fields to `Lead`)

**Interfaces:**
- Produces: `STAGE_TYPES`, `StageType`, `PipelineStage`, `Pipeline`, `PipelinesResponse`; `Lead.stage_id?`, `Lead.pipeline_id?`.

- [ ] **Step 1: Add the pipeline types**

Append to the end of `lib/types.ts`:

```ts
// ---- Pipelines (board mirror) ----
export const STAGE_TYPES = ["open", "won", "lost"] as const;
export type StageType = (typeof STAGE_TYPES)[number];

export interface PipelineStage {
  id: string;
  name: string;
  color: string; // #RRGGBB — validate before use; the API value may be missing/invalid
  stage_type: StageType;
  order_index: number;
  archived_at: string | null; // non-null = archived column still holding leads
  lead_count: number; // LIVE count — authoritative badge source
}

export interface Pipeline {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  is_default: boolean; // agency-level default
  is_client_default: boolean; // == default_pipeline_id; show first
  order_index: number;
  archived_at: string | null;
  lead_count: number; // pipeline total
  stages: PipelineStage[];
}

export interface PipelinesResponse {
  client_id: string;
  default_pipeline_id: string | null;
  pipelines: Pipeline[];
}
```

- [ ] **Step 2: Add the two Lead fields**

In `lib/types.ts`, inside the `Lead` interface, add after `stage_entered_at?: string | null;` (line ~219):

```ts
  stage_id?: string | null;
  pipeline_id?: string | null;
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat(pipeline): add pipeline/stage types and lead stage fields

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Olivia API binding for `/pipelines` + `stage_id` lead param

**Files:**
- Modify: `lib/olivia/api.ts`

**Interfaces:**
- Consumes: `PipelinesResponse` (Task 1).
- Produces: `getPipelines(clientId: string, h?: Hints): Promise<PipelinesResponse>`; `LeadsParams.stage_id?: string`.

- [ ] **Step 1: Import the new type**

In `lib/olivia/api.ts`, add `PipelinesResponse,` to the existing `import type { … } from "@/lib/types"` block (keep alphabetical: between `Overview,` and `Timeseries,`).

- [ ] **Step 2: Add `stage_id` to `LeadsParams`**

Change the `LeadsParams` line (currently line ~41):

```ts
export type LeadsParams = DateParams &
  PageParams & { status?: string; source?: string; stage_id?: string };
```

- [ ] **Step 3: Add the `getPipelines` binding**

In `lib/olivia/api.ts`, after `getFunnel` (line ~104), add (it uses the file-local `Hints` type and `cid` helper, which are module-private — that's why it must live in this file):

```ts
export function getPipelines(clientId: string, h: Hints = {}) {
  return oliviaFetch<PipelinesResponse>(
    `${ANALYTICS}/clients/${cid(clientId)}/pipelines`,
    { ...h },
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/olivia/api.ts
git commit -m "feat(pipeline): add getPipelines binding and stage_id lead param

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Service wrapper + cache tier

**Files:**
- Modify: `lib/olivia/cache.ts` (add `pipelines` tier)
- Modify: `lib/olivia/service.ts` (add `fetchPipelines`)

**Interfaces:**
- Consumes: `getPipelines` (Task 2), `PipelinesResponse` (Task 1), existing `cachedFetch`/`TIERS`/`Opts`.
- Produces: `fetchPipelines(opts?: Opts): Promise<WithFreshness<PipelinesResponse>>`.

- [ ] **Step 1: Add the cache tier**

In `lib/olivia/cache.ts`, inside the `TIERS` object (after the `leads:` line, ~line 24), add:

```ts
  pipelines: { fresh: 30, stale: 120 },
```

- [ ] **Step 2: Import the type in the service**

In `lib/olivia/service.ts`, add `PipelinesResponse,` to the `import type { … } from "@/lib/types"` block (between `Overview,` and `Timeseries,`).

- [ ] **Step 3: Add the `fetchPipelines` wrapper**

In `lib/olivia/service.ts`, after `fetchCampaigns` (line ~119), add (no-param analog of `fetchCampaigns`):

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

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/olivia/cache.ts lib/olivia/service.ts
git commit -m "feat(pipeline): add fetchPipelines service wrapper and cache tier

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Pure board logic + self-test (TDD)

**Files:**
- Create: `lib/pipeline/board.ts`
- Create: `scripts/pipeline-board-selftest.ts`
- Modify: `package.json` (add `test:pipeline` script)

**Interfaces:**
- Consumes: `CHART_PALETTE` (`@/lib/design`), `fullName`/`shortId`/`relTime` (`@/lib/format`), `Lead`/`Pipeline`/`PipelineStage`/`PipelinesResponse` (`@/lib/types`).
- Produces (all pure, no `server-only` imports — safe in client, server, and tsx):
  - `stageKey(pipelineId: string, stageId: string): string`
  - `isHexColor(value: string | null | undefined): value is string`
  - `resolveStageColor(color: string | null | undefined, index: number): string`
  - `sortStagesForBoard(stages: PipelineStage[]): PipelineStage[]`
  - `visiblePipelines(resp: PipelinesResponse): Pipeline[]`
  - `defaultPipelineId(resp: PipelinesResponse): string | null`
  - `leadCardLabel(lead: Pick<Lead,"id"|"first_name"|"last_name">): string`
  - `leadStageSince(lead: Pick<Lead,"stage_entered_at">, now?: number): string | null`
  - `hasMoreLeads(loadedCount: number, total: number, lastPageCount: number, limit: number): boolean`

- [ ] **Step 1: Write the failing self-test**

Create `scripts/pipeline-board-selftest.ts` (relative imports per the repo's self-test convention):

```ts
import assert from "node:assert/strict";
import {
  defaultPipelineId,
  hasMoreLeads,
  isHexColor,
  leadCardLabel,
  leadStageSince,
  resolveStageColor,
  sortStagesForBoard,
  stageKey,
  visiblePipelines,
} from "../lib/pipeline/board";
import type { Pipeline, PipelineStage, PipelinesResponse } from "../lib/types";

function stage(p: Partial<PipelineStage>): PipelineStage {
  return {
    id: "s",
    name: "Stage",
    color: "#123456",
    stage_type: "open",
    order_index: 0,
    archived_at: null,
    lead_count: 0,
    ...p,
  };
}
function pipeline(p: Partial<Pipeline>): Pipeline {
  return {
    id: "p",
    name: "Pipeline",
    description: null,
    color: null,
    is_default: false,
    is_client_default: false,
    order_index: 0,
    archived_at: null,
    lead_count: 0,
    stages: [],
    ...p,
  };
}

(() => {
  // stageKey
  assert.equal(stageKey("p1", "s1"), "p1::s1");

  // isHexColor
  assert.equal(isHexColor("#AABBCC"), true);
  assert.equal(isHexColor("#abc"), false);
  assert.equal(isHexColor("red"), false);
  assert.equal(isHexColor(null), false);
  assert.equal(isHexColor(undefined), false);

  // resolveStageColor
  assert.equal(resolveStageColor("#0FB5AE", 0), "#0FB5AE");
  assert.equal(resolveStageColor("", 0), "#6D4AFF"); // CHART_PALETTE[0]
  assert.equal(resolveStageColor("nope", 1), "#2E86F2"); // CHART_PALETTE[1]
  assert.equal(typeof resolveStageColor(null, 99), "string"); // wraps, always a string

  // sortStagesForBoard: active by order_index, then archived-with-leads; archived-0 dropped
  const sorted = sortStagesForBoard([
    stage({ id: "b", order_index: 2 }),
    stage({ id: "a", order_index: 1 }),
    stage({ id: "arc0", order_index: 0, archived_at: "2026-01-01", lead_count: 0 }),
    stage({ id: "arc1", order_index: 5, archived_at: "2026-01-01", lead_count: 3 }),
  ]);
  assert.deepEqual(sorted.map((s) => s.id), ["a", "b", "arc1"]);

  // visiblePipelines: archived hidden; client-default first; then order_index
  const resp: PipelinesResponse = {
    client_id: "c",
    default_pipeline_id: "p2",
    pipelines: [
      pipeline({ id: "p1", order_index: 0 }),
      pipeline({ id: "arc", order_index: 1, archived_at: "2026-01-01" }),
      pipeline({ id: "p2", order_index: 2, is_client_default: true }),
    ],
  };
  assert.deepEqual(visiblePipelines(resp).map((p) => p.id), ["p2", "p1"]);

  // defaultPipelineId: client-default if visible
  assert.equal(defaultPipelineId(resp), "p2");
  // fallback to first visible when default missing
  assert.equal(
    defaultPipelineId({ client_id: "c", default_pipeline_id: null, pipelines: [pipeline({ id: "x", order_index: 4 }), pipeline({ id: "y", order_index: 1 })] }),
    "y",
  );
  // null when no visible pipelines
  assert.equal(
    defaultPipelineId({ client_id: "c", default_pipeline_id: "z", pipelines: [pipeline({ id: "z", archived_at: "2026-01-01" })] }),
    null,
  );

  // leadCardLabel
  assert.equal(leadCardLabel({ id: "bd61032d-1111", first_name: "Jane", last_name: "Doe" }), "Jane Doe");
  assert.equal(leadCardLabel({ id: "bd61032d-1111", first_name: null, last_name: null }), "Lead bd61032d");

  // leadStageSince (deterministic via fixed now)
  const now = Date.parse("2026-06-25T12:00:00Z");
  assert.equal(leadStageSince({ stage_entered_at: null }, now), null);
  assert.equal(leadStageSince({ stage_entered_at: undefined }, now), null);
  assert.equal(leadStageSince({ stage_entered_at: "2026-06-23T12:00:00Z" }, now), "2d ago");

  // hasMoreLeads
  assert.equal(hasMoreLeads(50, 120, 50, 50), true); // full page, more remain
  assert.equal(hasMoreLeads(120, 120, 20, 50), false); // reached total
  assert.equal(hasMoreLeads(30, 120, 30, 50), false); // short page → stop
  assert.equal(hasMoreLeads(0, 0, 0, 50), false); // empty stage

  console.log("pipeline-board-selftest: OK");
})();
```

- [ ] **Step 2: Add the npm script and run to verify it FAILS**

In `package.json` `scripts`, add:

```json
    "test:pipeline": "tsx scripts/pipeline-board-selftest.ts",
```

Run: `npm run test:pipeline`
Expected: FAIL — module `../lib/pipeline/board` not found (file doesn't exist yet).

- [ ] **Step 3: Implement the pure module**

Create `lib/pipeline/board.ts`:

```ts
// Pure board logic — no server-only imports, safe in client/server/tsx.
import { CHART_PALETTE } from "@/lib/design";
import { fullName, relTime, shortId } from "@/lib/format";
import type { Lead, Pipeline, PipelineStage, PipelinesResponse } from "@/lib/types";

/** Composite map key — stage ids are not guaranteed unique across pipelines. */
export function stageKey(pipelineId: string, stageId: string): string {
  return `${pipelineId}::${stageId}`;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export function isHexColor(value: string | null | undefined): value is string {
  return typeof value === "string" && HEX.test(value);
}

/** Valid accent color, falling back to the palette (by index) when the API value is bad. */
export function resolveStageColor(color: string | null | undefined, index: number): string {
  if (isHexColor(color)) return color;
  return CHART_PALETTE[index % CHART_PALETTE.length] ?? "#5C6B6D";
}

/** Board-ordered visible stages: active first by order_index, then archived-with-leads. */
export function sortStagesForBoard(stages: PipelineStage[]): PipelineStage[] {
  const byOrder = (a: PipelineStage, b: PipelineStage) => a.order_index - b.order_index;
  const active = stages.filter((s) => !s.archived_at).sort(byOrder);
  const archived = stages.filter((s) => s.archived_at && s.lead_count > 0).sort(byOrder);
  return [...active, ...archived];
}

/** Non-archived pipelines, client-default first, then by order_index. */
export function visiblePipelines(resp: PipelinesResponse): Pipeline[] {
  return resp.pipelines
    .filter((p) => !p.archived_at)
    .sort((a, b) => {
      if (a.is_client_default !== b.is_client_default) return a.is_client_default ? -1 : 1;
      return a.order_index - b.order_index;
    });
}

/** Default tab: client-default pipeline if visible, else first visible; null when none. */
export function defaultPipelineId(resp: PipelinesResponse): string | null {
  const visible = visiblePipelines(resp);
  if (visible.length === 0) return null;
  const preferred = visible.find((p) => p.id === resp.default_pipeline_id || p.is_client_default);
  return (preferred ?? visible[0]!).id;
}

/** Card label — real name when PII present, else a stable short id. */
export function leadCardLabel(lead: Pick<Lead, "id" | "first_name" | "last_name">): string {
  return fullName(lead.first_name, lead.last_name) ?? `Lead ${shortId(lead.id)}`;
}

/** "in stage since" suffix — null when absent (never feed relTime a null). */
export function leadStageSince(
  lead: Pick<Lead, "stage_entered_at">,
  now: number = Date.now(),
): string | null {
  if (!lead.stage_entered_at) return null;
  return relTime(lead.stage_entered_at, now) || null;
}

/** Whether a column has more pages to load. */
export function hasMoreLeads(
  loadedCount: number,
  total: number,
  lastPageCount: number,
  limit: number,
): boolean {
  return loadedCount < total && lastPageCount === limit;
}
```

- [ ] **Step 4: Run the self-test to verify it PASSES**

Run: `npm run test:pipeline`
Expected: prints `pipeline-board-selftest: OK`, exit 0.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/pipeline/board.ts scripts/pipeline-board-selftest.ts package.json
git commit -m "feat(pipeline): add pure board logic with tsx self-test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Rewrite trends copy in place (board language)

**Files:**
- Modify: `lib/copy.ts` (`EMPTY_COPY.trends`, `ERROR_COPY.trends`)

**Interfaces:**
- Produces: board-appropriate `EMPTY_COPY.trends` (no `cta`) and `ERROR_COPY.trends`. (Key set is closed — `CopyKey = Exclude<NavKey,"design">` — so these are rewritten, not added.)

- [ ] **Step 1: Rewrite the empty copy**

In `lib/copy.ts`, replace the `trends:` entry of `EMPTY_COPY` (lines ~14-18) with (note: **no `cta`** — read-only board has no reset action):

```ts
  trends: {
    title: "No pipeline to show",
    body: "This client has no active pipeline yet. Once a pipeline and its stages are set up in Olivia, leads appear here on the board.",
  },
```

- [ ] **Step 2: Rewrite the error copy**

In `lib/copy.ts`, replace the `trends:` entry of `ERROR_COPY` (lines ~56-59) with:

```ts
  trends: {
    title: "We couldn’t load the pipeline",
    body: "The pipeline service didn’t respond just now. Your data is safe — give it another go.",
  },
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/copy.ts
git commit -m "feat(pipeline): rewrite trends empty/error copy for the board

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Relabel nav + screen title to "Pipeline"

**Files:**
- Modify: `lib/design.ts` (`NAV_ITEMS` trends label, `SCREEN_TITLES.trends`)

**Interfaces:**
- Produces: sidebar + header display "Pipeline" for the `trends` route (key + href unchanged).

- [ ] **Step 1: Relabel the nav item**

In `lib/design.ts`, change the `trends` entry of `NAV_ITEMS` (line ~105):

```ts
  { key: "trends", label: "Pipeline", href: "/dashboard/trends", group: "Analytics" },
```

- [ ] **Step 2: Relabel the screen title**

In `lib/design.ts`, change the `trends` line of `SCREEN_TITLES` (line ~120):

```ts
  trends: "Pipeline",
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/design.ts
git commit -m "feat(pipeline): relabel Trends nav and title to Pipeline

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Hide range + campaign filters on the board route

**Files:**
- Modify: `components/dashboard/Header.tsx`

**Interfaces:**
- Consumes: existing `usePathname()`.
- Produces: range buttons + campaign select hidden when `pathname.startsWith("/dashboard/trends")`; unchanged on all other routes.

- [ ] **Step 1: Add the route flag**

In `components/dashboard/Header.tsx`, after `const pathname = usePathname();` (line ~41), add:

```ts
  const isBoard = pathname.startsWith("/dashboard/trends");
```

- [ ] **Step 2: Wrap the two filter blocks**

In `components/dashboard/Header.tsx`, wrap the `{/* date range */}` and `{/* campaign filter */}` blocks (lines ~81-115) in a single guard. Replace those two sibling `<div>`s with:

```tsx
      {!isBoard ? (
        <>
          {/* date range */}
          <div className="flex gap-0.5 rounded-[10px] border border-ink/10 bg-white p-[3px]">
            {RANGES.map((r) => {
              const on = range === r.value;
              return (
                <button
                  key={r.value}
                  onClick={() => setParam("range", r.value)}
                  className={`cursor-pointer rounded-[7px] px-[11px] py-1.5 font-mono text-xs transition-colors ${
                    on ? "bg-ink text-white" : "text-muted hover:bg-lavender"
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>

          {/* campaign filter */}
          <div className="relative">
            <select
              value={campaign}
              onChange={(e) => setParam("campaign", e.target.value)}
              className="max-w-[200px] cursor-pointer appearance-none rounded-[10px] border border-ink/10 bg-white py-2 pl-3 pr-[30px] font-display text-[13px] text-ink"
            >
              {campaignOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-[11px] top-1/2 -translate-y-1/2 text-[10px] text-muted">
              ▼
            </span>
          </div>
        </>
      ) : null}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/Header.tsx
git commit -m "feat(pipeline): hide range/campaign filters on the board route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Board skeleton variant + loading.tsx

**Files:**
- Modify: `components/ui/states/Skeleton.tsx` (add `board` variant)
- Modify: `app/dashboard/trends/loading.tsx` (use the new variant)

**Interfaces:**
- Consumes: existing `Skeleton`/`Block`.
- Produces: `SkeletonVariant` includes `"board"`; `loading.tsx` renders `<Skeleton variant="board" />`.

- [ ] **Step 1: Add `"board"` to the variant union**

In `components/ui/states/Skeleton.tsx`, change the `SkeletonVariant` type (lines 1-7) to include `"board"`:

```ts
export type SkeletonVariant =
  | "cards"
  | "charts"
  | "donuts"
  | "funnel"
  | "campaigns"
  | "table"
  | "board";
```

- [ ] **Step 2: Add the `board` case**

In `components/ui/states/Skeleton.tsx`, add this `case` before `default:` (line ~64):

```tsx
    case "board":
      return (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex w-[300px] flex-none flex-col gap-2 rounded-[14px] border border-ink/10 bg-lavender/40 p-2.5"
            >
              <Block className="mb-1 h-[34px]" />
              {Array.from({ length: 3 }).map((__, j) => (
                <Block key={j} className="h-[72px]" />
              ))}
            </div>
          ))}
        </div>
      );
```

- [ ] **Step 3: Point loading.tsx at the board variant**

Replace the entire contents of `app/dashboard/trends/loading.tsx` with:

```tsx
import { Skeleton } from "@/components/ui/states/Skeleton";

export default function Loading() {
  return <Skeleton variant="board" />;
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ui/states/Skeleton.tsx app/dashboard/trends/loading.tsx
git commit -m "feat(pipeline): add board skeleton variant and loading state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Board view-model types, prefetch helper, and Server Actions

**Files:**
- Create: `lib/pipeline/types.ts`
- Create: `app/dashboard/trends/prefetch.ts`
- Create: `app/dashboard/trends/actions.ts`

**Interfaces:**
- Consumes: `fetchLeads`/`fetchPipelines` (`@/lib/olivia/service`), `OliviaError` (`@/lib/olivia/errors`), `AuthError` (`@/lib/auth`), `sortStagesForBoard`/`stageKey`/`visiblePipelines` (`@/lib/pipeline/board`), `Lead`/`Pipeline`/`PipelinesResponse` (`@/lib/types`).
- Produces:
  - `STAGE_PAGE_LIMIT = 50`, types `StageLeads`, `PrefetchMap`, `PipelineLoadResult`, `RefreshResult` (`@/lib/pipeline/types`)
  - `prefetchPipelineStageLeads(pipeline: Pipeline, opts?: { force?: boolean }): Promise<PrefetchMap>` (`./prefetch`)
  - Actions (`./actions`): `loadStageLeads(stageId: string, page: number): Promise<StageLeads>`; `loadPipelineStages(pipelineId: string): Promise<PipelineLoadResult>`; `refreshBoard(pipelineId: string): Promise<RefreshResult>`

- [ ] **Step 1: Create the view-model types**

Create `lib/pipeline/types.ts` (pure types — safe in client and server):

```ts
import type { Lead, PipelinesResponse } from "@/lib/types";

/** Page size for each stage column's lead fetch. */
export const STAGE_PAGE_LIMIT = 50;

/** Serializable per-stage lead payload returned by the board's actions/prefetch. */
export type StageLeads =
  | { ok: true; items: Lead[]; total: number; limit: number }
  | { ok: false; code: string };

/** stageKey(pipelineId, stageId) → StageLeads */
export type PrefetchMap = Record<string, StageLeads>;

export type PipelineLoadResult =
  | { ok: true; map: PrefetchMap }
  | { ok: false; error: string };

export type RefreshResult =
  | { ok: true; pipelines: PipelinesResponse; map: PrefetchMap; fetchedAt: number; stale: boolean }
  | { ok: false; error: string };
```

- [ ] **Step 2: Create the prefetch helper**

Create `app/dashboard/trends/prefetch.ts` (server module — imported only by server code; not a `"use server"` action file):

```ts
import "server-only";
import { AuthError } from "@/lib/auth";
import { OliviaError } from "@/lib/olivia/errors";
import { fetchLeads } from "@/lib/olivia/service";
import { sortStagesForBoard, stageKey } from "@/lib/pipeline/board";
import { STAGE_PAGE_LIMIT, type PrefetchMap } from "@/lib/pipeline/types";
import type { Pipeline } from "@/lib/types";

export function errCode(e: unknown): string {
  if (e instanceof OliviaError) return e.code;
  if (e instanceof AuthError) return "unauthorized";
  return "error";
}

/** Page-1 leads for every board-visible stage of one pipeline; per-stage failures isolated. */
export async function prefetchPipelineStageLeads(
  pipeline: Pipeline,
  opts: { force?: boolean } = {},
): Promise<PrefetchMap> {
  const stages = sortStagesForBoard(pipeline.stages);
  const settled = await Promise.allSettled(
    stages.map((stage) =>
      fetchLeads(
        { stage_id: stage.id, page: 1, limit: STAGE_PAGE_LIMIT },
        { force: opts.force },
      ),
    ),
  );
  const map: PrefetchMap = {};
  stages.forEach((stage, i) => {
    const key = stageKey(pipeline.id, stage.id);
    const r = settled[i];
    if (r && r.status === "fulfilled") {
      map[key] = {
        ok: true,
        items: r.value.data.items,
        total: r.value.data.total,
        limit: r.value.data.limit,
      };
    } else {
      map[key] = { ok: false, code: errCode(r && r.status === "rejected" ? r.reason : undefined) };
    }
  });
  return map;
}
```

- [ ] **Step 3: Create the Server Actions**

Create `app/dashboard/trends/actions.ts`:

```ts
"use server";
import { AuthError } from "@/lib/auth";
import { OliviaError } from "@/lib/olivia/errors";
import { fetchLeads, fetchPipelines } from "@/lib/olivia/service";
import { visiblePipelines } from "@/lib/pipeline/board";
import {
  STAGE_PAGE_LIMIT,
  type PipelineLoadResult,
  type RefreshResult,
  type StageLeads,
} from "@/lib/pipeline/types";
import { errCode, prefetchPipelineStageLeads } from "./prefetch";

/** One more page of cards for a stage column. */
export async function loadStageLeads(stageId: string, page: number): Promise<StageLeads> {
  if (!stageId || page < 1) return { ok: false, code: "bad_request" };
  try {
    const res = await fetchLeads({ stage_id: stageId, page, limit: STAGE_PAGE_LIMIT });
    return { ok: true, items: res.data.items, total: res.data.total, limit: res.data.limit };
  } catch (e) {
    return { ok: false, code: errCode(e) };
  }
}

/** Lazily prefetch a pipeline's stage columns when its tab is first activated. */
export async function loadPipelineStages(pipelineId: string): Promise<PipelineLoadResult> {
  if (!pipelineId) return { ok: false, error: "bad_request" };
  try {
    const resp = await fetchPipelines();
    const pipeline = visiblePipelines(resp.data).find((p) => p.id === pipelineId);
    if (!pipeline) return { ok: true, map: {} };
    return { ok: true, map: await prefetchPipelineStageLeads(pipeline) };
  } catch (e) {
    return { ok: false, error: errCode(e) };
  }
}

/** Force-refresh: bypass the SWR fresh window for /pipelines AND the active pipeline's cards. */
export async function refreshBoard(pipelineId: string): Promise<RefreshResult> {
  try {
    const fresh = await fetchPipelines({ force: true });
    const visible = visiblePipelines(fresh.data);
    const active = visible.find((p) => p.id === pipelineId) ?? visible[0] ?? null;
    const map = active ? await prefetchPipelineStageLeads(active, { force: true }) : {};
    return {
      ok: true,
      pipelines: fresh.data,
      map,
      fetchedAt: fresh.freshness.fetchedAt,
      stale: fresh.freshness.stale,
    };
  } catch (e) {
    return { ok: false, error: errCode(e) };
  }
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/types.ts app/dashboard/trends/prefetch.ts app/dashboard/trends/actions.ts
git commit -m "feat(pipeline): add board view-model types, prefetch helper, and server actions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: LeadCard component

**Files:**
- Create: `components/dashboard/pipeline/LeadCard.tsx`

**Interfaces:**
- Consumes: `Badge` (`@/components/ui/Badge`), `num` (`@/lib/format`), `leadCardLabel`/`leadStageSince` (`@/lib/pipeline/board`), `Lead` (`@/lib/types`).
- Produces: `LeadCard({ lead: Lead })` — presentational, no hooks, no `server-only` imports (renders identically on the server page and inside the client column).

- [ ] **Step 1: Create the component**

Create `components/dashboard/pipeline/LeadCard.tsx`:

```tsx
import { Badge } from "@/components/ui/Badge";
import { num } from "@/lib/format";
import { leadCardLabel, leadStageSince } from "@/lib/pipeline/board";
import type { Lead } from "@/lib/types";

// Read-only lead card — plain, non-interactive (no drag/edit/click affordances).
export function LeadCard({ lead }: { lead: Lead }) {
  const label = leadCardLabel(lead);
  const since = leadStageSince(lead);
  return (
    <div className="rounded-[10px] border border-ink/10 bg-white px-3 py-2.5 shadow-sm">
      <div className="truncate text-[13px] font-medium text-ink">{label}</div>
      {/* relative time: server-rendered then re-evaluated on hydration — suppress mismatch */}
      <div
        className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-muted"
        suppressHydrationWarning
      >
        <span>☎ {num(lead.total_calls)}</span>
        {since ? <span aria-hidden>·</span> : null}
        {since ? <span>{since}</span> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {lead.last_disposition ? <Badge kind="disp" value={lead.last_disposition} /> : null}
        <Badge kind="source" value={lead.source} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/pipeline/LeadCard.tsx
git commit -m "feat(pipeline): add read-only LeadCard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: StageColumn component

**Files:**
- Create: `components/dashboard/pipeline/StageColumn.tsx`

**Interfaces:**
- Consumes: `loadStageLeads` (`@/app/dashboard/trends/actions`), `LeadCard` (Task 10), `tint` (`@/lib/design`), `num` (`@/lib/format`), `hasMoreLeads`/`resolveStageColor` (`@/lib/pipeline/board`), `STAGE_PAGE_LIMIT`/`StageLeads` (`@/lib/pipeline/types`), `Lead`/`PipelineStage` (`@/lib/types`).
- Produces: `StageColumn({ stage: PipelineStage, index: number, initial: StageLeads | undefined })`.

> Note: a stage column is 300px wide, so the full-page `ErrorState` (min-height 380px, centered, with "Contact support") does not fit. The column uses a compact inline retry button instead; the full `ErrorState` is reserved for board-level failures (Task 13). Won = accent + ✓; lost = forced grey overriding `stage.color`; archived = dimmed.

- [ ] **Step 1: Create the component**

Create `components/dashboard/pipeline/StageColumn.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { loadStageLeads } from "@/app/dashboard/trends/actions";
import { LeadCard } from "@/components/dashboard/pipeline/LeadCard";
import { tint } from "@/lib/design";
import { num } from "@/lib/format";
import { hasMoreLeads, resolveStageColor } from "@/lib/pipeline/board";
import { type StageLeads } from "@/lib/pipeline/types";
import type { Lead, PipelineStage } from "@/lib/types";

const LOST_GREY = "#5C6B6D";

export function StageColumn({
  stage,
  index,
  initial,
}: {
  stage: PipelineStage;
  index: number;
  initial: StageLeads | undefined;
}) {
  const ok = initial && initial.ok ? initial : null;
  const [items, setItems] = useState<Lead[]>(ok ? ok.items : []);
  const [total, setTotal] = useState<number>(ok ? ok.total : 0);
  const [nextPage, setNextPage] = useState<number>(2);
  const [hasMore, setHasMore] = useState<boolean>(
    ok ? hasMoreLeads(ok.items.length, ok.total, ok.items.length, ok.limit) : false,
  );
  const [errorCode, setErrorCode] = useState<string | null>(
    initial && !initial.ok ? initial.code : null,
  );
  const [pending, startTransition] = useTransition();

  const accent = stage.stage_type === "lost" ? LOST_GREY : resolveStageColor(stage.color, index);
  const archived = Boolean(stage.archived_at);

  function loadPage(page: number, replace: boolean) {
    startTransition(async () => {
      const res = await loadStageLeads(stage.id, page);
      if (!res.ok) {
        setErrorCode(res.code);
        return;
      }
      setErrorCode(null);
      const merged = replace ? res.items : [...items, ...res.items];
      setItems(merged);
      setTotal(res.total);
      setNextPage(page + 1);
      setHasMore(hasMoreLeads(merged.length, res.total, res.items.length, res.limit));
    });
  }

  return (
    <section
      aria-label={`${stage.name}, ${num(stage.lead_count)} leads`}
      className={`flex max-h-[70vh] w-[300px] flex-none flex-col rounded-[14px] border border-ink/10 bg-lavender/40 ${
        archived ? "opacity-60" : ""
      }`}
    >
      <header
        className="flex items-center gap-2 rounded-t-[14px] border-b px-3 py-2.5"
        style={{ borderColor: tint(accent, 0.25), background: tint(accent, 0.08) }}
      >
        <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: accent }} />
        <h3 className="m-0 flex-1 truncate text-[13px] font-semibold text-ink">
          {stage.stage_type === "won" ? "✓ " : ""}
          {stage.name}
        </h3>
        <span
          aria-label={`${num(stage.lead_count)} leads`}
          className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-muted"
        >
          {num(stage.lead_count)}
        </span>
      </header>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        {errorCode ? (
          <button
            onClick={() => loadPage(items.length ? nextPage : 1, items.length === 0)}
            disabled={pending}
            className="w-full cursor-pointer rounded-[10px] border border-danger/25 bg-danger/5 px-3 py-2 text-[12px] font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            {pending ? "Retrying…" : "Couldn’t load — retry"}
          </button>
        ) : null}

        {items.map((lead) => (
          <LeadCard key={lead.id} lead={lead} />
        ))}

        {!errorCode && items.length === 0 ? (
          <div className="px-1 py-6 text-center font-mono text-[11px] text-muted">No leads</div>
        ) : null}

        {hasMore && !errorCode ? (
          <button
            onClick={() => loadPage(nextPage, false)}
            disabled={pending}
            className="mt-1 w-full cursor-pointer rounded-[10px] border border-ink/10 bg-white px-3 py-2 text-[12px] font-medium text-ink hover:bg-lavender disabled:opacity-50"
          >
            {pending ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/pipeline/StageColumn.tsx
git commit -m "feat(pipeline): add StageColumn with load-more and inline retry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: PipelineBoard component

**Files:**
- Create: `components/dashboard/pipeline/PipelineBoard.tsx`

**Interfaces:**
- Consumes: `loadPipelineStages`/`refreshBoard` (`@/app/dashboard/trends/actions`), `StageColumn` (Task 11), `EmptyState` (`@/components/ui/states/EmptyState`), `FreshnessNote` (`@/components/ui/FreshnessNote`), `EMPTY_COPY` (`@/lib/copy`), `relTime` (`@/lib/format`), `defaultPipelineId`/`sortStagesForBoard`/`stageKey`/`visiblePipelines` (`@/lib/pipeline/board`), `PrefetchMap` (`@/lib/pipeline/types`), `PipelinesResponse` (`@/lib/types`).
- Produces: `PipelineBoard({ initialPipelines: PipelinesResponse, initialMap: PrefetchMap, initialFetchedAt: number, initialStale: boolean })`.

- [ ] **Step 1: Create the component**

Create `components/dashboard/pipeline/PipelineBoard.tsx`:

```tsx
"use client";
import { useCallback, useMemo, useState, useTransition } from "react";
import { loadPipelineStages, refreshBoard } from "@/app/dashboard/trends/actions";
import { StageColumn } from "@/components/dashboard/pipeline/StageColumn";
import { FreshnessNote } from "@/components/ui/FreshnessNote";
import { EmptyState } from "@/components/ui/states/EmptyState";
import { EMPTY_COPY } from "@/lib/copy";
import { relTime } from "@/lib/format";
import {
  defaultPipelineId,
  sortStagesForBoard,
  stageKey,
  visiblePipelines,
} from "@/lib/pipeline/board";
import { type PrefetchMap } from "@/lib/pipeline/types";
import type { PipelinesResponse } from "@/lib/types";

export function PipelineBoard({
  initialPipelines,
  initialMap,
  initialFetchedAt,
  initialStale,
}: {
  initialPipelines: PipelinesResponse;
  initialMap: PrefetchMap;
  initialFetchedAt: number;
  initialStale: boolean;
}) {
  const [pipelines, setPipelines] = useState(initialPipelines);
  const [activeId, setActiveId] = useState<string | null>(() => defaultPipelineId(initialPipelines));
  const [map, setMap] = useState<PrefetchMap>(initialMap);
  const [fetchedAt, setFetchedAt] = useState(initialFetchedAt);
  const [stale, setStale] = useState(initialStale);
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set(activeId ? [activeId] : []));
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => visiblePipelines(pipelines), [pipelines]);
  const active = visible.find((p) => p.id === activeId) ?? visible[0] ?? null;

  const activateTab = useCallback(
    (id: string) => {
      setActiveId(id);
      if (!loaded.has(id)) {
        setLoaded((prev) => new Set(prev).add(id));
        startTransition(async () => {
          const res = await loadPipelineStages(id);
          if (res.ok) setMap((m) => ({ ...m, ...res.map }));
        });
      }
    },
    [loaded],
  );

  const onRefresh = useCallback(() => {
    if (!active) return;
    const id = active.id;
    startTransition(async () => {
      const res = await refreshBoard(id);
      if (res.ok) {
        setPipelines(res.pipelines);
        setMap(res.map);
        setFetchedAt(res.fetchedAt);
        setStale(res.stale);
        setLoaded(new Set([id]));
      }
    });
  }, [active]);

  if (visible.length === 0) {
    return <EmptyState copy={EMPTY_COPY.trends} />;
  }

  const stages = active ? sortStagesForBoard(active.stages) : [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {visible.length > 1
            ? visible.map((p) => (
                <button
                  key={p.id}
                  onClick={() => activateTab(p.id)}
                  className={`cursor-pointer rounded-[10px] px-3 py-1.5 text-[13px] font-medium ${
                    p.id === active?.id
                      ? "bg-ink text-white"
                      : "border border-ink/10 bg-white text-muted hover:bg-lavender"
                  }`}
                >
                  {p.name}
                </button>
              ))
            : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[12px] text-muted" suppressHydrationWarning>
            updated {relTime(new Date(fetchedAt).toISOString())}
          </span>
          <button
            onClick={onRefresh}
            disabled={pending}
            className="cursor-pointer rounded-[10px] border border-ink/10 bg-white px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-lavender disabled:opacity-50"
          >
            {pending ? "Refreshing…" : "⟳ Refresh"}
          </button>
        </div>
      </div>

      <FreshnessNote freshness={{ fetchedAt, stale }} />

      {stages.length === 0 ? (
        <EmptyState
          copy={{
            title: "This pipeline has no stages",
            body: "There are no active stages in this pipeline yet.",
          }}
        />
      ) : (
        <div role="group" aria-label="Pipeline stages" tabIndex={0} className="flex gap-3 overflow-x-auto pb-3">
          {stages.map((stage, i) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              index={i}
              initial={active ? map[stageKey(active.id, stage.id)] : undefined}
            />
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/pipeline/PipelineBoard.tsx
git commit -m "feat(pipeline): add PipelineBoard with tabs, refresh, and freshness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Replace the page + delete TrendChart

**Files:**
- Modify (replace contents): `app/dashboard/trends/page.tsx`
- Delete: `components/charts/TrendChart.tsx`

**Interfaces:**
- Consumes: `PipelineBoard` (Task 12), `ErrorState` (`@/components/ui/states/ErrorState`), `ERROR_COPY` (`@/lib/copy`), `defaultPipelineId`/`visiblePipelines` (`@/lib/pipeline/board`), `fetchPipelines` (`@/lib/olivia/service`), `OliviaError` (`@/lib/olivia/errors`), `prefetchPipelineStageLeads` (`./prefetch`), `PrefetchMap` (`@/lib/pipeline/types`).
- Produces: the `/dashboard/trends` route renders the board.

- [ ] **Step 1: Replace the page**

Replace the entire contents of `app/dashboard/trends/page.tsx` with:

```tsx
import { PipelineBoard } from "@/components/dashboard/pipeline/PipelineBoard";
import { ErrorState } from "@/components/ui/states/ErrorState";
import { ERROR_COPY } from "@/lib/copy";
import { OliviaError } from "@/lib/olivia/errors";
import { fetchPipelines } from "@/lib/olivia/service";
import { defaultPipelineId, visiblePipelines } from "@/lib/pipeline/board";
import { type PrefetchMap } from "@/lib/pipeline/types";
import { prefetchPipelineStageLeads } from "./prefetch";

export default async function PipelinePage() {
  let result;
  try {
    result = await fetchPipelines();
  } catch (e) {
    const forbidden = e instanceof OliviaError && e.code === "forbidden_scope";
    return (
      <ErrorState
        copy={
          forbidden
            ? {
                title: "Pipeline access isn’t enabled",
                body: "This dashboard isn’t permitted to read this client’s pipeline. Contact your Hey Emma administrator.",
              }
            : ERROR_COPY.trends
        }
      />
    );
  }

  const pipelines = result.data;
  const activeId = defaultPipelineId(pipelines);
  const active = visiblePipelines(pipelines).find((p) => p.id === activeId) ?? null;
  const map: PrefetchMap = active ? await prefetchPipelineStageLeads(active) : {};

  return (
    <PipelineBoard
      initialPipelines={pipelines}
      initialMap={map}
      initialFetchedAt={result.freshness.fetchedAt}
      initialStale={result.freshness.stale}
    />
  );
}
```

- [ ] **Step 2: Delete the now-dead TrendChart**

Run: `git rm components/charts/TrendChart.tsx`
(`TrendChart` was imported only by the old trends page. `fetchTimeseries`/`getTimeseries` stay — they're still used by Overview and `lib/olivia/snapshots.ts`.)

- [ ] **Step 3: Type-check (catches any lingering TrendChart import)**

Run: `npx tsc --noEmit`
Expected: PASS (no "cannot find module TrendChart" anywhere).

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/trends/page.tsx
git commit -m "feat(pipeline): replace trends page with the read-only board

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Full build, lint, and manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the pure-logic self-test**

Run: `npm run test:pipeline`
Expected: `pipeline-board-selftest: OK`.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors (warnings acceptable if pre-existing).

- [ ] **Step 4: Production build (validates RSC/client boundaries + "use server" serialization)**

Run: `npm run build`
Expected: build succeeds; `/dashboard/trends` compiles with no server/client boundary or Server Action serialization errors.

- [ ] **Step 5: Manual smoke (recommended)**

Run: `npm run dev`, sign in with the test login, open `/dashboard/trends`. Confirm:
  - Sidebar + header read "Pipeline"; the 7d/30d/90d range buttons and campaign dropdown are absent on this route but still present on `/dashboard` and `/dashboard/leads`.
  - Columns render pre-sorted, each with a `stage.lead_count` badge; won shows a ✓, lost is grey, archived-with-leads columns are dimmed and last.
  - Cards show a name (or `Lead <shortid>`), `☎ <calls>` and "in stage since", a disposition badge (when present), and a source tag.
  - "Load more" appears only on columns with more than 50 leads and appends cards.
  - "⟳ Refresh" updates the "updated …" timestamp and re-pulls counts/cards.

- [ ] **Step 6: Final no-op commit guard**

If Steps 1-4 required any fixes, commit them:

```bash
git add -A
git commit -m "fix(pipeline): resolve build/lint findings for the board

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(If nothing changed, skip — there is nothing to commit.)

---

## Notes for the implementer

- **Hydration:** relative-time text (`leadStageSince`, the "updated …" line) is rendered on the server then re-evaluated at hydration; both spots use `suppressHydrationWarning`. Don't remove it.
- **`StageColumn.loadPage`** reads `items` from the render closure when appending. This is safe because the button is `disabled` while a transition is `pending`, so loads never overlap. Keep the `disabled={pending}` guards.
- **Server Action error contract:** actions never throw to the client — they return `{ ok: false, … }`. `errCode` maps `OliviaError.code`/`AuthError`/unknown to a string. Keep all action bodies wrapped in try/catch.
- **Do not** make `prefetch.ts` a `"use server"` file — it's a plain server module shared by the page (direct call) and the actions. Only `actions.ts` carries `"use server"`.
