"use client";

import { useRouter } from "next/navigation";
import { useNavigate } from "@/components/ui/states/PendingNav";
import type { PendingPhase } from "@/lib/pending-phase";

/**
 * Shown once a wait is abnormal. Deliberately NOT an error state: the request may still
 * succeed, so this claims nothing about failure — it explains, and at `stuck` offers a way out.
 *
 * MUST be rendered outside the `inert` wrapper in PendingContent, or Retry is unclickable.
 *
 * The `role="status" aria-live="polite"` wrapper is ALWAYS rendered, even when there's nothing to
 * say — only its content is gated on phase. Screen readers register a live region when it
 * *enters* the accessibility tree, not when its content later changes; a region that shows up
 * already containing text in the same mutation (which is what `phase !== "slow" && ... return
 * null` used to do) is commonly missed entirely by NVDA and JAWS. That matters here more than
 * usual: this is the only non-`aria-hidden` signal anywhere in this feature — the progress bar
 * and the nav dot are both decorative, and the dim announces nothing on its own. Mounting the
 * wrapper empty up front, and only ever toggling its *content*, is what makes the eventual
 * announcement reliable. When there's nothing to say, it stays in the DOM as an empty `sr-only`
 * node rather than unmounting — don't reintroduce the early return.
 */
export function SlowNotice({ phase }: { phase: PendingPhase }) {
  const router = useRouter();
  const navigate = useNavigate();
  const talking = phase === "slow" || phase === "stuck";
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        talking
          ? "mt-4 flex flex-wrap items-center gap-3 rounded-[13px] border border-ink/10 bg-white px-4 py-3 shadow-sm"
          : "sr-only"
      }
    >
      {talking ? (
        <>
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
        </>
      ) : null}
    </div>
  );
}
