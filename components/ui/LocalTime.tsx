"use client";

import { useSyncExternalStore } from "react";
import { fmtDateTime } from "@/lib/format";

/**
 * Renders an ISO timestamp as "Aug 14, 3:42 PM" in the VIEWER's browser timezone.
 *
 * Why a component and not a plain helper call: client components are still server-rendered
 * for the first HTML, and the server (Vercel) runs in UTC. React 19 does not patch text under
 * `suppressHydrationWarning`, so a UTC string baked into that HTML survived hydration and sat
 * there until the next re-render — the "times keep flipping to UK time" bug. Here the server
 * snapshot is `null`, so no timezone-dependent text is ever emitted server-side; React swaps in
 * the local rendering synchronously right after hydration (useSyncExternalStore contract).
 */
export function LocalTime({
  iso,
  now,
  className,
}: {
  iso: string;
  /** Reference "now" for the year-elision rule; defaults to the render time. */
  now?: number;
  className?: string;
}) {
  const tz = useSyncExternalStore(subscribe, getBrowserTimeZone, getServerTimeZone);
  const text = tz ? fmtDateTime(iso, now ?? Date.now(), tz) : "";
  return (
    <time dateTime={iso} className={className} title={tz ? `${text} (${tz})` : undefined}>
      {text || " "}
    </time>
  );
}

function subscribe() {
  // The browser timezone doesn't change within a page's life; nothing to listen to.
  return () => {};
}

function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function getServerTimeZone(): string | null {
  return null;
}
