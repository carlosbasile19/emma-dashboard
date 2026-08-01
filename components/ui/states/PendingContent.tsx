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
