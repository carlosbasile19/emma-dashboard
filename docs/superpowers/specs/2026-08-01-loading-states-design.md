# Loading & pending feedback — Design

**Date:** 2026-08-01
**Status:** Approved design → ready for implementation plan
**Scope:** all of `/dashboard/*` and `/console/*`

## Summary

Give every wait in the app a visible, honest signal. Today a full route navigation shows a
skeleton, but **every other kind of wait is silent**: changing a filter leaves stale numbers on
screen with no indication they're being replaced, the entire agency console renders nothing
until its data lands, and twelve server-action forms submit with no busy state at all.

Four kinds of wait, four mechanisms:

| Wait | Mechanism |
|---|---|
| Programmatic navigation (filters, search, paging) | Shared pending context → dim + top bar |
| Route-segment load | `loading.tsx` + `Skeleton` (extend to `/console`) |
| Server-action form submit | Shared `<SubmitButton>` using `useFormStatus()` |
| File download (CSV export) | `fetch` → blob, with real pending state |

## Why this shape (the binding constraints)

- **`loading.tsx` does not fire on search-param changes.** It maps to a Suspense boundary for
  the *route segment*. `router.replace()` to the same pathname with different params re-renders
  on the server, but React keeps the existing UI mounted through the transition. Nothing in the
  framework surfaces that wait — it has to be built.
- **The producer and the consumer are in different subtrees.** `Header` (`app/dashboard/layout.tsx:42`)
  writes the filter; the content that goes stale is `<main>{children}</main>` at line 50. A local
  `useTransition` in `Header` could only dim `Header`. Shared state across the layout is therefore
  not a stylistic choice — it is the minimum that delivers the behavior.
- **The upstream is slow and flaps.** See `olivia-analytics-outage-2026-07` and
  `lib/olivia/fallback.ts`. Waits here are not uniformly ~200ms; some run into tens of seconds
  or never resolve. A binary loading/not-loading signal is insufficient — the UI has to
  distinguish "working" from "this is taking unusually long" from "this may be stuck".
- **Stale-but-labelled beats blank.** Replacing loaded numbers with a skeleton on every filter
  tap flickers and loses the user's place. Dimming keeps context and avoids layout jump, at the
  cost of briefly showing superseded values — acceptable *only because* they are visibly
  de-emphasised and non-interactive.
- **Existing primitives are reused, not replaced.** `components/ui/states/Skeleton.tsx` already
  has eight variants and a `shimmer` class (`app/globals.css:149`). Console skeletons extend
  that switch rather than introducing a second skeleton system.

## Verified platform facts

Checked against installed packages, not assumed:

- `next@15.5.9` exports `useLinkStatus` from `next/link`, returning `{ pending: boolean }`
  (`node_modules/next/dist/client/app-dir/link.d.ts:188`). It is only valid inside a `<Link>`
  descendant.
- `react@19.1.1`; `@types/react` types `inert` as `boolean | undefined`
  (`index.d.ts:2854`), so `<div inert={pending}>` is a native prop, not an escape hatch.
- `useFormStatus` (from `react-dom`) is stable in React 19 and must be called from a component
  rendered **inside** the `<form>`.

## Behavior

### The phase timeline

One derived state drives every navigation signal:

| Phase | Window | UI |
|---|---|---|
| `idle` | not pending | nothing |
| `active` | 150 ms – 8 s | top progress bar + content dimmed to 50%, `inert` |
| `slow` | 8 s – 25 s | + inline note: "Still fetching — the data service is slow right now" |
| `stuck` | 25 s+ | + **Retry** button (`router.refresh()` inside the same transition) |

**The 150 ms grace period is load-bearing.** Without it, every fast or cached filter change
flashes a dim-and-restore, which reads as jank rather than as feedback. Below 150 ms the UI
never leaves `idle`.

### Per-surface behavior

- **Filters, search, paging** (`Header`, `LeadsTable`): stale content dims and stops accepting
  input; the bar runs; values are replaced in place with no layout shift.
- **Sidebar navigation:** the clicked item shows a pending dot immediately via `useLinkStatus`,
  before the server has responded. Content is then handled by the route's `loading.tsx`.
  The top bar and the dim do **not** engage for sidebar navigation — the skeleton already
  replaces the whole view, and stacking a bar and a dim on top of it would be three signals for
  one wait. `useLinkStatus` stays local to the link; it does not feed the shared phase.
- **The filter controls stay live while pending.** `PendingContent` wraps `{children}` only, so
  `Header` is never dimmed or made `inert`. Changing your mind mid-load (tapping 90d while 7d is
  still resolving) must always be possible.
- **Console routes:** each of the six gets a skeleton matched to its layout.
- **Server-action forms:** the submit control disables and swaps its label while in flight.
- **CSV export:** the button shows a busy state for the real duration of the fetch.

## Architecture

### Files added — `components/ui/states/`

Alongside the existing `Skeleton.tsx` / `EmptyState.tsx` / `ErrorState.tsx`.

- **`PendingNav.tsx`** — the provider plus `useNavigate()` and `usePendingPhase()`. All four
  timing constants live at the top of this file and nowhere else. Internally splits `navigate`
  (stable) and `phase` (changing) into two contexts, so a control that only *triggers*
  navigation does not re-render when the phase flips.
- **`RouteProgress.tsx`** — 2px indeterminate bar in `--gradient-brand`, `fixed` at
  `z-50` (the sticky header is `z-20`). Renders when phase ≠ `idle`.
- **`PendingContent.tsx`** — wraps `{children}`; applies `opacity-50` + `inert` when
  phase ≠ `idle`. `inert` (not `pointer-events-none`) so stale content also leaves the tab order
  and the accessibility tree.
- **`SlowNotice.tsx`** — escalation copy in an `aria-live="polite"` region; Retry renders only
  at `stuck`.
- **`SubmitButton.tsx`** — `useFormStatus()`-driven submit control for server-action forms.

### Mount points

`PendingNavProvider` wraps the Header + `<main>` column in `app/dashboard/layout.tsx`, and
`<main>` in `app/console/layout.tsx`. The sidebars stay outside — their links use
`useLinkStatus`, which needs no shared state.

### Call sites converted

| File | Change |
|---|---|
| `components/dashboard/Header.tsx` | range + campaign `router.replace` → `navigate(…)` |
| `components/dashboard/leads/LeadsTable.tsx` | the `router.replace` inside `setParam` → `navigate(…)`; row-click `router.push` → `navigate(…)` |
| `components/dashboard/Sidebar.tsx` | pending dot via `useLinkStatus` |
| `components/console/ConsoleSidebar.tsx` | pending dot via `useLinkStatus` |
| `components/console/UsageView.tsx` | period picker `<a href>` → `<Link>`; `ExportLink` → fetch-to-blob button |
| 12 server-action forms (below) | submit control → `<SubmitButton>` |

**The twelve forms without busy state.** Of 16 `<form>` elements, only `LoginForm` (2, via
`useTransition`) and `AcceptInvite` (1, via `useActionState`) currently show pending. The rest:

- `signOut` — `app/dashboard/layout.tsx:70`, `Sidebar.tsx:82`, `ConsoleSidebar.tsx:97`
- `setActiveClient` — `WorkspaceSwitcher.tsx:16`, `ClientDetailView.tsx:45`, `ClientsTable.tsx:130`
- `syncClients` — `ClientsTable.tsx:23`
- `createInvite` — `InvitesView.tsx:33`, `ClientDetailView.tsx:106`
- `createTeamInvite` — `TeamView.tsx:36`
- `revokeInvite` — `InvitesView.tsx:109`, `TeamView.tsx:87`

`syncClients` and `setActiveClient` are the worst offenders: both hit the Olivia API and both
currently look like dead buttons.

### Console skeletons

Six `loading.tsx` files. The console views share one shape — heading + subtitle, then a hero or
stat band, then rows — so this is **three** new `SkeletonVariant`s, not six:

| Variant | Routes |
|---|---|
| `console` | `/console`, `/console/team`, `/console/invites`, `/console/clients/[id]` |
| `console-table` | `/console/clients` |
| `console-usage` | `/console/usage` (period picker + tiles + two tables) |

## Deliberate behavior changes

Two changes go slightly beyond "add loading feedback". Both were raised and approved:

1. **`ExportLink` becomes a button that fetches to a blob.** As a plain `<a>` to a streaming
   route handler, no router transition ever fires, so no pending state is observable. Buffering
   is acceptable because a usage CSV is one month of rows. The existing comment explaining the
   anchor choice gets rewritten, not silently contradicted.
2. **The usage period picker becomes a `<Link>`.** It is currently a plain `<a href>`, so
   switching months triggers a **full page reload** — white flash, whole app re-downloaded. As a
   soft navigation it inherits the bar and dim for free.

## Error handling

- Failures are still owned by the existing error boundaries (`app/dashboard/error.tsx`,
  `app/error.tsx`) and `ErrorState.tsx`. This work adds no new error surface.
- `stuck` is explicitly **not** an error state: the request may still succeed. Retry is offered;
  nothing is claimed about failure.
- If a transition is superseded (user taps 7d then 90d), the phase timer restarts from the
  latest navigation — the notice must not inherit elapsed time from an abandoned one.
- `router.refresh()` from Retry runs inside the same transition, so a failed retry re-enters the
  same timeline rather than stacking a second indicator.

## Accessibility & motion

- `prefers-reduced-motion`: the opacity change and all static styling stay; the bar's sweep and
  the shimmer animation stop. Feedback must not depend on animation.
- `SlowNotice` is `aria-live="polite"` — the escalation is announced, not only shown.
- `inert` on dimmed content removes it from the tab order, so keyboard focus cannot land on
  values that are about to be replaced.
- The progress bar is decorative (`aria-hidden`); `SlowNotice` carries the announcement.

## Testing

Following the repo convention (`scripts/*-selftest.ts`, `npm run test:*`):

**`scripts/loading-states-selftest.ts`** — `npm run test:loading`. The phase timeline is the
only real logic here and is a pure function of `(pending, elapsedMs)`:

- sub-150 ms pending never leaves `idle` (the anti-flicker guarantee)
- crosses to `active` at 150 ms, `slow` at 8 s, `stuck` at 25 s
- returning to not-pending resets to `idle` from every phase
- a superseded navigation restarts elapsed time rather than inheriting it

**Manual pass** (the visual layer can't be asserted in a node script) — the plan will enumerate:
each of the 6 console routes cold, filter changes on Overview and Leads, leads search + paging,
a `syncClients` submit, and a CSV export.

## Risks

- **`LeadsTable.setParam` composition.** It keeps a `pendingSearchRef` so racing writes merge
  instead of clobbering, cleared when `useSearchParams()` commits
  (`LeadsTable.tsx:57-79`). Wrapping the `replace` in a transition *lengthens* the pending
  window — which the existing comment states is the intent ("holds the ref across the whole
  pending window"). That is reasoning, not evidence, and this code exists to fix a real bug.
  **The plan must verify it explicitly**, including the documented race: change Status
  mid-typing, and change Status while a search commit is in flight.
- **Dimmed content is superseded content.** Mitigated by opacity + `inert`, but a user who
  screenshots mid-transition captures stale numbers. Accepted; the alternative (skeleton swap)
  was considered and rejected for flicker.
- **Two providers, one behavior.** Dashboard and console mount separately. Timing constants live
  in one module so they cannot drift.

## Out of scope

- **Per-widget streaming** (independent `<Suspense>` per card so fast tiles land before slow
  charts). Considered as Option 3 and deferred: it requires reworking data fetching in every
  page and touching `lib/olivia/service.ts`. This design is the prerequisite for it, not a
  competitor to it.
- Changes to caching, prefetching, or the Olivia fetch layer. Nothing here makes the app
  faster — only more legible while it waits.
