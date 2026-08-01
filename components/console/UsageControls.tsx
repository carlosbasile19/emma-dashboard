"use client";

import { useState } from "react";
import { NavLink } from "@/components/ui/states/PendingNav";
import { parseContentDispositionFilename } from "@/lib/content-disposition";

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
      const name = parseContentDispositionFilename(res.headers.get("content-disposition"));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      // Firefox has historically required the anchor to be attached to the document for a
      // programmatic `download` click to trigger, and revoking the object URL in the same tick
      // as the click is a known cause of zero-byte or cancelled downloads. Chrome tolerates both
      // shortcuts, which is why a Chrome-only manual pass wouldn't have caught this.
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
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
