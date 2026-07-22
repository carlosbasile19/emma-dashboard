import { BriefEmma } from "@/components/dashboard/brief/BriefEmma";
import { ReportEmma } from "@/components/dashboard/report/ReportEmma";
import { Sparkline } from "@/components/charts/Sparkline";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states/EmptyState";
import { ErrorState } from "@/components/ui/states/ErrorState";
import { FreshnessNote } from "@/components/ui/FreshnessNote";
import { getWorkspace } from "@/lib/auth";
import { EMPTY_COPY, ERROR_COPY, RANGE_LABELS } from "@/lib/copy";
import { DEFAULT_TZ, parseRange, prevPeriod, rangeToPeriod } from "@/lib/filters";
import { centsToMoney, num, pct } from "@/lib/format";
import { buildNutshell } from "@/lib/narrate";
import {
  fetchAgents,
  fetchCampaigns,
  fetchLeads,
  fetchOverview,
  fetchTimeseries,
} from "@/lib/olivia/service";
import { buildBriefItems, buildKpiCards } from "@/lib/overview";
import { LEAD_STATUSES } from "@/lib/types";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function OverviewPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const rangeLabel = RANGE_LABELS[range] ?? "Last 30 days";
  const ws = await getWorkspace();
  const tz = ws.timezone ?? DEFAULT_TZ;

  let cur, prev, ts, campaigns, agentsRes, leadsRes;
  try {
    [cur, prev, ts, campaigns, agentsRes, leadsRes] = await Promise.all([
      fetchOverview(rangeToPeriod(range, tz)),
      fetchOverview(prevPeriod(range, tz)),
      fetchTimeseries(rangeToPeriod(range, tz)),
      // campaigns power the brief; don't fail the whole overview if they error
      fetchCampaigns().catch(() => null),
      // agents power the reporting drill-down selector; best-effort
      fetchAgents(rangeToPeriod(range, tz)).catch(() => null),
      // leads power the brief's per-lead motivation/hesitation lines; best-effort
      fetchLeads({ ...rangeToPeriod(range, tz), limit: 100 }).catch(() => null),
    ]);
  } catch {
    return <ErrorState copy={ERROR_COPY.overview} />;
  }

  const ov = cur.data;
  const k = ov.kpis;
  // Stage counts still feed the has-any-data check even though the stage card is gone.
  const stageTotal = LEAD_STATUSES.reduce((a, key) => a + (k.leads_by_stage[key] ?? 0), 0);

  if (k.leads_total === 0 && k.calls_total === 0 && stageTotal === 0) {
    return <EmptyState copy={EMPTY_COPY.overview} />;
  }

  const cards = buildKpiCards(ov, prev.data, ts.data);
  const briefItems = buildBriefItems(ov, campaigns?.data ?? [], leadsRes?.data.items ?? []);
  const reportAgents = (agentsRes?.data ?? []).map((a) => ({ id: a.agent_id, name: a.name }));
  // Seed the reporting preview with the dashboard range's nutshell; the modal refreshes it
  // per-window when a report starts.
  const reportNutshell = buildNutshell(k, prev.data.kpis);

  return (
    <>
      <FreshnessNote freshness={cur.freshness} />

      {/* hero band */}
      <div className="relative mb-[22px] overflow-hidden rounded-[16px] bg-ink px-8 py-7 shadow-ink">
        <div className="absolute -right-16 -top-44 h-[380px] w-[380px] rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.55),transparent_62%)]" />
        <div className="absolute -bottom-44 left-[18%] h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(255,61,119,0.32),transparent_64%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-7">
          <div className="max-w-[540px]">
            <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.16em] text-violet-light">
              {rangeLabel} · {ws.name}
            </div>
            <div className="text-[34px] font-bold leading-[1.1] tracking-[-0.02em] text-white text-balance">
              {num(k.converted_count)} leads converted — while you ran the practice.
            </div>
            <div className="mt-3.5 max-w-[480px] text-[15px] leading-[1.5] text-[#B7C3C4]">
              Emma picked up, called back and followed through on every channel. Here’s the
              period at a glance.
            </div>
            <div className="flex flex-wrap items-center">
              <BriefEmma items={briefItems} rangeLabel={rangeLabel} range={range} />
              <ReportEmma range={range} agents={reportAgents} nutshell={reportNutshell} />
            </div>
          </div>
          <div className="flex gap-[30px] font-mono">
            <HeroStat value={pct(k.pickup_rate)} label="pickup rate" />
            <HeroStat value={pct(k.bookings_rate)} label="bookings rate" violet />
            <HeroStat
              value={centsToMoney(k.spend.total_cents, k.spend.currency)}
              label="billed spend"
            />
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
              {c.unit ? <span className="font-mono text-base text-muted">{c.unit}</span> : null}
            </div>
            <div className="h-[34px]">
              {c.spark ? <Sparkline data={c.spark} color={c.color} /> : null}
            </div>
          </Card>
        ))}
      </div>

    </>
  );
}

function HeroStat({
  value,
  label,
  violet,
}: {
  value: string;
  label: string;
  violet?: boolean;
}) {
  return (
    <div>
      <div
        className={`text-[30px] tracking-[-0.01em] ${violet ? "text-violet-light" : "text-white"}`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11px] uppercase tracking-[0.08em] text-[#8FA1A3]">
        {label}
      </div>
    </div>
  );
}
