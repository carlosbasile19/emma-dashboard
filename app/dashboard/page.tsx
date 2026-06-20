import { Sparkline } from "@/components/charts/Sparkline";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { RANGE_LABELS } from "@/lib/copy";
import { STAGE_COLORS } from "@/lib/design";
import { centsToMoney, num, pct } from "@/lib/format";
import { buildKpiCards } from "@/lib/overview";
import {
  sampleOverview,
  sampleOverviewPrev,
  sampleTimeseries,
  sampleWorkspace,
} from "@/lib/sample-data";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/types";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function OverviewPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const range = typeof sp.range === "string" ? sp.range : "30d";
  const rangeLabel = RANGE_LABELS[range] ?? "Last 30 days";

  const ov = sampleOverview;
  const k = ov.kpis;
  const cards = buildKpiCards(ov, sampleOverviewPrev, sampleTimeseries);

  const stages = LEAD_STATUSES.map((key: LeadStatus) => ({
    key,
    count: k.leads_by_stage[key] ?? 0,
  }));
  const stageTotal = stages.reduce((a, s) => a + s.count, 0);
  const stageMax = Math.max(1, ...stages.map((s) => s.count));

  return (
    <>
      {/* hero band */}
      <div className="relative mb-[22px] overflow-hidden rounded-[16px] bg-ink px-8 py-7 shadow-ink">
        <div className="absolute -right-16 -top-44 h-[380px] w-[380px] rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.55),transparent_62%)]" />
        <div className="absolute -bottom-44 left-[18%] h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(255,61,119,0.32),transparent_64%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-7">
          <div className="max-w-[540px]">
            <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.16em] text-violet-light">
              {rangeLabel} · {sampleWorkspace.name}
            </div>
            <div className="text-[34px] font-bold leading-[1.1] tracking-[-0.02em] text-white text-balance">
              {num(k.converted_count)} leads converted — while you ran the practice.
            </div>
            <div className="mt-3.5 max-w-[480px] text-[15px] leading-[1.5] text-[#B7C3C4]">
              Emma picked up, called back and followed through on every channel.
              Here’s the period at a glance.
            </div>
          </div>
          <div className="flex gap-[30px] font-mono">
            <div>
              <div className="text-[30px] tracking-[-0.01em] text-white">
                {pct(k.pickup_rate)}
              </div>
              <div className="mt-1.5 text-[11px] uppercase tracking-[0.08em] text-[#8FA1A3]">
                pickup rate
              </div>
            </div>
            <div>
              <div className="text-[30px] tracking-[-0.01em] text-violet-light">
                {pct(k.bookings_rate)}
              </div>
              <div className="mt-1.5 text-[11px] uppercase tracking-[0.08em] text-[#8FA1A3]">
                bookings rate
              </div>
            </div>
            <div>
              <div className="text-[30px] tracking-[-0.01em] text-white">
                {centsToMoney(k.spend.total_cents, k.spend.currency)}
              </div>
              <div className="mt-1.5 text-[11px] uppercase tracking-[0.08em] text-[#8FA1A3]">
                billed spend
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI grid */}
      <div className="mb-[22px] grid grid-cols-[repeat(auto-fill,minmax(216px,1fr))] gap-[14px]">
        {cards.map((c) => (
          <Card key={c.key} className="relative overflow-hidden p-4 pb-3.5">
            <div className="bg-gradient-brand absolute inset-x-0 top-0 h-0.5 opacity-70" />
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                {c.label}
              </span>
              {c.delta ? (
                <span className="font-mono text-[11px]" style={{ color: c.deltaColor }}>
                  {c.delta}
                </span>
              ) : null}
            </div>
            <div className="mb-2.5 flex items-baseline gap-0.5">
              <span className="font-mono text-[30px] font-medium tracking-[-0.01em] text-ink">
                {c.value}
              </span>
              {c.unit ? (
                <span className="font-mono text-base text-muted">{c.unit}</span>
              ) : null}
            </div>
            <div className="h-[34px]">
              {c.spark ? <Sparkline data={c.spark} color={c.color} /> : null}
            </div>
          </Card>
        ))}
      </div>

      {/* leads by stage */}
      <Card className="px-6 py-[22px]">
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="m-0 text-lg font-medium">Leads by stage</h2>
          <span className="font-mono text-xs text-muted">{num(stageTotal)} total</span>
        </div>
        <div className="flex flex-col gap-[15px]">
          {stages.map((s) => (
            <div key={s.key} className="flex items-center gap-4">
              <div className="w-[108px] flex-none">
                <Badge kind="lead" value={s.key} />
              </div>
              <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-lavender">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(s.count / stageMax) * 100}%`,
                    background: STAGE_COLORS[s.key],
                  }}
                />
              </div>
              <div className="w-[120px] flex-none text-right font-mono text-[13px] text-ink">
                {num(s.count)}
                <span className="text-[11px] text-muted">
                  {" "}
                  · {stageTotal ? Math.round((s.count / stageTotal) * 100) : 0}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
