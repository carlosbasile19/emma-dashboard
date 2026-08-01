"use client";

import { useEffect, useRef, type ReactNode } from "react";
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
 *
 * Focus restoration — READ BEFORE "simplifying" this:
 *
 * The HTML focus-fixup rule says that when a focused element gains an inert ancestor, focus is
 * reset to `<body>`. On `/dashboard/leads` the search input, the two selects, Clear filters, and
 * Prev/Next all live inside `{children}` — the same subtree that goes `inert` while busy. So the
 * moment a debounced search commits and this wrapper flips `inert`, the input the user was
 * typing into gets yanked to `<body>` and stays there for the whole navigation, which
 * `LeadsTable.tsx` documents as taking seconds on a search commit. Further keystrokes go nowhere.
 *
 * You cannot recover the lost element by reading `document.activeElement` in an effect keyed on
 * `busy`: by the time that effect runs, React has already committed the `inert` attribute and the
 * browser has already performed the fixup, so `document.activeElement` is already `<body>` —
 * there is nothing left to capture. The only way to know what was focused is to have been
 * listening continuously *before* the fixup happened, hence the `focusin` listener below, which
 * is attached once (not keyed on `busy`) and simply records whatever last received focus inside
 * the wrapper. When busy clears, if focus is still sitting on `<body>` (i.e. it was actually lost
 * to the fixup, not deliberately moved by the user to something outside the wrapper, like a
 * Header range pill), we hand it back.
 */
export function PendingContent({ children }: { children: ReactNode }) {
  const phase = usePendingPhase();
  const busy = phase !== "idle";
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  // Continuous capture, independent of `busy` — see the doc comment above for why this can't be
  // done reactively from a `busy`-keyed effect.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement) lastFocusedRef.current = e.target;
    };
    wrapper.addEventListener("focusin", onFocusIn);
    return () => wrapper.removeEventListener("focusin", onFocusIn);
  }, []);

  // Restore once the wait clears — but only if focus is currently sitting on `<body>` (i.e. was
  // actually lost to the fixup). If the user deliberately focused something else while busy (the
  // Header range pills stay live throughout), that focus is left alone.
  useEffect(() => {
    if (busy) return;
    const el = lastFocusedRef.current;
    if (!el || !el.isConnected) return;
    const active = document.activeElement;
    if (active === document.body || active === null) {
      el.focus({ preventScroll: true });
    }
  }, [busy]);

  return (
    <>
      <div
        ref={wrapperRef}
        inert={busy}
        className={`transition-opacity duration-200 ${busy ? "opacity-50" : ""}`}
      >
        {children}
      </div>
      <SlowNotice phase={phase} />
    </>
  );
}
