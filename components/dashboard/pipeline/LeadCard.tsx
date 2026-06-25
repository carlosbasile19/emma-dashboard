import { Badge } from "@/components/ui/Badge";
import { num } from "@/lib/format";
import { leadCardLabel, leadStageSince } from "@/lib/pipeline/board";
import type { Lead } from "@/lib/types";

// Read-only lead card — plain, non-interactive (no drag/edit/click affordances).
export function LeadCard({ lead }: { lead: Lead }) {
  const label = leadCardLabel(lead);
  const since = leadStageSince(lead);
  return (
    <div className="rounded-[10px] border border-ink/10 bg-white px-3 py-2.5 shadow-sm">
      <div className="truncate text-[13px] font-medium text-ink">{label}</div>
      {/* relative time: server-rendered then re-evaluated on hydration — suppress mismatch */}
      <div
        className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-muted"
        suppressHydrationWarning
      >
        <span>☎ {num(lead.total_calls)}</span>
        {since ? <span aria-hidden>·</span> : null}
        {since ? <span>{since}</span> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {lead.last_disposition ? <Badge kind="disp" value={lead.last_disposition} /> : null}
        <Badge kind="source" value={lead.source} />
      </div>
    </div>
  );
}
