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

/**
 * Fallback `navigate` used when `useNavigate` is called outside `PendingNavProvider`. Hoisted to
 * a module-level constant rather than allocated inline on every call — not reachable today (the
 * provider always wraps the tree), but the failure mode if it churned would be silent and
 * severe: an unstable `navigate` identity would retrigger every effect/`useCallback` built on it
 * (setParam → setQuery → the leads search debounce effect), and the search would never commit.
 */
const noProviderFallback = (fn: () => void) => fn();

/**
 * Wrap a router call so the whole layout can reflect the wait. Outside the provider, runs `fn`
 * without the shared pending treatment.
 */
export function useNavigate(): (fn: () => void) => void {
  const ctx = useContext(NavigateCtx);
  return ctx ?? noProviderFallback;
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
 * `<NavPendingDot />` instead — `loading.tsx` already covers those. Leads table rows are the
 * exception: the row is a `<div onClick>`, not a `<Link>`, so there's no anchor for
 * `NavPendingDot` to hang off, and it wraps its `router.push` in the shared transition instead.
 * That wrap is a harmless no-op, not the only coverage: `app/dashboard/leads/[id]/loading.tsx`
 * already handles the route-segment change, and in practice React commits that never-before-
 * mounted Suspense fallback well inside the 150ms grace period, so nothing visibly stacks.
 */
export function NavLink({
  href,
  children,
  target,
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
      target={target}
      {...rest}
      onClick={(e) => {
        if (e.defaultPrevented) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        // A target other than "_self" (e.g. a future target="_blank" caller) must fall through
        // to native anchor behavior rather than silently navigating in this tab.
        if (target && target !== "_self") return;
        e.preventDefault();
        navigate(() => router.push(href));
      }}
    >
      {children}
    </Link>
  );
}
