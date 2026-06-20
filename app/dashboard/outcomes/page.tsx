import { Donut, type DonutSegment } from "@/components/charts/Donut";
import { Card } from "@/components/ui/Card";
import { BADGE_COLORS, CHART_PALETTE } from "@/lib/design";
import { fmtEnum, num } from "@/lib/format";

import { sampleOutcomes } from "@/lib/sample-data";

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

export default function OutcomesPage() {
  const o = sampleOutcomes.outcomes;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
      <OutcomeCard
        title="Call outcomes"
        noun="calls"
        dark
        segments={toSegments(o.call_outcomes, BADGE_COLORS.call)}
      />
      <OutcomeCard
        title="Call dispositions"
        noun="dispositions"
        segments={toSegments(o.call_dispositions, BADGE_COLORS.disp)}
      />
      <OutcomeCard
        title="Booking outcomes"
        noun="bookings"
        segments={toSegments(o.booking_outcomes, BADGE_COLORS.booking)}
      />
    </div>
  );
}
