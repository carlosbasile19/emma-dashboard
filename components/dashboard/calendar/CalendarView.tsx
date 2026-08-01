"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { useNavigate } from "@/components/ui/states/PendingNav";
import {
  addMonths,
  buildMonthGrid,
  dayLabel,
  eventTitle,
  groupEventsByDay,
  monthLabel,
} from "@/lib/calendar";
import { CALENDAR_EVENT_COLORS, tint } from "@/lib/design";
import { fmtEnum, num } from "@/lib/format";
import type { CalendarEvent } from "@/lib/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 2;
const VIEWS = ["Month", "Week", "Day"] as const;

function chipColor(status: string): string {
  return CALENDAR_EVENT_COLORS[status] ?? "#5C6B6D";
}

export function CalendarView({
  month,
  events,
  upcoming,
  todayYmd,
  locked,
}: {
  month: string; // YYYY-MM
  events: CalendarEvent[];
  upcoming: CalendarEvent[];
  todayYmd: string; // today in the WORKSPACE tz
  locked: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const navigate = useNavigate();

  const cells = useMemo(() => buildMonthGrid(month), [month]);
  const byDay = useMemo(() => groupEventsByDay(events), [events]);

  const [selected, setSelected] = useState<string>(() =>
    todayYmd.slice(0, 7) === month ? todayYmd : `${month}-01`,
  );

  const gotoMonth = (ym: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (ym) next.set("month", ym);
    else next.delete("month");
    const qs = next.toString();
    navigate(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const selectedEvents = byDay.get(selected) ?? [];

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.9fr_1fr]">
      <div className="min-w-0">
        {/* header row: month nav · view toggle */}
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-[10px] border border-ink/10 bg-white p-[3px]">
              <button
                onClick={() => gotoMonth(addMonths(month, -1))}
                aria-label="Previous month"
                className="cursor-pointer rounded-[7px] px-2.5 py-1 text-sm text-muted transition-colors hover:bg-lavender"
              >
                ‹
              </button>
              <span className="min-w-[132px] px-1 text-center text-sm font-semibold tracking-[-0.01em]">
                {monthLabel(month)}
              </span>
              <button
                onClick={() => gotoMonth(addMonths(month, 1))}
                aria-label="Next month"
                className="cursor-pointer rounded-[7px] px-2.5 py-1 text-sm text-muted transition-colors hover:bg-lavender"
              >
                ›
              </button>
            </div>
            <button
              onClick={() => {
                gotoMonth(null);
                setSelected(todayYmd);
              }}
              className="cursor-pointer rounded-[10px] border border-ink/10 bg-white px-[11px] py-[7px] font-mono text-xs text-ink transition-colors hover:bg-lavender"
            >
              Today
            </button>
            <div className="flex gap-0.5 rounded-[10px] border border-ink/10 bg-white p-[3px]">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  disabled={v !== "Month"}
                  title={v === "Month" ? undefined : "Coming soon"}
                  className={`rounded-[7px] px-[11px] py-1.5 font-mono text-xs transition-colors ${
                    v === "Month"
                      ? "cursor-pointer bg-ink text-white"
                      : "cursor-not-allowed text-muted/50"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* month grid */}
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-ink/10">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="px-2 py-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((cell, i) => {
              const dayEvents = byDay.get(cell.ymd) ?? [];
              const isToday = cell.ymd === todayYmd;
              const isSelected = cell.ymd === selected;
              const overflow = dayEvents.length - MAX_CHIPS;
              return (
                <button
                  key={cell.ymd}
                  onClick={() => setSelected(cell.ymd)}
                  className={`flex min-h-[92px] cursor-pointer flex-col items-stretch gap-1 border-ink/10 p-1.5 text-left align-top transition-colors ${
                    i % 7 !== 0 ? "border-l" : ""
                  } ${i >= 7 ? "border-t" : ""} ${
                    isSelected ? "bg-lavender/60" : "hover:bg-lavender/35"
                  } ${cell.inMonth ? "" : "bg-warm/60"}`}
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11.5px] ${
                      isToday
                        ? "bg-violet font-bold text-white"
                        : cell.inMonth
                          ? "text-ink"
                          : "text-muted/50"
                    }`}
                  >
                    {Number(cell.ymd.slice(8, 10))}
                  </span>
                  {dayEvents.slice(0, MAX_CHIPS).map((e) => (
                    <span
                      key={e.id}
                      title={`${e.time} · ${eventTitle(e)}`}
                      className="truncate rounded-[6px] px-1.5 py-[3px] text-[10.5px] font-medium leading-tight"
                      style={{
                        color: chipColor(e.status),
                        background: tint(chipColor(e.status), 0.12),
                      }}
                    >
                      {e.time} {eventTitle(e)}
                    </span>
                  ))}
                  {overflow > 0 ? (
                    <span className="px-1.5 font-mono text-[10px] text-muted">
                      +{overflow} more
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {/* status legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-ink/10 px-4 py-2.5">
            {Object.entries(CALENDAR_EVENT_COLORS).map(([status, color]) => (
              <span key={status} className="flex items-center gap-1.5 text-[11px] text-muted">
                <span
                  className="h-2 w-2 flex-none rounded-full"
                  style={{ background: color }}
                />
                {fmtEnum(status)}
              </span>
            ))}
            {locked ? (
              <span className="ml-auto flex items-center gap-1.5 font-mono text-[10.5px] text-muted">
                <LockIcon />
                PII locked — bookings show service labels only
              </span>
            ) : null}
          </div>
        </Card>
      </div>

      {/* right rail — min-w-0 so long nowrap booking titles can't inflate the grid item's
          auto minimum and crush the 1.9fr month column (same reason as min-w-0 on the left) */}
      <div className="min-w-0 flex flex-col gap-4">
        <Card className="px-5 py-[18px]">
          <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
            Selected day
          </div>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-[17px] font-semibold tracking-[-0.01em]">
              {dayLabel(selected)}
            </span>
            <span className="font-mono text-xs text-muted">
              {num(selectedEvents.length)}{" "}
              {selectedEvents.length === 1 ? "booking" : "bookings"}
            </span>
          </div>
          {selectedEvents.length === 0 ? (
            <div className="rounded-[10px] bg-warm px-3.5 py-4 text-center text-[13px] text-muted">
              No bookings this day.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {selectedEvents.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </div>
          )}
        </Card>

        <Card className="px-5 py-[18px]">
          <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
            Upcoming
          </div>
          {upcoming.length === 0 ? (
            <div className="rounded-[10px] bg-warm px-3.5 py-4 text-center text-[13px] text-muted">
              Nothing scheduled ahead.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {upcoming.map((e) => (
                <EventRow key={e.id} event={e} withDate />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function EventRow({ event, withDate = false }: { event: CalendarEvent; withDate?: boolean }) {
  const color = chipColor(event.status);
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] border border-ink/10 px-3 py-2.5">
      <span className="h-2 w-2 flex-none rounded-full" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{eventTitle(event)}</div>
        <div className="font-mono text-[11px] text-muted">
          {withDate ? `${dayLabel(event.date)} · ` : ""}
          {event.time}
          {event.duration_min ? ` · ${event.duration_min} min` : ""}
        </div>
      </div>
      <span
        className="flex-none rounded-full px-2 py-[2px] text-[10.5px] font-medium"
        style={{ color, background: tint(color, 0.1) }}
      >
        {fmtEnum(event.status)}
      </span>
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="9" width="12" height="8" rx="2" />
      <path d="M7 9V6a3 3 0 016 0v3" />
    </svg>
  );
}
