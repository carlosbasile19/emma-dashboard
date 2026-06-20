import { TrendChart, type TrendPoint } from "@/components/charts/TrendChart";
import { Card } from "@/components/ui/Card";
import { RANGE_LABELS } from "@/lib/copy";
import { centsToMoney, num } from "@/lib/format";
import { sampleTimeseries } from "@/lib/sample-data";

type SP = Promise<Record<string, string | string[] | undefined>>;

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

// Momentum: second half of the window vs. first half (derived from the series shown).
function momentum(values: number[]): { text: string; up: boolean } | undefined {
  if (values.length < 4) return undefined;
  const mid = Math.floor(values.length / 2);
  const first = sum(values.slice(0, mid));
  const second = sum(values.slice(mid));
  if (!first) return undefined;
  const d = ((second - first) / first) * 100;
  return { text: `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`, up: d >= 0 };
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export default async function TrendsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const range = typeof sp.range === "string" ? sp.range : "30d";
  const rangeLabel = RANGE_LABELS[range] ?? "Last 30 days";

  const s = sampleTimeseries.series;
  const dates = s.map((p) => p.date);
  const pt = (vals: number[]): TrendPoint[] =>
    s.map((p, i) => ({ date: p.date, value: vals[i] ?? 0 }));

  const calls = s.map((p) => p.calls);
  const pickups = s.map((p) => p.picked_up);
  const bookings = s.map((p) => p.bookings);
  const spend = s.map((p) => p.spend_cents);

  const cards = [
    { key: "calls", label: "Calls placed", color: "#6D4AFF", points: pt(calls), total: num(sum(calls)), mom: momentum(calls) },
    { key: "pickups", label: "Pickups", color: "#0FB5AE", points: pt(pickups), total: num(sum(pickups)), mom: momentum(pickups) },
    { key: "bookings", label: "Bookings", color: "#E8A33D", points: pt(bookings), total: num(sum(bookings)), mom: momentum(bookings) },
    { key: "spend", label: "Billed spend", color: "#B56BE0", points: pt(spend), total: centsToMoney(sum(spend)), mom: momentum(spend) },
  ];

  const labels = dates.length
    ? [dates[0]!, dates[Math.floor(dates.length / 2)]!, dates[dates.length - 1]!]
    : [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 text-lg font-medium">Daily activity</h2>
          <div className="mt-1 text-[13px] text-muted">
            One data point per day · {rangeLabel}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {cards.map((c) => (
          <Card key={c.key} className="px-5 py-[18px]">
            <div className="mb-3.5 flex items-start justify-between">
              <div>
                <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
                  {c.label}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[28px] font-medium tracking-[-0.01em]">
                    {c.total}
                  </span>
                  {c.mom ? (
                    <span
                      className="font-mono text-xs"
                      style={{ color: c.mom.up ? "#2BB673" : "#E5484D" }}
                    >
                      {c.mom.text}
                    </span>
                  ) : null}
                </div>
              </div>
              <span
                className="mt-1 h-2.5 w-2.5 rounded-[3px]"
                style={{ background: c.color }}
              />
            </div>
            <div className="h-[150px]">
              <TrendChart data={c.points} color={c.color} id={c.key} />
            </div>
            {labels.length === 3 ? (
              <div className="mt-2 flex justify-between font-mono text-[10.5px] text-muted">
                <span>{dayLabel(labels[0]!)}</span>
                <span>{dayLabel(labels[1]!)}</span>
                <span>{dayLabel(labels[2]!)}</span>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </>
  );
}
