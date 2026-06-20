import { Card } from "@/components/ui/Card";
import { RANGE_LABELS } from "@/lib/copy";
import { STAGE_COLORS } from "@/lib/design";
import { num } from "@/lib/format";
import { sampleFunnel } from "@/lib/sample-data";

type SP = Promise<Record<string, string | string[] | undefined>>;

const STEP_KEYS = ["new", "contacted", "qualified", "booked", "converted"] as const;
const STEP_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  booked: "Booked",
  converted: "Converted",
};

export default async function FunnelPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const range = typeof sp.range === "string" ? sp.range : "30d";
  const rangeLabel = RANGE_LABELS[range] ?? "Last 30 days";

  const f = sampleFunnel.funnel;
  const top = f.new ?? 0;
  const steps = STEP_KEYS.map((key, i) => {
    const count = f[key] ?? 0;
    const prev = i > 0 ? (f[STEP_KEYS[i - 1]!] ?? 0) : count;
    return {
      key,
      label: STEP_LABELS[key]!,
      count,
      pct: top ? Math.round((count / top) * 100) : 0,
      width: top ? (count / top) * 100 : 0,
      drop: i > 0 && prev ? Math.round(((prev - count) / prev) * 100) : 0,
      color: STAGE_COLORS[key]!,
    };
  });

  const converted = f.converted ?? 0;
  const conversionPct = top ? ((converted / top) * 100).toFixed(1) : "0";

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.7fr_1fr]">
      <Card className="px-7 py-6">
        <div className="mb-[22px] flex items-baseline justify-between">
          <h2 className="m-0 text-lg font-medium">Lead funnel</h2>
          <span className="font-mono text-xs text-muted">{rangeLabel}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {steps.map((s) => (
            <div key={s.key}>
              <div className="mb-[7px] flex items-baseline justify-between">
                <span className="text-sm font-medium">{s.label}</span>
                <span className="font-mono text-[13px] text-ink">
                  {num(s.count)}
                  <span className="text-[11px] text-muted"> · {s.pct}%</span>
                </span>
              </div>
              <div className="flex justify-center">
                <div
                  className="h-[46px] min-w-[60px] rounded-[10px] transition-[width] duration-500"
                  style={{ width: `${s.width}%`, background: s.color }}
                />
              </div>
              {s.drop > 0 ? (
                <div className="py-[5px] text-center font-mono text-[10.5px] text-muted">
                  ▼ {s.drop}% drop-off
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-col gap-3.5">
        <div className="relative overflow-hidden rounded-[16px] bg-ink p-6 shadow-ink">
          <div className="absolute -right-16 -top-32 h-60 w-60 rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.5),transparent_62%)]" />
          <div className="relative">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-violet-light">
              New → Converted
            </div>
            <div className="font-mono text-[46px] font-medium tracking-[-0.02em] text-white">
              {conversionPct}%
            </div>
            <div className="mt-2 text-[13.5px] leading-[1.5] text-[#B7C3C4]">
              {num(converted)} of {num(top)} leads went all the way. Every drop-off
              above is a follow-up Emma is still working.
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <Card className="flex-1 px-4 py-[15px]">
            <div className="font-mono text-2xl text-danger">{num(f.lost ?? 0)}</div>
            <div className="mt-1 text-xs text-muted">Lost</div>
          </Card>
          <Card className="flex-1 px-4 py-[15px]">
            <div className="font-mono text-2xl text-ink">{num(f.dnc ?? 0)}</div>
            <div className="mt-1 text-xs text-muted">DNC</div>
          </Card>
        </div>
      </div>
    </div>
  );
}
