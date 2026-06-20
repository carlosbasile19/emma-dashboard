import { Card } from "@/components/ui/Card";
import { num, pct, secToMMSS } from "@/lib/format";
import { sampleAgents } from "@/lib/sample-data";

const COLS = "grid-cols-[1.7fr_1fr_1fr_1.1fr_1.1fr_1fr]";

export default function AgentsPage() {
  const agents = sampleAgents;

  return (
    <Card className="overflow-hidden">
      <div
        className={`grid ${COLS} gap-3 border-b border-ink/10 bg-surface-tint px-[22px] py-3.5`}
      >
        <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">
          Agent
        </div>
        {["Leads", "Calls", "Pickup rate", "Booking rate", "Avg dur."].map((h) => (
          <div
            key={h}
            className="text-right font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted"
          >
            {h}
          </div>
        ))}
      </div>

      {agents.map((a, i) => (
        <div
          key={a.agent_id}
          className={`grid ${COLS} items-center gap-3 border-b border-lavender px-[22px] py-[15px] ${
            i % 2 ? "bg-lavender/40" : "bg-white"
          }`}
        >
          <div className="flex min-w-0 items-center gap-[11px]">
            <span className="bg-gradient-brand flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px]">
              <span className="h-3 w-3 rounded-full bg-white/90" />
            </span>
            <span className="truncate text-sm font-medium">{a.name}</span>
          </div>
          <div className="text-right font-mono text-[13.5px]">{num(a.total_leads)}</div>
          <div className="text-right font-mono text-[13.5px] text-muted">
            {num(a.total_calls)}
          </div>
          <div className="text-right font-mono text-[13.5px]">{pct(a.pickup_rate)}</div>
          <div className="text-right font-mono text-[13.5px]">
            {pct(a.overall_booking_rate)}
          </div>
          <div className="text-right font-mono text-[13.5px] text-muted">
            {secToMMSS(a.avg_call_duration_sec)}
          </div>
        </div>
      ))}
    </Card>
  );
}
