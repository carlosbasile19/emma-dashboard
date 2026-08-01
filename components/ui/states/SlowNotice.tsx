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
