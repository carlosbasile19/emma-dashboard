# Pipeline board recency filter — Design

**Date:** 2026-06-25
**Status:** Approved design → ready for implementation plan
**Builds on:** `docs/superpowers/specs/2026-06-25-pipeline-board-design.md` (the read-only board)
**Route:** `/dashboard/trends` ("Pipeline")

## Summary

Add a board-level **recency filter** to the read-only pipeline board: a window control
(**All · 7d · 30d · 90d**) that filters each column's cards to leads that **entered their
stage** within the window (`stage_entered_at`). Purely client-side, additive, and honest
about the board's constraints — no API, data-layer, server-action, or type changes.

## Why this shape (the binding constraints)

- The card source `/leads?stage_id=` is **window-exempt**: it returns the *current
  occupants* of a stage and ignores `from`/`to`. So a date filter cannot be a server-side
  query for stage-scoped cards — it must be a client-side filter on already-loaded cards.
- The column badge MUST remain `stage.lead_count` (the live authoritative total). The
  filter never changes the badge.
- Columns lazy-load 50 cards/page. The filter runs on **loaded** cards (chosen approach):
  on a column with more occupants than loaded, in-window leads beyond the loaded pages
  appear only after "Load more". This partial-until-loaded behavior is intentional and
  surfaced in the UI.

## Behavior

- **Window control** in `PipelineBoard`'s top row (left group, beside the tabs), styled
  like the former Header range control: `All · 7d · 30d · 90d`. **Default = All** (no
  filtering — the board behaves exactly as today until a window is chosen).
- Choosing a window filters every column's loaded cards to those whose `stage_entered_at`
  is within the window. Pure render-time derivation; **no refetch, no remount** (the
  column key deliberately excludes the window, so loaded items + Load-more state survive a
  window change).
- **Badge unchanged** = `stage.lead_count`. When a window is active, a thin sub-line under
  each column header shows the in-window count among loaded cards: **"3 in last 30d"**.
  No sub-line when window = All.
- **"Load more" unchanged** — still pages the full (unfiltered) column; the filter
  re-applies to the enlarged set.
- **Empty states** (when not in an error state):
  - `items.length === 0` (truly empty column) → "No leads" (existing).
  - window active and `items.length > 0` but no loaded card matches → "No movement in
    last {N}d".
- **Null/invalid `stage_entered_at`** → excluded when a window is active (a lead with no
  entry date can't be "entered in the last N days").

## No hydration concern

The window default is `null` (no filter), so the initial server render and client
hydration both render the unfiltered list — identical. The filter only activates on a
post-hydration user click (client-only re-render). No SSR/hydration mismatch is introduced.

## Components & data flow

### `lib/pipeline/board.ts` — add one pure, tested helper
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
No new imports; pure; safe in client/server/tsx. TDD via `scripts/pipeline-board-selftest.ts`.

### `components/dashboard/pipeline/PipelineBoard.tsx`
- `const [windowDays, setWindowDays] = useState<number | null>(null);` (alongside the
  existing hooks; unconditional, before the early return).
- A `WINDOWS` constant `[{label:"All",days:null},{label:"7d",days:7},{label:"30d",days:30},
  {label:"90d",days:90}]`.
- Render the window control in the left group of the top row (a `role="group"`
  `aria-label="Filter by stage entry date"` button set; `aria-pressed` on the active
  button), matching the tab/range button styling.
- Pass `windowDays={windowDays}` to each `StageColumn`.

### `components/dashboard/pipeline/StageColumn.tsx`
- Add `windowDays: number | null` to props.
- Import `isWithinWindow` from `@/lib/pipeline/board`.
- `const visible = windowDays ? items.filter((l) => isWithinWindow(l.stage_entered_at, windowDays)) : items;`
- Render `visible.map(...)` (instead of `items.map(...)`).
- After `</header>`: when `windowDays` is set, render the sub-line
  `{num(visible.length)} in last {windowDays}d`.
- Empty-hint logic updated to the two cases above ("No leads" vs "No movement in last
  {N}d").
- Badge, section `aria-label`, accent/won/lost/archived styling, `hasMore`, and
  "Load more" stay exactly as they are (the filter is display-only; pagination is driven
  by the unfiltered `res.total`).

## What it does NOT touch

`lib/olivia/*` (client/service/actions/cache), `lib/types.ts`, `lib/copy.ts`, the Header,
the page, the prefetch/actions. No `/leads` date params. No URL/searchParam persistence —
the window lives in client state (resets on full reload; survives Refresh since
`refreshBoard` swaps data into the existing component without remounting). URL persistence
is a deliberate non-goal for now.

## Files touched (summary)

- `lib/pipeline/board.ts` — add `isWithinWindow`.
- `scripts/pipeline-board-selftest.ts` — add `isWithinWindow` assertions (TDD: RED→GREEN).
- `components/dashboard/pipeline/PipelineBoard.tsx` — window state + control + prop.
- `components/dashboard/pipeline/StageColumn.tsx` — `windowDays` prop, filter, sub-line,
  empty hint.

## Verification

- `npm run test:pipeline` — `isWithinWindow` covered (null/invalid → false; in/out of
  7d/30d/90d via a fixed `now`).
- `npx tsc --noEmit`, `npm run lint`, `npm run build` clean.
- Manual smoke: pick 30d → cards filter to recent entrants, badge stays the live total, the
  "X in last 30d" sub-line appears, Load more still pages the full column, "All" restores
  everything.

## Out of scope (YAGNI)

URL/shareable window state; complete (auto-load-all) filtering of deep columns; sort/dim
"emphasis" mode; filtering by `created_at`; changing the badge to a windowed count.
