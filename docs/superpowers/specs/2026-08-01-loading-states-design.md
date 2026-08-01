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

### Files added

**`lib/pending-phase.ts`** — the phase timeline as a pure, React-free module: the `PendingPhase`
type, the three timing constants, `phaseFor(elapsedMs)`, and `nextPhaseChangeMs(elapsedMs)`.
Kept out of the component so the selftest can import it in plain node, matching how
`lib/usage.ts` is tested by `scripts/usage-selftest.ts`. `nextPhaseChangeMs` also lets the
provider schedule exactly one timer per phase instead of polling on an interval.

**`components/ui/states/`** — alongside the existing `Skeleton.tsx` / `EmptyState.tsx` /
`ErrorState.tsx`.

- **`PendingNav.tsx`** — the provider plus `useNavigate()`, `usePendingPhase()`, and `NavLink`.
  Internally splits `navigate` (stable) and `phase` (changing) into two contexts, so a control
  that only *triggers* navigation does not re-render when the phase flips.
- **`NavPendingDot.tsx`** — `useLinkStatus()` dot; must render as a `<Link>` descendant.
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
| `components/console/UsageView.tsx` | period picker `<a href>` → `NavLink`; `ExportLink` → fetch-to-blob button — both extracted into `components/console/UsageControls.tsx` (see below) |
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

**Two of the twelve need a different shape.** `WorkspaceSwitcher` has no submit button at all — it
submits via `requestSubmit()` on a `<select>` change — so it gets a `useFormStatus` child that
disables the select rather than a `SubmitButton`. The two icon-only sign-out buttons have no room
for a label, so their pending state is the disabled look plus a tooltip.

**All eight console view files are server components.** That is fine and must stay that way: a
server component may *render* a client component like `SubmitButton`, it just cannot call hooks
itself. Any change that flips one of these files to `"use client"` is a mistake — see the
`UsageView` note below for what that costs.

### Console skeletons

Six `loading.tsx` files over **five** new `SkeletonVariant`s:

| Variant | Routes | Shape |
|---|---|---|
| `console` | `/console` | 1100px, hero, stat grid, rows |
| `console-detail` | `/console/clients/[id]` | 1000px, back-link, hero, stats, cards |
| `console-plain` | `/console/team`, `/console/invites` | 1000px, **no hero**, stat/form band, rows |
| `console-table` | `/console/clients` | 1000px, head + sync button, table rows |
| `console-usage` | `/console/usage` | period picker + range form, tiles, two tables |

**This started as three variants and was wrong.** The first draft assumed the console views shared
one shape — heading, then a hero, then rows — and reused a single `console` variant across four
routes. They don't share it: `TeamView.tsx:20` and `InvitesView.tsx:23` have **no hero**, and three
of the four are `max-w-[1000px]` against the variant's `1100px`. That skeleton would have dropped
~208px vertically and reflowed 100px sideways the instant real content landed — the precise defect
this whole feature exists to remove. Caught in review, confirmed against the view files, split by
ruling. A skeleton that lies about the shape of what's coming is worse than no skeleton.

## Deliberate behavior changes

Two changes go slightly beyond "add loading feedback". Both were raised and approved:

1. **`ExportLink` becomes a button that fetches to a blob.** As a plain `<a>` to a streaming
   route handler, no router transition ever fires, so no pending state is observable. Buffering
   is acceptable because a usage CSV is one month of rows. The existing comment explaining the
   anchor choice gets rewritten, not silently contradicted.
2. **The usage period picker becomes a `NavLink`.** It is currently a plain `<a href>`, so
   switching months triggers a **full page reload** — white flash, whole app re-downloaded.
   A plain `<Link>` would fix the reload but earn no feedback: switching month is a *same-segment*
   param change, so `loading.tsx` never fires for it and Next's internal navigation never touches
   our transition. `NavLink` renders a real anchor (middle-click and open-in-new-tab keep working)
   but routes unmodified left-clicks through `navigate()`, so it behaves exactly like the Header's
   range pills — which are the same kind of control.

   **`UsageView` must stay a server component while this happens.** `app/console/usage/page.tsx`
   passes it `exportHref` and `monthHref` as *functions*, which is only legal server-to-server —
   functions cannot be serialized to a client component. Putting `useState` in `UsageView` would
   force it client-side and break that prop contract, cascading into a page rewrite. Both controls
   are therefore extracted into `components/console/UsageControls.tsx` as small client islands
   taking plain string props; the table stays server-rendered and the page is untouched.

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
