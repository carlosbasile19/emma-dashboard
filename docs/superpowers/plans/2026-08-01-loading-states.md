# Loading & Pending Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every wait in the app a visible, honest signal — filter changes, console page loads, form submits, and CSV exports.

**Architecture:** A single shared `useTransition` per layout drives a four-phase timeline (`idle` → `active` → `slow` → `stuck`) derived by a pure, separately-tested module. Content that is being replaced dims and goes `inert`; a top bar runs; at 8s a notice appears and at 25s a Retry. Route-segment loads keep using `loading.tsx` + the existing `Skeleton`, now extended to `/console`. Form submits and the CSV download get their own local pending states.

**Tech Stack:** Next.js 15.5.9 (App Router), React 19.1.1, Tailwind CSS v4, TypeScript 5.7. Tests are plain-node `scripts/*-selftest.ts` using `node:assert/strict`, run via `npm run test:*`.

**Spec:** `docs/superpowers/specs/2026-08-01-loading-states-design.md`

## Global Constraints

- **Timing constants are defined once**, in `lib/pending-phase.ts`. No other file may hardcode 150 / 8000 / 25000.
- **Grace period is 150ms.** A navigation resolving faster than this must never leave `idle` — no flash.
- **Phases:** `idle` (not pending, or <150ms) · `active` (150ms–8s) · `slow` (8s–25s) · `stuck` (25s+).
- **User-facing copy says "Emma", never "Olivia".** `Olivia` stays in internal identifiers, module paths, and comments only.
- **`inert`, not `pointer-events-none`,** for dimmed content — it must leave the tab order and the accessibility tree too.
- **`SlowNotice` must render OUTSIDE the `inert` wrapper.** Inside it, the Retry button is unclickable and invisible to screen readers. This is the single easiest way to ship this feature broken.
- **The Header/filter controls are never dimmed.** Only `{children}` is wrapped. Changing your mind mid-load must always work.
- **`useLinkStatus` must be called from a `<Link>` descendant**, never from the `<Link>` itself or a sibling.
- **`useFormStatus` must be called from a component rendered inside the `<form>`**, never from the component that renders the `<form>`.
- **Verification before completion:** every task's test step requires running the command and reading the output. Do not mark a step done on the assumption it passes.

---

### Task 1: Phase timeline (pure logic + selftest)

The only real logic in this feature. Pure, React-free, fully tested. Everything else is wiring.

**Files:**
- Create: `lib/pending-phase.ts`
- Create: `scripts/loading-states-selftest.ts`
- Modify: `package.json` (add `test:loading` script)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type PendingPhase = "idle" | "active" | "slow" | "stuck"`
  - `GRACE_MS: 150`, `SLOW_MS: 8000`, `STUCK_MS: 25000`
  - `phaseFor(elapsedMs: number | null): PendingPhase`
  - `nextPhaseChangeMs(elapsedMs: number | null): number | null`

- [ ] **Step 1: Write the failing test**

Create `scripts/loading-states-selftest.ts`:

```ts
import assert from "node:assert/strict";
import {
  GRACE_MS,
  SLOW_MS,
  STUCK_MS,
  nextPhaseChangeMs,
  phaseFor,
} from "../lib/pending-phase";

// The anti-flicker guarantee. A navigation that resolves faster than the grace period must
// never produce a visible state — otherwise every cached filter change flashes dim-and-restore,
// which reads as jank rather than as feedback.
(() => {
  assert.equal(phaseFor(null), "idle", "not pending is idle");
  assert.equal(phaseFor(0), "idle", "a just-started navigation is still idle");
  assert.equal(phaseFor(GRACE_MS - 1), "idle", "under the grace period stays idle");
  console.log("  ✓ grace period");
})();

// Boundaries are inclusive at the lower edge: at exactly GRACE_MS we are active.
(() => {
  assert.equal(phaseFor(GRACE_MS), "active");
  assert.equal(phaseFor(SLOW_MS - 1), "active");
  assert.equal(phaseFor(SLOW_MS), "slow");
  assert.equal(phaseFor(STUCK_MS - 1), "slow");
  assert.equal(phaseFor(STUCK_MS), "stuck");
  assert.equal(phaseFor(STUCK_MS * 10), "stuck", "stuck is terminal, never wraps");
  console.log("  ✓ phase boundaries");
})();

// The provider schedules ONE timer per phase off this, rather than polling. A wrong value here
// means the notice appears late or never.
(() => {
  assert.equal(nextPhaseChangeMs(null), null, "nothing pending, nothing to schedule");
  assert.equal(nextPhaseChangeMs(0), GRACE_MS);
  assert.equal(nextPhaseChangeMs(GRACE_MS), SLOW_MS - GRACE_MS);
  assert.equal(nextPhaseChangeMs(SLOW_MS), STUCK_MS - SLOW_MS);
  assert.equal(nextPhaseChangeMs(STUCK_MS), null, "stuck is terminal — stop scheduling");
  assert.equal(nextPhaseChangeMs(STUCK_MS + 5_000), null);
  console.log("  ✓ timer scheduling");
})();

// Superseded navigation: tapping 7d then 90d restarts elapsed time. The 90d wait must not
// inherit the 7d wait's age and jump straight to "slow".
(() => {
  const firstStartedAt = 1_000_000;
  const supersededAt = firstStartedAt + SLOW_MS + 500; // first nav was already "slow"
  const now = supersededAt + 10;

  assert.equal(phaseFor(now - firstStartedAt), "slow", "the abandoned nav had aged into slow");
  assert.equal(
    phaseFor(now - supersededAt),
    "idle",
    "the new nav restarts from zero and re-enters the grace period",
  );
  console.log("  ✓ superseded navigation restarts elapsed time");
})();

// Clearing pending returns to idle unconditionally. phaseFor is pure, so "which phase we were
// in" is not state it holds — what this pins is the contract the provider relies on: a null
// elapsed is idle no matter what, and idle-ness otherwise depends on nothing but the grace
// boundary.
(() => {
  assert.equal(phaseFor(null), "idle");
  for (const elapsed of [0, GRACE_MS, SLOW_MS, STUCK_MS, STUCK_MS * 4]) {
    assert.equal(
      phaseFor(elapsed) === "idle",
      elapsed < GRACE_MS,
      `elapsed=${elapsed}: idle-ness must depend only on the grace boundary`,
    );
  }
  console.log("  ✓ null elapsed is always idle");
})();

console.log("loading-states-selftest: all assertions passed");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx scripts/loading-states-selftest.ts
```

Expected: FAIL — `Cannot find module '../lib/pending-phase'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/pending-phase.ts`:

```ts
/**
 * The pending-navigation timeline, as a pure function of elapsed time.
 *
 * Kept React-free and out of the component so it can be tested in plain node
 * (`scripts/loading-states-selftest.ts`), the same way `lib/usage.ts` is. These are the ONLY
 * definitions of these timings — no other file may hardcode them.
 */

export type PendingPhase = "idle" | "active" | "slow" | "stuck";

/**
 * Below this, a navigation produces no visible state at all. Without it every fast or cached
 * filter change flashes a dim-and-restore, which reads as jank rather than as feedback.
 */
export const GRACE_MS = 150;

/** Past this the wait is abnormal — say so, because the upstream is known to flap. */
export const SLOW_MS = 8_000;

/** Past this it may never resolve — offer a way out. Still not an error: it may yet succeed. */
export const STUCK_MS = 25_000;

/** `null` elapsed means "nothing pending". */
export function phaseFor(elapsedMs: number | null): PendingPhase {
  if (elapsedMs === null) return "idle";
  if (elapsedMs < GRACE_MS) return "idle";
  if (elapsedMs < SLOW_MS) return "active";
  if (elapsedMs < STUCK_MS) return "slow";
  return "stuck";
}

/**
 * Milliseconds until the phase would next change, or `null` if it never will again (not
 * pending, or already terminal). Lets the provider set exactly one timer per phase instead of
 * polling on an interval.
 */
export function nextPhaseChangeMs(elapsedMs: number | null): number | null {
  if (elapsedMs === null) return null;
  if (elapsedMs < GRACE_MS) return GRACE_MS - elapsedMs;
  if (elapsedMs < SLOW_MS) return SLOW_MS - elapsedMs;
  if (elapsedMs < STUCK_MS) return STUCK_MS - elapsedMs;
  return null;
}
```

- [ ] **Step 4: Add the npm script**

In `package.json`, add to `"scripts"` immediately after the `"test:usage"` line:

```json
    "test:loading": "tsx scripts/loading-states-selftest.ts"
```

Remember the comma on the preceding line.

- [ ] **Step 5: Run test to verify it passes**

```bash
npm run test:loading
```

Expected: PASS, ending with `loading-states-selftest: all assertions passed`.

- [ ] **Step 6: Commit**

```bash
git add lib/pending-phase.ts scripts/loading-states-selftest.ts package.json
git commit -m "feat(loading): pure phase timeline for pending navigation"
```

---

### Task 2: Provider and visual primitives

**Files:**
- Create: `components/ui/states/PendingNav.tsx`
- Create: `components/ui/states/RouteProgress.tsx`
- Create: `components/ui/states/SlowNotice.tsx`
- Create: `components/ui/states/PendingContent.tsx`
- Modify: `app/globals.css` (append the sweep keyframes + reduced-motion block)

**Interfaces:**
- Consumes: `phaseFor`, `nextPhaseChangeMs`, `PendingPhase` from `lib/pending-phase.ts` (Task 1).
- Produces:
  - `<PendingNavProvider>{children}</PendingNavProvider>`
  - `useNavigate(): (fn: () => void) => void`
  - `usePendingPhase(): PendingPhase`
  - `<NavLink href={string} className={string} aria-current={...}>{children}</NavLink>`
  - `<RouteProgress />`
  - `<PendingContent>{children}</PendingContent>`

- [ ] **Step 1: Create the provider**

Create `components/ui/states/PendingNav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { nextPhaseChangeMs, phaseFor, type PendingPhase } from "@/lib/pending-phase";

/**
 * Shared pending-navigation state.
 *
 * Why this exists at all: `loading.tsx` maps to a Suspense boundary for the route *segment*, so
 * it does not fire when only search params change. `router.replace()` to the same pathname
 * re-renders on the server while React keeps the current UI mounted — a wait the framework
 * surfaces nowhere. And the control that starts that wait (Header) lives in a different subtree
 * from the content that goes stale (`<main>`), so a local `useTransition` could only dim the
 * Header. Hence one transition, shared across the layout.
 *
 * Two contexts, not one: `navigate` is stable for the provider's lifetime while `phase` changes
 * several times per navigation. Splitting them keeps filter buttons — which only ever *trigger*
 * navigation — from re-rendering on every phase flip.
 */
const NavigateCtx = createContext<((fn: () => void) => void) | null>(null);
const PhaseCtx = createContext<PendingPhase>("idle");

export function PendingNavProvider({ children }: { children: ReactNode }) {
  const [pending, startTransition] = useTransition();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [phase, setPhase] = useState<PendingPhase>("idle");

  const navigate = useCallback((fn: () => void) => {
    // Stamped on every call, so a superseded navigation (tap 7d, then 90d) restarts elapsed
    // time instead of inheriting the abandoned one's age and jumping straight to "slow".
    setStartedAt(Date.now());
    startTransition(fn);
  }, []);

  useEffect(() => {
    if (!pending || startedAt === null) {
      setPhase("idle");
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      setPhase(phaseFor(elapsed));
      const next = nextPhaseChangeMs(elapsed);
      if (next !== null) timer = setTimeout(tick, next);
    };
    tick();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [pending, startedAt]);

  return (
    <NavigateCtx.Provider value={navigate}>
      <PhaseCtx.Provider value={phase}>{children}</PhaseCtx.Provider>
    </NavigateCtx.Provider>
  );
}

/** Wrap a router call so the whole layout can reflect the wait. No-ops outside the provider. */
export function useNavigate(): (fn: () => void) => void {
  const ctx = useContext(NavigateCtx);
  return ctx ?? ((fn: () => void) => fn());
}

export function usePendingPhase(): PendingPhase {
  return useContext(PhaseCtx);
}

/**
 * A same-segment link (e.g. the usage month picker) that earns the shared pending treatment.
 *
 * Stays a real anchor so middle-click and open-in-new-tab keep working — those never fire
 * `onClick`, and modified left-clicks are handed back to the browser untouched. Only a plain
 * left-click is intercepted and routed through the transition.
 *
 * For links that change route segment (the sidebars), use a plain `<Link>` with
 * `<NavPendingDot />` instead — `loading.tsx` already covers those.
 */
export function NavLink({
  href,
  children,
  ...rest
}: { href: string; children: ReactNode } & Omit<
  React.ComponentPropsWithoutRef<typeof Link>,
  "href" | "onClick"
>) {
  const router = useRouter();
  const navigate = useNavigate();
  return (
    <Link
      href={href}
      {...rest}
      onClick={(e) => {
        if (e.defaultPrevented) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(() => router.push(href));
      }}
    >
      {children}
    </Link>
  );
}
```

- [ ] **Step 2: Create the progress bar**

Create `components/ui/states/RouteProgress.tsx`:

```tsx
"use client";

import { usePendingPhase } from "@/components/ui/states/PendingNav";

/**
 * Indeterminate top bar. Decorative only — `SlowNotice` carries the announcement, so a screen
 * reader is not told "loading" twice. Sits above the sticky header (which is z-20).
 */
export function RouteProgress() {
  const phase = usePendingPhase();
  if (phase === "idle") return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[2px] overflow-hidden bg-lavender"
    >
      <div className="route-progress-sweep bg-gradient-brand h-full w-2/5" />
    </div>
  );
}
```

- [ ] **Step 3: Create the escalation notice**

Create `components/ui/states/SlowNotice.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useNavigate } from "@/components/ui/states/PendingNav";
import type { PendingPhase } from "@/lib/pending-phase";

/**
 * Shown once a wait is abnormal. Deliberately NOT an error state: the request may still
 * succeed, so this claims nothing about failure — it explains, and at `stuck` offers a way out.
 *
 * MUST be rendered outside the `inert` wrapper in PendingContent, or Retry is unclickable.
 */
export function SlowNotice({ phase }: { phase: PendingPhase }) {
  const router = useRouter();
  const navigate = useNavigate();
  if (phase !== "slow" && phase !== "stuck") return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-4 flex flex-wrap items-center gap-3 rounded-[13px] border border-ink/10 bg-white px-4 py-3 shadow-sm"
    >
      <span className="text-[13px] text-muted">
        Still fetching — the data service is slow right now.
      </span>
      {phase === "stuck" ? (
        <button
          type="button"
          onClick={() => navigate(() => router.refresh())}
          className="cursor-pointer rounded-[9px] border border-ink/10 bg-white px-3 py-[6px] font-display text-[12.5px] font-medium text-ink transition-colors hover:bg-lavender"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Create the dimming wrapper**

Create `components/ui/states/PendingContent.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { usePendingPhase } from "@/components/ui/states/PendingNav";
import { SlowNotice } from "@/components/ui/states/SlowNotice";

/**
 * Dims content that is being replaced.
 *
 * `inert` rather than `pointer-events-none`: superseded values must also leave the tab order and
 * the accessibility tree, so keyboard focus can't land on a number that's about to change.
 *
 * SlowNotice is deliberately a SIBLING of the inert element, never a child — inside it, the
 * Retry button would be unclickable and hidden from screen readers.
 */
export function PendingContent({ children }: { children: ReactNode }) {
  const phase = usePendingPhase();
  const busy = phase !== "idle";
  return (
    <>
      <div inert={busy} className={`transition-opacity duration-200 ${busy ? "opacity-50" : ""}`}>
        {children}
      </div>
      <SlowNotice phase={phase} />
    </>
  );
}
```

- [ ] **Step 5: Add the sweep animation and reduced-motion rules**

Append to the end of `app/globals.css`:

```css
/* Indeterminate sweep for the top pending bar (see components/ui/states/RouteProgress.tsx) */
@keyframes route-progress-sweep {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(350%);
  }
}
.route-progress-sweep {
  animation: route-progress-sweep 1.1s ease-in-out infinite;
}

/*
 * Feedback must never depend on animation. With motion reduced, the bar becomes a static filled
 * strip and skeletons become flat blocks — both still clearly "not the real thing", just still.
 */
@media (prefers-reduced-motion: reduce) {
  .route-progress-sweep {
    width: 100%;
    animation: none;
    opacity: 0.6;
  }
  .shimmer {
    animation: none;
  }
}
```

- [ ] **Step 6: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. If `inert` errors, confirm `@types/react` is v19 — `grep -n "inert" node_modules/@types/react/index.d.ts` should show `inert?: boolean | undefined;`.

- [ ] **Step 7: Commit**

```bash
git add components/ui/states/PendingNav.tsx components/ui/states/RouteProgress.tsx \
        components/ui/states/SlowNotice.tsx components/ui/states/PendingContent.tsx app/globals.css
git commit -m "feat(loading): pending-navigation provider, progress bar, dim wrapper"
```

---

### Task 3: Mount in the dashboard and convert the Header filters

First visible payoff — after this task, changing a range or campaign gives feedback.

**Files:**
- Modify: `app/dashboard/layout.tsx:33-53`
- Modify: `components/dashboard/Header.tsx:52-66`

**Interfaces:**
- Consumes: `PendingNavProvider`, `PendingContent`, `RouteProgress`, `useNavigate` (Task 2).
- Produces: nothing new.

- [ ] **Step 1: Mount the provider in the dashboard layout**

In `app/dashboard/layout.tsx`, add to the imports:

```tsx
import { PendingContent } from "@/components/ui/states/PendingContent";
import { PendingNavProvider } from "@/components/ui/states/PendingNav";
import { RouteProgress } from "@/components/ui/states/RouteProgress";
```

Then replace the returned JSX block (currently lines 33-53) with:

```tsx
  return (
    <div className="flex min-h-screen">
      <Sidebar workspace={ws} />
      {/* The provider must enclose BOTH the Header (which starts the wait) and <main> (which
          reflects it). Sidebar stays outside — its links change route segment, so they're
          covered by loading.tsx and a local useLinkStatus dot instead. */}
      <PendingNavProvider>
        <RouteProgress />
        <div className="flex min-w-0 flex-1 flex-col">
          <Suspense
            fallback={
              <div className="sticky top-0 z-20 h-[57px] border-b border-ink/10 bg-warm/85 backdrop-blur-[10px]" />
            }
          >
            <Header
              workspaceName={ws.name}
              campaignOptions={campaignOptions}
              isAdmin={ws.isAdmin}
              clients={ws.clients}
              activeClientId={ws.clientId}
            />
          </Suspense>
          {/* Only children are dimmed — the filter controls in Header stay live so you can
              change your mind mid-load. */}
          <main className="flex-1 animate-fade-up px-7 pb-14 pt-[22px]">
            <PendingContent>{children}</PendingContent>
          </main>
        </div>
      </PendingNavProvider>
    </div>
  );
```

- [ ] **Step 2: Route the Header's filter writes through the transition**

In `components/dashboard/Header.tsx`, add to the imports:

```tsx
import { useNavigate } from "@/components/ui/states/PendingNav";
```

Add inside the component, next to the existing `const params = useSearchParams();`:

```tsx
  const navigate = useNavigate();
```

Then in `setParam`, wrap the router call. Replace:

```tsx
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
```

with:

```tsx
      navigate(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
```

And add `navigate` to the `useCallback` dependency array, which becomes:

```tsx
    [navigate, params, pathname, router],
  );
```

- [ ] **Step 3: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Verify in the browser**

```bash
npm run dev
```

Sign in, go to `/dashboard`, and check all four:

1. Click `7d` → within ~150ms the KPI cards dim and a violet bar sweeps at the very top.
2. When data lands → dim clears, numbers change, **no layout jump**.
3. While dimmed, try clicking a lead card or tabbing into the content → nothing focusable, nothing clickable.
4. Click `7d` then immediately `90d` → the bar keeps running, and the notice does *not* appear early.

Then click between two ranges you've already loaded (so it's cached and fast) — **there must be no visible flash**. That's the grace period doing its job; if you see a blink, `GRACE_MS` isn't being applied.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/layout.tsx components/dashboard/Header.tsx
git commit -m "feat(loading): dim + progress bar for dashboard filter changes"
```

---

### Task 4: Convert LeadsTable (the risky one)

Isolated into its own task because `setParam` here exists to fix a real race, and a reviewer must be able to reject this while keeping Task 3.

**Files:**
- Modify: `components/dashboard/leads/LeadsTable.tsx:70-79` (the `setParam` callback) and `:173` (row click)

**Interfaces:**
- Consumes: `useNavigate` (Task 2).
- Produces: nothing new.

**Background — read before editing.** `setParam` composes onto `pendingSearchRef.current ?? window.location.search`, and that ref is cleared when `useSearchParams()` commits. It exists because the Header writes `range`/`campaign` to the same URL, and watching only this component's own props left the ref stale. Wrapping the `replace` in a transition **lengthens** the pending window — which the existing comment states is the intent ("holds the ref across the whole pending window while clearing it promptly once *any* write lands"). That is the reasoning; Step 3 is the evidence.

- [ ] **Step 1: Add the hook**

In `components/dashboard/leads/LeadsTable.tsx`, add to the imports:

```tsx
import { useNavigate } from "@/components/ui/states/PendingNav";
```

Add next to `const pathname = usePathname();`:

```tsx
  const navigate = useNavigate();
```

- [ ] **Step 2: Wrap the two router calls**

In `setParam`, replace:

```tsx
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
```

with:

```tsx
      navigate(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
```

and update that `useCallback`'s dependency array to:

```tsx
    [navigate, pathname, router],
  );
```

Note the `pendingSearchRef.current = qs ? `?${qs}` : "";` assignment on the line above stays **outside** the `navigate` callback — it must be set synchronously, before the transition starts, or a second write racing the first will compose onto a stale base.

Then for the row click, replace:

```tsx
                onClick={() => router.push(`/dashboard/leads/${encodeURIComponent(r.id)}`)}
```

with:

```tsx
                onClick={() =>
                  navigate(() => router.push(`/dashboard/leads/${encodeURIComponent(r.id)}`))
                }
```

- [ ] **Step 3: Verify the race cases in the browser**

```bash
npm run dev
```

Go to `/dashboard/leads`. These are the two races the original code was written to fix — both must still behave:

1. **Change Status mid-typing.** Type a partial search term, and before the 250ms debounce commits, change the Status select. Expected: **both** the typed query and the new status end up in the URL. Neither clobbers the other.
2. **Change Status while a search commit is in flight.** Type a term, wait for it to commit (the content dims), and while it's still dimmed change Status. Expected: both survive in the URL.
3. **Header write composes.** With a status filter and a search active, click `30d` → `7d` in the Header. Expected: `range` changes and `status` + `q` are still in the URL.
4. **Paging.** Click Next → content dims, page advances, `?page=2` in the URL.
5. **Clear filters** removes `q`, `status`, `source`, `page` and empties the search box.

If any of these drop a param, **stop and report it** — do not paper over it by reordering the ref assignment. The fix belongs in a separate change with its own reasoning.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/leads/LeadsTable.tsx
git commit -m "feat(loading): pending feedback for leads search, filters and paging"
```

---

### Task 5: Sidebar pending dots

**Files:**
- Create: `components/ui/states/NavPendingDot.tsx`
- Modify: `components/dashboard/Sidebar.tsx:42-54`
- Modify: `components/console/ConsoleSidebar.tsx` (the nav `<Link>` inside the `GROUPS` map)

**Interfaces:**
- Consumes: `useLinkStatus` from `next/link`.
- Produces: `<NavPendingDot />` — renders nothing unless its enclosing `<Link>` is pending.

- [ ] **Step 1: Create the dot**

Create `components/ui/states/NavPendingDot.tsx`:

```tsx
"use client";

import { useLinkStatus } from "next/link";

/**
 * Immediate acknowledgement on the nav item you actually clicked — visible before the server has
 * said anything, which is the whole point.
 *
 * MUST be rendered as a descendant of the <Link> it reports on; useLinkStatus reads the nearest
 * enclosing link's transition and returns a permanent `pending: false` anywhere else.
 *
 * Segment changes are covered by loading.tsx, so this deliberately does NOT feed the shared
 * phase — stacking a bar and a page dim on top of a full skeleton is three signals for one wait.
 */
export function NavPendingDot() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="ml-auto h-[6px] w-[6px] flex-none animate-pulse rounded-full bg-violet"
    />
  );
}
```

- [ ] **Step 2: Add it to the dashboard sidebar**

In `components/dashboard/Sidebar.tsx`, add to the imports:

```tsx
import { NavPendingDot } from "@/components/ui/states/NavPendingDot";
```

Then inside the nav `<Link>`, add the dot after the label span. Replace:

```tsx
                    <NavIcon name={item.key} />
                    <span>{item.label}</span>
                  </Link>
```

with:

```tsx
                    <NavIcon name={item.key} />
                    <span>{item.label}</span>
                    <NavPendingDot />
                  </Link>
```

- [ ] **Step 3: Add it to the console sidebar**

In `components/console/ConsoleSidebar.tsx`, add to the imports:

```tsx
import { NavPendingDot } from "@/components/ui/states/NavPendingDot";
```

Then add `<NavPendingDot />` as the last child of the nav `<Link>` inside the `GROUPS` map (the one that renders `item.label` for each `NAV` entry), exactly as in Step 2.

- [ ] **Step 4: Verify in the browser**

```bash
npm run dev
```

- Click a dashboard nav item → a violet dot appears on **that** item immediately, then the route's skeleton replaces the content, then the dot clears.
- Confirm the top bar does **not** appear for sidebar navigation (skeleton only — that's the intended rule).
- Repeat in `/console` once Task 6 lands; for now just confirm no crash and no console warnings.

- [ ] **Step 5: Commit**

```bash
git add components/ui/states/NavPendingDot.tsx components/dashboard/Sidebar.tsx \
        components/console/ConsoleSidebar.tsx
git commit -m "feat(loading): per-item pending dot on sidebar navigation"
```

---

### Task 6: Console skeletons and provider

Closes the biggest hole: six routes that currently render nothing until their data lands.

**Files:**
- Modify: `components/ui/states/Skeleton.tsx` (3 new variants)
- Modify: `app/console/layout.tsx:17-22`
- Create: `app/console/loading.tsx`, `app/console/clients/loading.tsx`, `app/console/clients/[id]/loading.tsx`, `app/console/invites/loading.tsx`, `app/console/team/loading.tsx`, `app/console/usage/loading.tsx`

**Interfaces:**
- Consumes: `PendingNavProvider`, `PendingContent`, `RouteProgress` (Task 2).
- Produces: `SkeletonVariant` gains `"console" | "console-detail" | "console-plain" | "console-table" | "console-usage"`.

> **AMENDED DURING EXECUTION.** Step 1 below originally specified a single `console` variant
> shared by `/console`, `/console/team`, `/console/invites`, and `/console/clients/[id]`. Review
> caught that those views do not share a shape — `TeamView.tsx:20` and `InvitesView.tsx:23` have
> no hero, and three of the four are `max-w-[1000px]` not `1100px` — so the shared skeleton would
> have caused a ~208px vertical jump and a 100px horizontal reflow. Split by human ruling into
> `console` (1100px + hero, `/console` only), `console-detail` (1000px + back-link + hero,
> `clients/[id]`), and `console-plain` (1000px, no hero, `team` + `invites`). Shipped in c0d2b1b.

- [ ] **Step 1: Add the three variants**

In `components/ui/states/Skeleton.tsx`, extend the type:

```tsx
export type SkeletonVariant =
  | "cards"
  | "charts"
  | "donuts"
  | "funnel"
  | "calendar"
  | "campaigns"
  | "table"
  | "board"
  | "console"
  | "console-table"
  | "console-usage";
```

Add this helper just below the existing `Block` function:

```tsx
// Every console view opens with a 26-34px heading and a muted subtitle, so all three console
// variants share this head rather than repeating it.
function ConsoleHead() {
  return (
    <>
      <Block className="mb-2.5 h-[30px] w-[260px] rounded-[10px]" />
      <Block className="mb-6 h-[16px] w-[420px] max-w-full rounded-[8px]" />
    </>
  );
}
```

Then add these three cases to the switch, immediately before `default:`:

```tsx
    case "console":
      return (
        <div className="mx-auto max-w-[1100px]">
          <ConsoleHead />
          <Block className="mb-7 h-[180px] rounded-[18px]" />
          <div className="mb-7 grid grid-cols-2 gap-3.5 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Block key={i} className="h-[86px] rounded-[13px]" />
            ))}
          </div>
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Block key={i} className="h-[74px] rounded-[14px]" />
            ))}
          </div>
        </div>
      );
    case "console-table":
      return (
        <div className="mx-auto max-w-[1100px]">
          <ConsoleHead />
          <div className="rounded-[16px] border border-ink/10 bg-white p-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Block key={i} className="m-1.5 h-[46px]" />
            ))}
          </div>
        </div>
      );
    case "console-usage":
      return (
        <div className="mx-auto max-w-[1100px]">
          <ConsoleHead />
          {/* period picker */}
          <div className="mb-6 rounded-[16px] border border-ink/10 bg-white px-[18px] py-4">
            <Block className="mb-2.5 h-[12px] w-[60px] rounded-[6px]" />
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Block key={i} className="h-[30px] w-[92px] rounded-[9px]" />
              ))}
            </div>
          </div>
          <Block className="mb-6 h-[300px] rounded-[16px]" />
          <Block className="h-[260px] rounded-[16px]" />
        </div>
      );
```

- [ ] **Step 2: Create the six loading files**

`app/console/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/states/Skeleton";

export default function Loading() {
  return <Skeleton variant="console" />;
}
```

`app/console/clients/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/states/Skeleton";

export default function Loading() {
  return <Skeleton variant="console-table" />;
}
```

`app/console/clients/[id]/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/states/Skeleton";

export default function Loading() {
  return <Skeleton variant="console" />;
}
```

`app/console/invites/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/states/Skeleton";

export default function Loading() {
  return <Skeleton variant="console" />;
}
```

`app/console/team/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/states/Skeleton";

export default function Loading() {
  return <Skeleton variant="console" />;
}
```

`app/console/usage/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/states/Skeleton";

export default function Loading() {
  return <Skeleton variant="console-usage" />;
}
```

- [ ] **Step 3: Mount the provider in the console layout**

In `app/console/layout.tsx`, add to the imports:

```tsx
import { PendingContent } from "@/components/ui/states/PendingContent";
import { PendingNavProvider } from "@/components/ui/states/PendingNav";
import { RouteProgress } from "@/components/ui/states/RouteProgress";
```

Replace the returned JSX with:

```tsx
  return (
    <div className="flex min-h-screen bg-warm">
      <ConsoleSidebar userName={ctx.userName} initials={toInitials(ctx.userName)} />
      <PendingNavProvider>
        <RouteProgress />
        <main className="min-w-0 flex-1 animate-fade-up px-8 pb-16 pt-7">
          <PendingContent>{children}</PendingContent>
        </main>
      </PendingNavProvider>
    </div>
  );
```

- [ ] **Step 4: Verify in the browser**

```bash
npm run dev
```

Visit each of the six console routes with a **hard reload** (⌘⇧R) so you see the cold load:

`/console` · `/console/clients` · `/console/clients/<any-id>` · `/console/invites` · `/console/team` · `/console/usage`

Each must show a shimmer skeleton whose shape roughly matches the real view — heading block where the heading goes, table rows where rows go — with **no large layout jump** when the real content swaps in.

- [ ] **Step 5: Commit**

```bash
git add components/ui/states/Skeleton.tsx app/console/layout.tsx app/console/loading.tsx \
        app/console/clients/loading.tsx "app/console/clients/[id]/loading.tsx" \
        app/console/invites/loading.tsx app/console/team/loading.tsx app/console/usage/loading.tsx
git commit -m "feat(loading): skeletons for every console route"
```

---

### Task 7: Busy state for server-action forms

Twelve forms currently submit silently. `syncClients` and `setActiveClient` both hit the Emma API and look like dead buttons.

**Files:**
- Create: `components/ui/states/SubmitButton.tsx`
- Modify: `app/dashboard/layout.tsx` (signOut form), `components/dashboard/Sidebar.tsx:82`, `components/console/ConsoleSidebar.tsx:97`, `components/dashboard/WorkspaceSwitcher.tsx:16`, `components/console/ClientsTable.tsx:23,130`, `components/console/ClientDetailView.tsx:45,106`, `components/console/InvitesView.tsx:33,109`, `components/console/TeamView.tsx:36,87`

**Interfaces:**
- Consumes: `useFormStatus` from `react-dom`.
- Produces: `<SubmitButton className={string} pendingLabel={string} title?={string}>{children}</SubmitButton>`

- [ ] **Step 1: Create the shared button**

Create `components/ui/states/SubmitButton.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Submit control for server-action forms.
 *
 * MUST be rendered inside the <form> it belongs to — useFormStatus reads the nearest enclosing
 * form's submission, and returns a permanent `pending: false` if called from the component that
 * *renders* the form rather than a child of it.
 *
 * Disables on submit, which also prevents the double-submit that silent buttons invite.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
  title,
}: {
  children: ReactNode;
  /** Omit for icon-only buttons — the icon stays and the disabled state carries the signal. */
  pendingLabel?: ReactNode;
  className?: string;
  title?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      title={title}
      className={`${className ?? ""} disabled:cursor-default disabled:opacity-60`}
    >
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}
```

- [ ] **Step 2: Convert the sync button (the most valuable one)**

In `components/console/ClientsTable.tsx`, add to the imports:

```tsx
import { SubmitButton } from "@/components/ui/states/SubmitButton";
```

Replace the whole `<button type="submit">…</button>` inside the `syncClients` form with:

```tsx
          <SubmitButton
            pendingLabel="Syncing…"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-ink/10 bg-white px-3 py-[7px] font-display text-[12.5px] font-medium text-ink transition-colors hover:bg-lavender"
          >
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4v4h-4" />
              <path d="M16 8a6.5 6.5 0 1 0 1 5" />
            </svg>
            Sync from Emma
          </SubmitButton>
```

- [ ] **Step 3: Convert the remaining button-bearing forms**

Apply the same pattern to each. For every one: add the `SubmitButton` import to the file if absent, replace the form's `<button type="submit">` with `<SubmitButton>`, move the existing `className` across verbatim, and give a `pendingLabel`.

> **AMENDED DURING EXECUTION — two exceptions to "verbatim".** Review caught this rule
> contradicting Step 2's own code block, which adds `cursor-pointer` to the sync button. Ruled in
> favour of the code: a `<button>` does not get `cursor: pointer` by default, and this app's other
> interactive controls (Header range pills, sign-out, workspace select) already carry it, so the
> addition makes the sync button consistent rather than exceptional. The second exception is
> `disabled:cursor-default disabled:opacity-60`, which styles genuinely new behavior rather than
> restyling existing appearance. Everything else moves across byte-identical.

| File | Action | `pendingLabel` |
|---|---|---|
| `app/dashboard/layout.tsx` (signOut) | `signOut` | `Signing out…` |
| `components/console/ClientsTable.tsx:130` | `setActiveClient` | `Opening…` |
| `components/console/ClientDetailView.tsx:45` | `setActiveClient` | `Opening…` |
| `components/console/ClientDetailView.tsx:106` | `createInvite` | `Creating…` |
| `components/console/InvitesView.tsx:33` | `createInvite` | `Creating…` |
| `components/console/InvitesView.tsx:109` | `revokeInvite` | `Revoking…` |
| `components/console/TeamView.tsx:36` | `createTeamInvite` | `Inviting…` |
| `components/console/TeamView.tsx:87` | `revokeInvite` | `Revoking…` |

The five distinct files in that table — `app/dashboard/layout.tsx`, `ClientsTable.tsx`, `ClientDetailView.tsx`, `InvitesView.tsx`, `TeamView.tsx` — are all **server** components, which is fine: a server component may render a client component like `SubmitButton`; it just can't call hooks itself. (`Sidebar.tsx` and `ConsoleSidebar.tsx`, covered below, were already client components for unrelated `usePathname` reasons.)

**The two icon-only sign-out buttons** (`components/dashboard/Sidebar.tsx:82` and
`components/console/ConsoleSidebar.tsx:97`) have no room for a label, so `pendingLabel` is omitted
entirely — the icon stays put and the disabled state carries the signal. Keep each file's existing
SVG exactly as it is; only the wrapper element changes:

```tsx
        <form action={signOut}>
          <SubmitButton
            title="Sign out"
            className="cursor-pointer rounded-[8px] p-1.5 text-muted transition-colors hover:bg-lavender"
          >
            {/* the file's existing sign-out <svg>, unchanged */}
          </SubmitButton>
        </form>
```

- [ ] **Step 4: Handle WorkspaceSwitcher separately — it has no submit button**

`components/dashboard/WorkspaceSwitcher.tsx` submits via `onChange={(e) => e.currentTarget.form?.requestSubmit()}` on a `<select>`. There is no button for `SubmitButton` to replace, and `useFormStatus` called in `WorkspaceSwitcher` itself would always return `pending: false`, because that component *renders* the form rather than sitting inside it.

Extract the select into a child so the hook has a form to read. Replace the whole file body's return with:

```tsx
export function WorkspaceSwitcher({
  clients,
  activeClientId,
}: {
  clients: WorkspaceClient[];
  activeClientId: string;
}) {
  return (
    <form action={setActiveClient} className="relative">
      <WorkspaceSelect clients={clients} activeClientId={activeClientId} />
    </form>
  );
}

/**
 * Separate component so useFormStatus has an enclosing form to report on — called from
 * WorkspaceSwitcher itself it would always read `pending: false`.
 *
 * Switching workspace reloads every figure on the page, so locking the select while it lands
 * also stops a second switch racing the first.
 */
function WorkspaceSelect({
  clients,
  activeClientId,
}: {
  clients: WorkspaceClient[];
  activeClientId: string;
}) {
  const { pending } = useFormStatus();
  return (
    <>
      <select
        name="clientId"
        defaultValue={activeClientId}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        aria-label="Switch workspace"
        title={pending ? "Switching workspace…" : "Switch workspace (admin)"}
        className="max-w-[220px] cursor-pointer appearance-none rounded-[6px] border border-lavender-deep bg-lavender py-0.5 pl-2 pr-6 font-mono text-[11px] text-muted hover:text-violet disabled:cursor-default disabled:opacity-60"
      >
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[8px] text-muted">
        {pending ? "…" : "▼"}
      </span>
    </>
  );
}
```

Add `useFormStatus` to the imports at the top of that file:

```tsx
import { useFormStatus } from "react-dom";
```

- [ ] **Step 5: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Verify in the browser**

```bash
npm run dev
```

- `/console/clients` → click **Sync from Emma**. It must disable and read "Syncing…" for the real duration of the call, then return to normal.
- Click it twice rapidly → the second click must do nothing (disabled).
- `/console/invites` → submit an invite; the button reads "Creating…" while in flight.
- As a platform admin on `/dashboard`, change the workspace in the switcher → the select locks and its caret becomes `…` until the new workspace loads.

- [ ] **Step 7: Commit**

```bash
git add components/ui/states/SubmitButton.tsx app/dashboard/layout.tsx \
        components/dashboard/Sidebar.tsx components/dashboard/WorkspaceSwitcher.tsx \
        components/console/ConsoleSidebar.tsx components/console/ClientsTable.tsx \
        components/console/ClientDetailView.tsx components/console/InvitesView.tsx \
        components/console/TeamView.tsx
git commit -m "feat(loading): busy state for every server-action form"
```

---

### Task 8: Usage period picker and CSV export

Two deliberate behavior changes, both approved in the spec's "Deliberate behavior changes" section.

**`UsageView` is a SERVER component and must stay one.** `app/console/usage/page.tsx` passes it
`exportHref` and `monthHref` as *functions*, which only works across a server-to-server boundary —
functions are not serializable to a client component. Adding `useState` to `UsageView` would force
it client-side and break that prop contract, cascading into a page rewrite.

So both interactive bits become small **client islands** that take plain string props. The big
table stays server-rendered and the page's prop contract is untouched.

**Files:**
- Create: `components/console/UsageControls.tsx`
- Modify: `components/console/UsageView.tsx` (period picker ~`:70-95`, `ExportLink` ~`:299-322`)

**Interfaces:**
- Consumes: `NavLink` (Task 2).
- Produces:
  - `<MonthPill href={string} current={boolean}>{children}</MonthPill>`
  - `<ExportButton href={string} />`

- [ ] **Step 1: Create the two client islands**

Create `components/console/UsageControls.tsx`:

```tsx
"use client";

import { useState } from "react";
import { NavLink } from "@/components/ui/states/PendingNav";

/**
 * A month pill in the usage period picker.
 *
 * Was a plain <a href>, which made every month switch a FULL page reload — white flash, whole
 * app re-downloaded. NavLink keeps it a real anchor (middle-click and open-in-new-tab still
 * work) while routing plain left-clicks through the shared transition, so it dims and shows the
 * bar like the Header's range pills. It has to be NavLink rather than Link because changing
 * month is a same-segment param change: loading.tsx never fires for it.
 */
export function MonthPill({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      href={href}
      aria-current={current ? "true" : undefined}
      className={`rounded-[9px] border px-2.5 py-[6px] font-display text-[12.5px] transition-colors ${
        current
          ? "border-violet/40 bg-lavender font-semibold text-violet"
          : "border-ink/10 bg-white font-normal text-ink hover:bg-lavender"
      }`}
    >
      {children}
    </NavLink>
  );
}

/**
 * Fetches the CSV and hands it to the browser as a blob.
 *
 * It used to be a plain <a> to the streaming route handler, so no router transition ever fired
 * and the wait was completely invisible. Buffering is fine here: one export is a single month of
 * per-client rows. Failure is surfaced on the button rather than swallowed — someone is about to
 * invoice from this file.
 */
export function ExportButton({ href }: { href: string }) {
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");

  async function download() {
    if (state === "working") return;
    setState("working");
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error(`export failed: ${res.status}`);
      const blob = await res.blob();
      const name =
        res.headers.get("content-disposition")?.match(/filename="?([^"]+)"?/)?.[1] ?? "usage.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={state === "working"}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-ink/10 bg-white px-3 py-[7px] font-display text-[12.5px] font-medium text-ink transition-colors hover:bg-lavender disabled:cursor-default disabled:opacity-60"
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 3v10" />
        <path d="m6 9.5 4 4 4-4" />
        <path d="M4 16.5h12" />
      </svg>
      {state === "working" ? "Preparing…" : state === "failed" ? "Retry export" : "Export CSV"}
    </button>
  );
}
```

- [ ] **Step 2: Use MonthPill in the period picker**

In `components/console/UsageView.tsx`, add to the imports:

```tsx
import { ExportButton, MonthPill } from "@/components/console/UsageControls";
```

In the period-picker map, replace the whole `<a>…</a>` element with:

```tsx
              <MonthPill key={m} href={monthHref(m)} current={on}>
                {monthLabel(m)}
                {m === currentMonth ? (
                  <span className="ml-1.5 font-mono text-[10px] text-muted">to date</span>
                ) : null}
              </MonthPill>
```

- [ ] **Step 3: Swap ExportLink for ExportButton**

Delete the entire local `ExportLink` function from `UsageView.tsx` (including its
`/** A plain anchor, not next/link… */` doc comment — that rationale no longer holds and must not
be left contradicting the code).

Then update its two call sites:

```tsx
        action={<ExportButton href={exportHref("period")} />}
```

```tsx
          action={<ExportButton href={exportHref("history")} />}
```

- [ ] **Step 4: Verify UsageView is still a server component**

```bash
head -1 components/console/UsageView.tsx
```

Expected: the first line is `import {` — **not** `"use client"`. If a `"use client"` directive
ended up at the top of this file, the island extraction failed and `app/console/usage/page.tsx`
will break on its function props.

- [ ] **Step 5: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Verify in the browser**

```bash
npm run dev
```

Go to `/console/usage`:

1. Click a different month pill → content dims, bar runs, month changes. **No white flash / full reload** — that's the fix.
2. ⌘-click (or middle-click) a month pill → opens in a new tab as a normal link. That's why it stayed an anchor.
3. Click **Export CSV** → reads "Preparing…" and is disabled, then the file downloads with its proper filename.
4. Open the downloaded CSV and confirm it is byte-identical to what the old anchor produced.

- [ ] **Step 7: Commit**

```bash
git add components/console/UsageControls.tsx components/console/UsageView.tsx
git commit -m "feat(loading): soft month switching and real export progress on usage"
```

---

## Final verification

- [ ] **Run the full test suite**

```bash
npm run test:loading && npm run test:usage && npm run test:leadsearch && npm run lint && npx tsc --noEmit
```

All must pass. Read the output — do not assume.

- [ ] **Build**

```bash
npm run build
```

Expected: clean build. Watch for "useSearchParams should be wrapped in a suspense boundary" — if it appears on a route it didn't before, a client hook was added above an existing Suspense boundary.

- [ ] **Reduced-motion pass**

macOS: System Settings → Accessibility → Display → Reduce motion. With it on, trigger a filter change: the bar must be a **static** filled strip (not sweeping) and skeletons must be flat (not shimmering). Both must still be clearly visible.

- [ ] **Slow-path pass**

The 8s and 25s phases are the hardest to see naturally. Force them by temporarily lowering `SLOW_MS` to `800` and `STUCK_MS` to `2500` in `lib/pending-phase.ts`, then:

1. Change a filter → after ~0.8s the "Still fetching — the data service is slow right now." notice appears **below** the dimmed content.
2. After ~2.5s a **Retry** button appears next to it.
3. Click Retry → it re-fetches; the notice does not stack a second copy.
4. Tab to Retry with the keyboard → **it must be reachable**. If it isn't, `SlowNotice` has been nested inside the `inert` element.

**Then revert the constants to 8_000 / 25_000 and re-run `npm run test:loading`** — the selftest asserts the real values and will fail if you forget.

## Self-review notes

Checked against the spec:

- Phase timeline, grace period, all four phases → Task 1 (logic) + Task 2 (wiring)
- Dim + `inert` + bar + escalation + Retry → Task 2
- `SlowNotice` outside the inert wrapper → enforced in Task 2 Step 4 and verified in Final Verification
- Header filters → Task 3 · LeadsTable search/filters/paging/row-click → Task 4
- Sidebar `useLinkStatus` dots, both sidebars → Task 5
- Six console `loading.tsx` + Skeleton variants + console provider → Task 6 (amended during
  execution from three variants to five — see the note in Task 6)
- Twelve server-action forms via `useFormStatus` → Task 7 (ten via `SubmitButton`, the two
  icon-only sign-outs with a tooltip, `WorkspaceSwitcher` via a `useFormStatus` child because it
  has no submit button)
- Period picker `NavLink` + export fetch-to-blob → Task 8, as client islands in
  `UsageControls.tsx` so `UsageView` stays a server component and keeps its function props
- `prefers-reduced-motion` → Task 2 Step 5, verified in Final Verification
- `aria-live` notice, `aria-hidden` bar → Task 2 Steps 2-3
- Superseded-navigation restart → asserted in Task 1, implemented in Task 2 Step 1
- LeadsTable race risk → Task 4 Step 3, with an explicit instruction to stop and report rather than patch

Two corrections made during review, both found by reading the code rather than assuming it:

- **`UsageView` is a server component** and receives `exportHref`/`monthHref` as functions. The
  first draft of Task 8 added `useState` to it, which would have broken
  `app/console/usage/page.tsx`. Rewritten as client islands.
- **`WorkspaceSwitcher` has no submit button** — it submits via `requestSubmit()` on select
  change, so `SubmitButton` cannot apply and `useFormStatus` would have read a permanent
  `pending: false` from the component that renders the form. Given its own step with an extracted
  child component.

Known gap, deliberate: the visual layer has no automated coverage. The repo has no browser-test harness, and adding one is a larger decision than this feature should make. Manual steps are therefore written as explicit pass/fail checks rather than "check it looks right".
