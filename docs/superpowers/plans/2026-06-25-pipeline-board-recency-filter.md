# Pipeline Board Recency Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a board-level recency window (All/7d/30d/90d) that filters each pipeline column's loaded cards by `stage_entered_at`, client-side, without changing the authoritative `stage.lead_count` badge.

**Architecture:** A pure, unit-tested `isWithinWindow` helper in `lib/pipeline/board.ts`; window state + a segmented control in `PipelineBoard`; a `windowDays` prop on `StageColumn` that derives the visible card list at render time (no remount, no refetch). Builds on the merged read-only board (spec: `docs/superpowers/specs/2026-06-25-pipeline-board-recency-filter-design.md`).

**Tech Stack:** Next.js 15.5.9 (App Router), React 19 (client components), TypeScript 5.7 (strict + `noUncheckedIndexedAccess`), Tailwind CSS v4 (tokens `ink`, `muted`, `lavender`, `danger`).

## Global Constraints

- **Badge is always `stage.lead_count`** (live authoritative total) — the filter NEVER changes the badge.
- **Default window = `null` (All)** — no filtering, board behaves exactly as today until a window is chosen. (This is also why there's no hydration concern: initial SSR/hydration renders unfiltered.)
- **Client-side only.** No changes to `lib/olivia/*`, `lib/types.ts`, `lib/copy.ts`, the Header, the page, or the server actions. No `/leads` date params.
- **No test framework.** Verify the pure helper with the existing `tsx` self-test (`npm run test:pipeline`); verify components with `npx tsc --noEmit`, `npm run lint`, `npm run build`. Do not add vitest/jest.
- **Strict TS + `noUncheckedIndexedAccess`** — guard indexed access with `?? fallback` / `!`.
- **No remount on window change:** the `StageColumn` key in `PipelineBoard` must NOT include `windowDays` (changing the window is a prop-driven re-render that preserves loaded items + Load-more state).
- The toolchain resolves via a symlinked `node_modules` already present in the worktree; run `npx tsc`/`npm run` from the worktree root.
- **Commit after every task.** Conventional commits, prefix `feat(pipeline):`. End each commit message body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: `isWithinWindow` pure helper + self-test (TDD)

**Files:**
- Modify: `lib/pipeline/board.ts` (add one exported function)
- Modify: `scripts/pipeline-board-selftest.ts` (add import + assertions)

**Interfaces:**
- Consumes: nothing new.
- Produces: `isWithinWindow(stageEnteredAt: string | null | undefined, days: number, now?: number): boolean`.

- [ ] **Step 1: Write the failing test**

In `scripts/pipeline-board-selftest.ts`, add `isWithinWindow` to the existing import from `../lib/pipeline/board` (it currently imports `defaultPipelineId, hasMoreLeads, isHexColor, leadCardLabel, leadStageSince, resolveStageColor, sortStagesForBoard, stageKey, visiblePipelines`). Then, immediately before the final `console.log("pipeline-board-selftest: OK");`, add:

```ts
  // isWithinWindow (deterministic via fixed now)
  const wNow = Date.parse("2026-06-25T12:00:00Z");
  assert.equal(isWithinWindow(null, 30, wNow), false);
  assert.equal(isWithinWindow(undefined, 30, wNow), false);
  assert.equal(isWithinWindow("not-a-date", 30, wNow), false);
  assert.equal(isWithinWindow("2026-06-23T12:00:00Z", 7, wNow), true); // 2d ago, in 7d
  assert.equal(isWithinWindow("2026-06-10T12:00:00Z", 7, wNow), false); // 15d ago, out of 7d
  assert.equal(isWithinWindow("2026-06-10T12:00:00Z", 30, wNow), true); // 15d ago, in 30d
  assert.equal(isWithinWindow("2026-03-01T12:00:00Z", 90, wNow), false); // ~116d ago, out of 90d
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `npm run test:pipeline`
Expected: FAIL — `isWithinWindow` is not exported yet (TypeError "isWithinWindow is not a function" or an import error). Does NOT print `pipeline-board-selftest: OK`.

- [ ] **Step 3: Implement the helper**

In `lib/pipeline/board.ts`, add at the end of the file (after `hasMoreLeads`):

```ts
/** True when stage_entered_at falls within the last `days` (false for null/invalid). */
export function isWithinWindow(
  stageEnteredAt: string | null | undefined,
  days: number,
  now: number = Date.now(),
): boolean {
  if (!stageEnteredAt) return false;
  const t = new Date(stageEnteredAt).getTime();
  if (Number.isNaN(t)) return false;
  return t >= now - days * 24 * 60 * 60 * 1000;
}
```

- [ ] **Step 4: Run the test to verify it PASSES**

Run: `npm run test:pipeline`
Expected: prints `pipeline-board-selftest: OK`, exit 0.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/pipeline/board.ts scripts/pipeline-board-selftest.ts
git commit -m "feat(pipeline): add isWithinWindow recency helper with self-test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: StageColumn recency filter

**Files:**
- Modify: `components/dashboard/pipeline/StageColumn.tsx`

**Interfaces:**
- Consumes: `isWithinWindow` (Task 1), existing `num`, `LeadCard`, `Lead`, `PipelineStage`.
- Produces: `StageColumn` now accepts an optional `windowDays?: number | null` prop (undefined/null → no filter, unchanged behavior).

> The prop is OPTIONAL so this task compiles and the board still works before `PipelineBoard` wires the control (Task 3). The badge, section `aria-label`, accent/won/lost/archived styling, `hasMore`, and "Load more" are untouched — the filter is display-only.

- [ ] **Step 1: Add `isWithinWindow` to the board import**

Change the import on line 7 of `components/dashboard/pipeline/StageColumn.tsx`:

```tsx
import { hasMoreLeads, isWithinWindow, resolveStageColor } from "@/lib/pipeline/board";
```

- [ ] **Step 2: Add the `windowDays` prop**

Change the component signature (lines 13-21) to add `windowDays`:

```tsx
export function StageColumn({
  stage,
  index,
  initial,
  windowDays,
}: {
  stage: PipelineStage;
  index: number;
  initial: StageLeads | undefined;
  windowDays?: number | null;
}) {
```

- [ ] **Step 3: Derive the visible (filtered) cards**

In `components/dashboard/pipeline/StageColumn.tsx`, after the `const archived = Boolean(stage.archived_at);` line (line 34), add:

```tsx
  const visible = windowDays
    ? items.filter((l) => isWithinWindow(l.stage_entered_at, windowDays))
    : items;
```

- [ ] **Step 4: Add the in-window sub-line under the header**

Immediately after the closing `</header>` (line 73) and before the cards `<div className="flex flex-1 ...">`, add:

```tsx
      {windowDays ? (
        <div className="border-b border-ink/5 px-3 py-1 font-mono text-[10.5px] text-muted">
          {num(visible.length)} in last {windowDays}d
        </div>
      ) : null}
```

- [ ] **Step 5: Render the filtered cards and the dual empty hint**

Replace the cards map and the empty block (currently lines 86-92):

```tsx
        {items.map((lead) => (
          <LeadCard key={lead.id} lead={lead} />
        ))}

        {!errorCode && items.length === 0 ? (
          <div className="px-1 py-6 text-center font-mono text-[11px] text-muted">No leads</div>
        ) : null}
```

with:

```tsx
        {visible.map((lead) => (
          <LeadCard key={lead.id} lead={lead} />
        ))}

        {!errorCode && items.length === 0 ? (
          <div className="px-1 py-6 text-center font-mono text-[11px] text-muted">No leads</div>
        ) : !errorCode && windowDays && visible.length === 0 ? (
          <div className="px-1 py-6 text-center font-mono text-[11px] text-muted">
            No movement in last {windowDays}d
          </div>
        ) : null}
```

(Leave the error-retry button above and the "Load more" button below exactly as they are.)

- [ ] **Step 6: Type-check + lint + build**

Run: `npx tsc --noEmit` → PASS.
Run: `npm run lint` → no new errors/warnings.
Run: `npm run build` → succeeds, `/dashboard/trends` compiles.

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/pipeline/StageColumn.tsx
git commit -m "feat(pipeline): filter StageColumn cards by recency window

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: PipelineBoard window control

**Files:**
- Modify: `components/dashboard/pipeline/PipelineBoard.tsx`

**Interfaces:**
- Consumes: `StageColumn`'s `windowDays?: number | null` prop (Task 2).
- Produces: a board-level window control; `windowDays` is passed to every `StageColumn`.

- [ ] **Step 1: Add the `WINDOWS` constant**

In `components/dashboard/pipeline/PipelineBoard.tsx`, after the imports (after line 16) and before `export function PipelineBoard`, add:

```tsx
const WINDOWS: Array<{ label: string; days: number | null }> = [
  { label: "All", days: null },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];
```

- [ ] **Step 2: Add the window state**

In `PipelineBoard`, add this hook alongside the others (after `const [loaded, setLoaded] = ...` on line 35, before `const [pending, startTransition] = useTransition();`):

```tsx
  const [windowDays, setWindowDays] = useState<number | null>(null);
```

(Unconditional, before the `if (visible.length === 0) return ...` early return — keep it with the other `useState` calls.)

- [ ] **Step 3: Render the window control in the top-row left group**

In the left-group `<div className="flex items-center gap-2">` (lines 85-101), after the tabs `{visible.length > 1 ? ... : null}` block and before the `</div>` that closes the left group, add the control:

```tsx
          <div
            role="group"
            aria-label="Filter by stage entry date"
            className="flex items-center gap-0.5 rounded-[10px] border border-ink/10 bg-white p-[3px]"
          >
            {WINDOWS.map((w) => {
              const on = windowDays === w.days;
              return (
                <button
                  key={w.label}
                  onClick={() => setWindowDays(w.days)}
                  aria-pressed={on}
                  className={`cursor-pointer rounded-[7px] px-[11px] py-1.5 font-mono text-xs transition-colors ${
                    on ? "bg-ink text-white" : "text-muted hover:bg-lavender"
                  }`}
                >
                  {w.label}
                </button>
              );
            })}
          </div>
```

- [ ] **Step 4: Pass `windowDays` to each StageColumn**

In the `stages.map((stage, i) => ( <StageColumn ... /> ))` block (lines 127-133), add the `windowDays` prop. The `<StageColumn>` becomes:

```tsx
            <StageColumn
              key={`${active?.id ?? ""}:${stage.id}:${mapVersion}`}
              stage={stage}
              index={i}
              initial={active ? map[stageKey(active.id, stage.id)] : undefined}
              windowDays={windowDays}
            />
```

(Do NOT add `windowDays` to the `key` — changing the window must re-render, not remount.)

- [ ] **Step 5: Type-check + lint + build**

Run: `npx tsc --noEmit` → PASS.
Run: `npm run lint` → no new errors/warnings.
Run: `npm run build` → succeeds, `/dashboard/trends` compiles.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/pipeline/PipelineBoard.tsx
git commit -m "feat(pipeline): add recency window control to the board

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Whole-feature verification

**Files:** none (verification only)

- [ ] **Step 1: Self-test**

Run: `npm run test:pipeline`
Expected: `pipeline-board-selftest: OK`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors (no new warnings introduced by this feature).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds; `/dashboard/trends` compiles.

- [ ] **Step 5: Manual smoke (recommended)**

`npm run dev` → sign in → `/dashboard/trends`. Confirm:
  - Default shows the **All** window selected and the board looks exactly as before (no sub-lines, all cards).
  - Selecting **30d** filters each column to cards whose "in stage since" is ≤ 30 days; the badge count is unchanged; a "*X in last 30d*" sub-line appears under each header.
  - A column with recent + old cards shows only the recent ones; a column with none recent shows "No movement in last 30d".
  - "Load more" still loads the next page (and the filter re-applies); switching back to **All** restores everything.

- [ ] **Step 6: Commit any fixes**

If Steps 1-4 required changes, commit them:

```bash
git add -A
git commit -m "fix(pipeline): resolve verification findings for the recency filter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(If nothing changed, skip.)
