// Pure month-grid math for the Calendar view. Everything here treats "YYYY-MM-DD" /
// "YYYY-MM" as opaque calendar strings — Olivia already localizes event date/time to the
// client's timezone, so no value in this module may pass through the browser timezone.
// (Date.UTC is used strictly as calendar arithmetic on the literal Y-M-D digits.)

import type { CalendarEvent } from "@/lib/types";

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface MonthCell {
  ymd: string; // YYYY-MM-DD
  inMonth: boolean; // false for dimmed leading/trailing days
}

const pad = (n: number) => String(n).padStart(2, "0");

export function ymdOf(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parts(ym: string): { year: number; month: number } {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7));
  return { year, month };
}

export function daysInMonth(ym: string): number {
  const { year, month } = parts(ym);
  // Day 0 of the next month = last day of this month (pure calendar arithmetic).
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "YYYY-MM" + n months (n may be negative). */
export function addMonths(ym: string, n: number): string {
  const { year, month } = parts(ym);
  const idx = year * 12 + (month - 1) + n;
  const y = Math.floor(idx / 12);
  const m = (idx % 12 + 12) % 12 + 1;
  return `${y}-${pad(m)}`;
}

/** "2026-07" → "July 2026". */
export function monthLabel(ym: string): string {
  const { year, month } = parts(ym);
  return `${new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  })} ${year}`;
}

/** "YYYY-MM-DD" → "Mon, Jul 6" (calendar-day label for the right rail). */
export function dayLabel(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Monday-first day-of-week index 0..6 for a calendar day. */
export function mondayIndex(ymd: string): number {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return (dow + 6) % 7;
}

/**
 * The 7-column Mon–Sun month grid: full weeks covering the month, with leading/trailing
 * days from the neighboring months marked inMonth:false. Always a multiple of 7 cells.
 */
export function buildMonthGrid(ym: string): MonthCell[] {
  const { year, month } = parts(ym);
  const total = daysInMonth(ym);
  const lead = mondayIndex(ymdOf(year, month, 1));
  const cells: MonthCell[] = [];

  const prev = addMonths(ym, -1);
  const prevDays = daysInMonth(prev);
  const { year: py, month: pm } = parts(prev);
  for (let i = lead - 1; i >= 0; i--) {
    cells.push({ ymd: ymdOf(py, pm, prevDays - i), inMonth: false });
  }
  for (let d = 1; d <= total; d++) {
    cells.push({ ymd: ymdOf(year, month, d), inMonth: true });
  }
  const next = addMonths(ym, 1);
  const { year: ny, month: nm } = parts(next);
  for (let d = 1; cells.length % 7 !== 0; d++) {
    cells.push({ ymd: ymdOf(ny, nm, d), inMonth: false });
  }
  return cells;
}

/** Today's calendar day in an IANA timezone (the workspace's tz, NOT the browser's). */
export function todayYmdInTz(tz: string, now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Events keyed by their (already client-local) date, each day sorted by time. */
export function groupEventsByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = byDay.get(e.date);
    if (list) list.push(e);
    else byDay.set(e.date, [e]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.time.localeCompare(b.time));
  }
  return byDay;
}

/**
 * Display title — locked events arrive without one; fall back to a service label.
 * Upstream composes titles as "Name — Service - Name" (the lead name twice); collapse
 * that to "Name — Service". Only the exact pattern is touched: the tail must equal the
 * leading name (case-insensitive) and be preceded by a dash-like separator.
 */
export function eventTitle(e: Pick<CalendarEvent, "title">): string {
  const raw = e.title?.trim();
  if (!raw) return "Booking";

  const sep = " — ";
  const i = raw.indexOf(sep);
  if (i <= 0) return raw;
  const name = raw.slice(0, i).trim();
  const rest = raw.slice(i + sep.length).trim();
  if (!rest.toLowerCase().endsWith(name.toLowerCase())) return raw;

  const beforeDupe = rest.slice(0, rest.length - name.length).trimEnd();
  if (beforeDupe === "") return name; // "Name — Name"
  if (!/[-–—·|:]$/.test(beforeDupe)) return raw; // tail only *contains* the name — not the pattern
  const service = beforeDupe.replace(/[\s\-–—·|:]+$/, "");
  return service ? `${name}${sep}${service}` : name;
}
