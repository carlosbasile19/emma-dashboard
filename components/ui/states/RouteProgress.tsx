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
