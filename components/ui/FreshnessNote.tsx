import { relTime } from "@/lib/format";
import type { Freshness } from "@/lib/types";

// Subtle stale-data indicator — only renders when serving a cached value (stale-on-error
// or under refresh). Keeps the design clean when data is fresh.
export function FreshnessNote({ freshness }: { freshness: Freshness }) {
  if (!freshness.stale) return null;
  const when = relTime(new Date(freshness.fetchedAt).toISOString());
  return (
    <div className="mb-4 flex items-center gap-2 rounded-[10px] border border-warning/30 bg-warning/[0.08] px-3.5 py-2 font-mono text-[12px] text-[#9a6b1a]">
      <span className="h-1.5 w-1.5 flex-none rounded-full bg-warning" />
      Showing cached data{when ? ` · updated ${when}` : ""} — refreshing.
    </div>
  );
}
