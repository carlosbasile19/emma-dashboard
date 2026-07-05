import { CalendarView } from "@/components/dashboard/calendar/CalendarView";
import { EmptyState } from "@/components/ui/states/EmptyState";
import { ErrorState } from "@/components/ui/states/ErrorState";
import { FreshnessNote } from "@/components/ui/FreshnessNote";
import { getWorkspace } from "@/lib/auth";
import { MONTH_RE, todayYmdInTz } from "@/lib/calendar";
import { EMPTY_COPY, ERROR_COPY } from "@/lib/copy";
import { DEFAULT_TZ } from "@/lib/filters";
import { fetchCalendar } from "@/lib/olivia/service";

type SP = Promise<Record<string, string | string[] | undefined>>;

const UPCOMING_LIMIT = 5;

export default async function CalendarPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ws = await getWorkspace();
  const tz = ws.timezone ?? DEFAULT_TZ;
  // "Today" in the WORKSPACE timezone — event dates are client-local strings, so the
  // highlighted day must come from the same clock, never the browser's.
  const todayYmd = todayYmdInTz(tz);
  const rawMonth = typeof sp.month === "string" ? sp.month : "";
  const month = MONTH_RE.test(rawMonth) ? rawMonth : todayYmd.slice(0, 7);

  let result;
  try {
    result = await fetchCalendar({ month, upcoming_limit: UPCOMING_LIMIT });
  } catch {
    return <ErrorState copy={ERROR_COPY.calendar} />;
  }

  const { events, upcoming, locked } = result.data;
  // A workspace with no bookings at all (this month AND nothing upcoming) gets the full
  // empty state; a merely-quiet month keeps the grid so the user can navigate months.
  if (events.length === 0 && upcoming.length === 0) {
    return <EmptyState copy={EMPTY_COPY.calendar} />;
  }

  return (
    <>
      <FreshnessNote freshness={result.freshness} />
      <CalendarView
        key={month} // remount on month nav so the selected-day state resets with the grid
        month={month}
        events={events}
        upcoming={upcoming}
        todayYmd={todayYmd}
        workspaceName={ws.name}
        locked={locked ?? false}
      />
    </>
  );
}
