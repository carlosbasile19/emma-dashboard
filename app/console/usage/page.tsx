import { UsageView } from "@/components/console/UsageView";
import { refreshAgencyClients } from "@/lib/olivia/agency";
import { buildUsageRows, columnTotals, getUsageReport } from "@/lib/olivia/usage";
import { resolveUsagePeriod, type MonthKey } from "@/lib/usage";

/** Today as a UTC day, matching how every other period in this app is built. */
function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

  // Keeps the mirror (and each workspace's opened_at) current; no-op unless >10 min old.
  await refreshAgencyClients().catch(() => {});

  const today = todayYmd();
  const period = resolveUsagePeriod(
    { month: one(sp.month), from: one(sp.from), to: one(sp.to) },
    today,
  );

  // One fetch per client covers both blocks: the report spans the whole history (always through
  // today, whatever period is selected), and the period is summed out of the same daily rows.
  const report = await getUsageReport(period, today);
  const rows = buildUsageRows(report, period);

  const currentMonth: MonthKey = today.slice(0, 7);
  const periodTotal = report.failed.length > 0
    ? null
    : rows.reduce((a, r) => a + (r.periodCents ?? 0), 0);

  const exportHref = (view: "period" | "history") => {
    const q = new URLSearchParams({ view, from: period.from, to: period.to });
    if (period.month) q.set("month", period.month);
    return `/console/usage/export?${q}`;
  };

  return (
    <UsageView
      rows={rows}
      months={report.months}
      monthColumnTotals={columnTotals(rows, report.months)}
      periodTotal={periodTotal}
      period={period}
      currentMonth={currentMonth}
      pickerMonths={[...report.months].reverse()}
      failed={report.failed}
      currency={report.currency}
      exportHref={exportHref}
      monthHref={(m) => `/console/usage?month=${m}`}
    />
  );
}
