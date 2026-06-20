"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export interface TrendPoint {
  date: string;
  value: number;
}

// Area + line trend chart with a soft gradient fill (design `lineChart`).
export function TrendChart({
  data,
  color,
  id,
}: {
  data: TrendPoint[];
  color: string;
  id: string;
}) {
  const gradId = `trend-grad-${id}`;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          vertical={false}
          stroke="#1A2B2E"
          strokeOpacity={0.06}
          strokeWidth={1}
        />
        <Tooltip
          cursor={{ stroke: color, strokeOpacity: 0.25 }}
          contentStyle={{
            borderRadius: 10,
            border: "1px solid rgba(26,43,46,0.12)",
            boxShadow: "0 4px 16px rgba(26,43,46,0.08)",
            fontFamily: "var(--font-space-mono), monospace",
            fontSize: 12,
          }}
          labelStyle={{ color: "#5C6B6D" }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2.4}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill={`url(#${gradId})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
