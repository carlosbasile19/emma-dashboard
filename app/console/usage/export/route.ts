import { requireAdmin } from "@/lib/auth";
import { buildUsageRows, getUsageReport } from "@/lib/olivia/usage";
import {
  monthBounds,
  resolveUsagePeriod,
  usageCsv,
  type UsageCsvRow,
} from "@/lib/usage";

/**
 * CSV export for the usage report. Admin-only, same data as the screen.
 *
 * `view=period` → one row per client for the selected window (the invoice run).
 * `view=history` → one row per client per calendar month (the true-up).
 *
 * Both share a column set so the two files stack in one sheet, and neither carries a totals
 * row — a totals row breaks SUM() over the column and corrupts pivot tables, which is what
 * this file is for.
 */
export async function GET(request: Request) {
  // The console layout already gates on admin; this route is reachable directly, so it gates
  // again rather than trusting the referrer.
  await requireAdmin();

  const url = new URL(request.url);
  const p = (k: string) => url.searchParams.get(k) ?? undefined;
  const today = new Date().toISOString().slice(0, 10);
  const period = resolveUsagePeriod({ month: p("month"), from: p("from"), to: p("to") }, today);
  const history = p("view") === "history";

  const report = await getUsageReport(period.from, period.to);
  const rows = buildUsageRows(report, period);

  const csvRows: UsageCsvRow[] = history
    ? rows.flatMap((r) =>
        report.months.flatMap((month, i): UsageCsvRow[] => {
          const cell = r.monthCells[i];
          // A month before the workspace opened produces no row at all — an empty row would
          // imply a billable period that did not exist.
          if (!cell || cell.kind === "before-open") return [];
          const { from, to } = monthBounds(month);
          return [
            {
              clientName: r.name,
              clientId: r.id,
              period: month,
              from,
              to,
              tz: r.tz,
              currency: report.currency,
              basis: report.basis,
              cents: cell.kind === "value" ? cell.cents : null,
            },
          ];
        }),
      )
    : rows.map((r) => ({
        clientName: r.name,
        clientId: r.id,
        period: `${period.from}..${period.to}`,
        from: period.from,
        to: period.to,
        tz: r.tz,
        currency: report.currency,
        basis: report.basis,
        cents: r.periodCents,
      }));

  const slug = history ? `history-to-${period.to}` : `${period.from}_${period.to}`;
  return new Response(usageCsv(csvRows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="emma-usage-${slug}.csv"`,
      // Billing figures must not be served from a shared or browser cache.
      "Cache-Control": "no-store, private",
    },
  });
}
