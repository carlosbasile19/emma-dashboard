"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_PALETTE } from "@/lib/design";
import { formatDayLabel } from "@/lib/filters";
import { num } from "@/lib/format";
import type { DailyTrendPoint } from "@/lib/types";

// Fixed series→color assignment (design-system categorical order, never cycled).
const SERIES: Array<{ key: keyof Omit<DailyTrendPoint, "date">; label: string; color: string }> = [
  { key: "bookings", label: "Bookings", color: CHART_PALETTE[0] }, // #6D4AFF
  { key: "calls", label: "Calls", color: CHART_PALETTE[1] }, // #2E86F2
  { key: "picked_up", label: "Picked up", color: CHART_PALETTE[2] }, // #0FB5AE
];

function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number | string; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-[10px] border border-ink/10 bg-white px-3 py-2.5 shadow-md">
      <div className="mb-1.5 font-mono text-[11px] text-muted">{formatDayLabel(label)}</div>
      {SERIES.map((s) => {
        const row = payload.find((p) => p.dataKey === s.key);
        if (!row) return null;
        return (
          <div key={s.key} className="flex items-center gap-2 py-px text-[12.5px]">
            <span className="h-2 w-2 flex-none rounded-full" style={{ background: s.color }} />
            <span className="flex-1 pr-3 text-ink">{s.label}</span>
            <span className="font-mono text-xs text-ink">{num(Number(row.value ?? 0))}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Multi-line daily trend (bookings / calls / picked up) over the active range. */
export function TrendLines({ data }: { data: DailyTrendPoint[] }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[12.5px] text-ink">
            <span className="h-2 w-2 flex-none rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: -14 }}>
            <CartesianGrid vertical={false} stroke="rgba(26,43,46,0.07)" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDayLabel}
              tick={{ fontSize: 10, fill: "#5C6B6D", fontFamily: "var(--font-space-mono)" }}
              tickLine={false}
              axisLine={{ stroke: "rgba(26,43,46,0.12)" }}
              minTickGap={28}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 10, fill: "#5C6B6D", fontFamily: "var(--font-space-mono)" }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip
              content={<TrendTooltip />}
              cursor={{ stroke: "rgba(26,43,46,0.18)", strokeDasharray: "3 3" }}
            />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
