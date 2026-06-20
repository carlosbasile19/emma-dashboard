import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states/EmptyState";
import { ErrorState } from "@/components/ui/states/ErrorState";
import { FreshnessNote } from "@/components/ui/FreshnessNote";
import { getWorkspace } from "@/lib/auth";
import { EMPTY_COPY, ERROR_COPY } from "@/lib/copy";
import { DEFAULT_TZ, parseRange, rangeToPeriod } from "@/lib/filters";
import { num, pct, secToMMSS } from "@/lib/format";
import { fetchAgents } from "@/lib/olivia/service";

type SP = Promise<Record<string, string | string[] | undefined>>;

const COLS = "grid-cols-[1.7fr_1fr_1fr_1.1fr_1.1fr_1fr]";

export default async function AgentsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const ws = await getWorkspace();
  const tz = ws.timezone ?? DEFAULT_TZ;

  let result;
  try {
    result = await fetchAgents(rangeToPeriod(range, tz));
  } catch {
    return <ErrorState copy={ERROR_COPY.agents} />;
  }

  const agents = result.data;
  if (agents.length === 0) {
    return <EmptyState copy={EMPTY_COPY.agents} />;
  }

  return (
    <>
      <FreshnessNote freshness={result.freshness} />
      <Card className="overflow-hidden">
        <div className={`grid ${COLS} gap-3 border-b border-ink/10 bg-surface-tint px-[22px] py-3.5`}>
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
    </>
  );
}
