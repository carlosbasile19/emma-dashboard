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
