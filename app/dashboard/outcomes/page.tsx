import { Donut, type DonutSegment } from "@/components/charts/Donut";
import { TrendLines } from "@/components/charts/TrendLines";
import { BestTimesHeatmap } from "@/components/dashboard/outcomes/BestTimesHeatmap";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states/EmptyState";
import { ErrorState } from "@/components/ui/states/ErrorState";
import { FreshnessNote } from "@/components/ui/FreshnessNote";
import { getWorkspace } from "@/lib/auth";
import { EMPTY_COPY, ERROR_COPY, RANGE_LABELS } from "@/lib/copy";
import { BADGE_COLORS, CHART_PALETTE } from "@/lib/design";
import { DEFAULT_TZ, parseRange, rangeToPeriod } from "@/lib/filters";
import { fmtEnum, num } from "@/lib/format";
import { fetchOutcomes } from "@/lib/olivia/service";

type SP = Promise<Record<string, string | string[] | undefined>>;

function toSegments(
  record: Record<string, number | undefined>,
  colors: Record<string, string>,
): DonutSegment[] {
  return Object.entries(record)
    .filter(([, v]) => (v ?? 0) > 0)
    .map(([key, value], i) => ({
      label: fmtEnum(key),
      value: value ?? 0,
      color: colors[key] ?? CHART_PALETTE[i % CHART_PALETTE.length]!,
    }))
    .sort((a, b) => b.value - a.value);
}

export default async function OutcomesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const ws = await getWorkspace();
  const tz = ws.timezone ?? DEFAULT_TZ;

  let result;
  try {
    result = await fetchOutcomes(rangeToPeriod(range, tz));
  } catch {
    return <ErrorState copy={ERROR_COPY.outcomes} />;
  }

  const o = result.data.outcomes;
  const calls = toSegments(o.call_outcomes, BADGE_COLORS.call);
  const disp = toSegments(o.call_dispositions, BADGE_COLORS.disp);
  const book = toSegments(o.booking_outcomes, BADGE_COLORS.booking);

  if (calls.length === 0 && disp.length === 0 && book.length === 0) {
    return <EmptyState copy={EMPTY_COPY.outcomes} />;
  }

  const rangeLabel = RANGE_LABELS[range] ?? "Last 30 days";
  const trend = result.data.daily_trend;
  const bestTimes = result.data.best_times;
  const hasBestTimesData = !!bestTimes?.some((row) => row?.some((v) => v != null));

  return (
    <>
      <FreshnessNote freshness={result.freshness} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
        <OutcomeCard title="Call outcomes" noun="calls" dark segments={calls} />
        <OutcomeCard title="Call dispositions" noun="dispositions" segments={disp} />
        <OutcomeCard title="Booking outcomes" noun="bookings" segments={book} />
      </div>

      {/* Extended metrics — rendered only when the backend supplies them, so a
          pre-extension payload (or an older cached one) degrades to the donuts alone. */}
      {trend && trend.length > 0 ? (
        <Card className="mt-4 px-6 py-[22px]">
          <div className="mb-[18px] flex items-baseline justify-between">
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
              Daily trend
            </div>
            <span className="font-mono text-xs text-muted">{rangeLabel}</span>
          </div>
          <TrendLines data={trend} />
        </Card>
      ) : null}

      {bestTimes ? (
        <Card className="mt-4 px-6 py-[22px]">
          <div className="mb-[18px] flex items-baseline justify-between">
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
              Best times to call
            </div>
            <span className="font-mono text-xs text-muted">
              {rangeLabel} · {result.data.period.tz}
            </span>
          </div>
          {hasBestTimesData ? (
            <BestTimesHeatmap
              bestTimes={bestTimes}
              bestTimesCalls={result.data.best_times_calls}
            />
          ) : (
            <div className="rounded-[10px] bg-warm px-4 py-6 text-center text-[13px] text-muted">
              Not enough answered calls in this window to map pickup patterns yet.
            </div>
          )}
        </Card>
      ) : null}
    </>
  );
}

function OutcomeCard({
  title,
  noun,
  segments,
  dark = false,
}: {
  title: string;
  noun: string;
  segments: DonutSegment[];
  dark?: boolean;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const labelColor = dark ? "text-violet-light" : "text-muted";
  const rowText = dark ? "text-[#D8DEDE]" : "text-ink";
  const valText = dark ? "text-white" : "text-ink";
  const pctText = dark ? "text-[#8FA1A3]" : "text-muted";

  const body = (
    <>
      <div className={`mb-[18px] font-mono text-[11px] uppercase tracking-[0.12em] ${labelColor}`}>
        {title}
      </div>
      <div className="relative mx-auto mb-[18px] h-[170px] w-[170px]">
        <Donut segments={segments} dark={dark} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`font-mono text-[26px] font-medium ${dark ? "text-white" : "text-ink"}`}
          >
            {num(total)}
          </span>
          <span className={`text-[11px] ${pctText}`}>{noun}</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-[9px]">
            <span
              className="h-[9px] w-[9px] flex-none rounded-[3px]"
              style={{ background: s.color }}
            />
            <span className={`flex-1 text-[13px] ${rowText}`}>{s.label}</span>
            <span className={`font-mono text-xs ${valText}`}>{num(s.value)}</span>
            <span className={`w-9 text-right font-mono text-[11px] ${pctText}`}>
              {total ? Math.round((s.value / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </>
  );

  if (dark) {
    return (
      <div className="relative overflow-hidden rounded-[16px] bg-ink px-6 py-[22px] shadow-ink">
        <div className="absolute -right-16 -top-32 h-[220px] w-[220px] rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.42),transparent_64%)]" />
        <div className="relative">{body}</div>
      </div>
    );
  }
  return <Card className="px-6 py-[22px]">{body}</Card>;
}
