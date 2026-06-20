"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

// Donut with a background track ring (design `donut`). Parent controls size.
// The center label is rendered by the caller as an absolutely-positioned overlay.
export function Donut({
  segments,
  dark = false,
}: {
  segments: DonutSegment[];
  dark?: boolean;
}) {
  const track = dark ? "rgba(255,255,255,0.10)" : "#ECEAF7";
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        {/* background track */}
        <Pie
          data={[{ value: 1 }]}
          dataKey="value"
          cx="50%"
          cy="50%"
          innerRadius="72%"
          outerRadius="100%"
          fill={track}
          stroke="none"
          isAnimationActive={false}
        />
        {/* value segments */}
        <Pie
          data={total > 0 ? segments : [{ label: "", value: 1, color: track }]}
          dataKey="value"
          cx="50%"
          cy="50%"
          innerRadius="72%"
          outerRadius="100%"
          paddingAngle={2}
          cornerRadius={6}
          startAngle={90}
          endAngle={-270}
          stroke="none"
          isAnimationActive={false}
        >
          {(total > 0 ? segments : [{ color: track }]).map((s, i) => (
            <Cell key={i} fill={s.color} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
