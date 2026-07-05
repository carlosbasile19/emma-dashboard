// 7×24 "best times to call" heatmap. Sequential single-hue ramp (violet) by pickup
// likelihood; cells fade with small sample sizes; null = no data (neutral, never "0%").
// Pure server-renderable markup — hover detail rides on the native title tooltip.

import {
  apiRowForDisplay,
  cellAlpha,
  cellOpacity,
  cellTitle,
  HEATMAP_DAYS_MON_FIRST,
  hourLabel,
} from "@/lib/best-times";
import { tint } from "@/lib/design";
import type { BestTimesGrid } from "@/lib/types";

const VIOLET = "#6D4AFF";
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function BestTimesHeatmap({
  bestTimes,
  bestTimesCalls,
}: {
  bestTimes: BestTimesGrid;
  bestTimesCalls?: number[][];
}) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: "44px repeat(24, minmax(24px, 1fr))" }}
        >
          {HEATMAP_DAYS_MON_FIRST.map((day, displayRow) => {
            const apiRow = apiRowForDisplay(displayRow);
            const values = bestTimes[apiRow] ?? [];
            const calls = bestTimesCalls?.[apiRow];
            return (
              <div key={day} className="contents">
                <div className="flex items-center pr-2 font-mono text-[10.5px] text-muted">
                  {day}
                </div>
                {HOURS.map((h) => {
                  const v = values[h] ?? null;
                  const n = calls?.[h];
                  return (
                    <div
                      key={h}
                      title={cellTitle(day, h, v, n)}
                      className="h-[26px] rounded-[5px]"
                      style={
                        v == null
                          ? { background: "rgba(26,43,46,0.045)" }
                          : {
                              background: tint(VIOLET, cellAlpha(v)),
                              opacity: cellOpacity(n),
                            }
                      }
                    />
                  );
                })}
              </div>
            );
          })}
          {/* hour axis (every 3h) */}
          <div />
          {HOURS.map((h) => (
            <div key={h} className="pt-1 text-center font-mono text-[9.5px] text-muted">
              {h % 3 === 0 ? hourLabel(h) : ""}
            </div>
          ))}
        </div>

        {/* sequential legend + no-data swatch */}
        <div className="mt-3 flex items-center gap-2.5">
          <span className="font-mono text-[10.5px] text-muted">Low</span>
          <div
            className="h-[10px] w-[120px] rounded-[5px]"
            style={{
              background: `linear-gradient(90deg, ${tint(VIOLET, cellAlpha(0))}, ${tint(
                VIOLET,
                cellAlpha(1),
              )})`,
            }}
          />
          <span className="font-mono text-[10.5px] text-muted">High</span>
          <span className="ml-3 flex items-center gap-1.5 font-mono text-[10.5px] text-muted">
            <span className="h-[10px] w-[18px] rounded-[4px] bg-[rgba(26,43,46,0.045)]" />
            No data
          </span>
          <span className="ml-3 font-mono text-[10.5px] text-muted/80">
            Faded cells = few calls in that hour
          </span>
        </div>
      </div>
    </div>
  );
}
