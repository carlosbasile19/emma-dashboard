import {
  centsToMoneyExact,
  monthLabel,
  type MonthKey,
  type UsageCell,
  type UsagePeriod,
} from "@/lib/usage";
import type { UsageRow } from "@/lib/olivia/usage";
import { ExportButton, MonthPill } from "@/components/console/UsageControls";

/**
 * What the spend figure on this page actually is. Shown verbatim rather than summarised,
 * because someone is about to invoice a client from it.
 */
const BASIS_NOTE =
  "Billed voice & call spend for the window — what Emma charges for calls, with text-to-speech bundled in. Flat monthly maintenance, seats and phone numbers are not included.";

export interface UsageViewProps {
  rows: UsageRow[];
  months: MonthKey[];
  monthColumnTotals: Array<number | null>;
  periodTotal: number | null;
  period: UsagePeriod;
  /** Month the report was generated in — its column is still accruing. */
  currentMonth: MonthKey;
  /** Month pills offered by the picker, newest first. */
  pickerMonths: MonthKey[];
  failed: string[];
  currency: string;
  exportHref: (view: "period" | "history") => string;
  monthHref: (month: MonthKey) => string;
}

export function UsageView({
  rows,
  months,
  monthColumnTotals,
  periodTotal,
  period,
  currentMonth,
  pickerMonths,
  failed,
  currency,
  exportHref,
  monthHref,
}: UsageViewProps) {
  const partial = period.month === currentMonth;

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-2 font-display text-[26px] font-bold tracking-[-0.02em]">
        Usage &amp; billing
      </div>
      <div className="mb-5 text-[14px] text-muted">
        Per-client usage on your own calendar months · export to CSV · history back to each
        workspace opening
      </div>

      {failed.length > 0 ? (
        <div className="mb-5 rounded-[13px] border border-warning/40 bg-warning/10 px-4 py-3">
          <div className="font-display text-[13px] font-semibold text-warning">
            {failed.length === 1 ? "One workspace" : `${failed.length} workspaces`} could not be
            loaded
          </div>
          <div className="mt-1 text-[12.5px] text-ink/75">
            {failed.join(", ")} — shown as “—”, never as $0.00. Reload before invoicing; a missing
            figure is not a zero one.
          </div>
        </div>
      ) : null}

      {/* period picker */}
      <div className="mb-6 rounded-[16px] border border-ink/10 bg-white px-[18px] py-4 shadow-sm">
        <div className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
          Period
        </div>
        <div className="mb-3.5 flex flex-wrap gap-1.5">
          {pickerMonths.map((m) => {
            const on = m === period.month;
            return (
              <MonthPill key={m} href={monthHref(m)} current={on}>
                {monthLabel(m)}
                {m === currentMonth ? (
                  <span className="ml-1.5 font-mono text-[10px] text-muted">to date</span>
                ) : null}
              </MonthPill>
            );
          })}
        </div>

        {/* No JS needed: a GET form puts from/to straight into the URL like every other filter. */}
        <form method="get" className="flex flex-wrap items-end gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
              From
            </span>
            <input
              type="date"
              name="from"
              defaultValue={period.from}
              className="rounded-[9px] border border-ink/10 bg-white px-2.5 py-[6px] font-mono text-[12.5px] text-ink"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
              To
            </span>
            <input
              type="date"
              name="to"
              defaultValue={period.to}
              className="rounded-[9px] border border-ink/10 bg-white px-2.5 py-[6px] font-mono text-[12.5px] text-ink"
            />
          </label>
          <button
            type="submit"
            className="rounded-[9px] border border-ink/10 bg-white px-3 py-[7px] font-display text-[12.5px] font-medium text-ink transition-colors hover:bg-lavender"
          >
            Apply range
          </button>
        </form>
      </div>

      {/* ---- Block A: the invoice run ---- */}
      <Panel
        title="This period"
        subtitle={period.label}
        badge={partial ? "month to date — still accruing" : undefined}
        action={<ExportButton href={exportHref("period")} />}
      >
        <div className="grid grid-cols-[2fr_1.2fr_1fr] gap-3 border-b border-ink/10 bg-surface-tint px-[22px] py-[11px]">
          <Th>Client</Th>
          <Th>Billing timezone</Th>
          <Th right>Usage</Th>
        </div>
        {rows.length === 0 ? (
          <Empty>No clients found for this agency.</Empty>
        ) : (
          rows.map((r, i) => (
            <div
              key={r.id}
              className={`grid grid-cols-[2fr_1.2fr_1fr] items-center gap-3 border-b border-lavender px-[22px] py-2.5 ${
                i % 2 ? "bg-lavender/40" : "bg-white"
              }`}
            >
              <div className="truncate text-[13.5px] font-medium">{r.name}</div>
              <div className="truncate font-mono text-[11.5px] text-muted">{r.tz}</div>
              <Money cents={r.periodCents} currency={currency} bold />
            </div>
          ))
        )}
        <div className="grid grid-cols-[2fr_1.2fr_1fr] items-center gap-3 bg-lavender px-[22px] py-3">
          <div className="text-[13px] font-semibold">Total</div>
          <div />
          <div className="text-right font-mono text-[14px] font-bold text-violet tabular-nums">
            {periodTotal == null ? "—" : centsToMoneyExact(periodTotal, currency)}
          </div>
        </div>
      </Panel>

      {/* ---- Block B: the true-up ---- */}
      <div className="mt-7">
        <Panel
          title="All history"
          subtitle="every calendar month since each workspace opened"
          action={<ExportButton href={exportHref("history")} />}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-surface-tint">
                  <th className="sticky left-0 z-10 bg-surface-tint px-[22px] py-[11px] text-left font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
                    Client
                  </th>
                  {months.map((m) => (
                    <th
                      key={m}
                      className="whitespace-nowrap px-3 py-[11px] text-right font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted"
                    >
                      {monthLabel(m)}
                      {m === currentMonth ? (
                        <span className="ml-1 normal-case tracking-normal opacity-70">(MTD)</span>
                      ) : null}
                    </th>
                  ))}
                  <th className="whitespace-nowrap px-[22px] py-[11px] text-right font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
                    Lifetime
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className={i % 2 ? "bg-lavender/40" : "bg-white"}>
                    <td
                      className={`sticky left-0 z-10 max-w-[220px] truncate border-b border-lavender px-[22px] py-2.5 font-medium ${
                        i % 2 ? "bg-[#F4F1FE]" : "bg-white"
                      }`}
                    >
                      {r.name}
                    </td>
                    {r.monthCells.map((c, j) => (
                      <td
                        key={months[j] ?? j}
                        className="whitespace-nowrap border-b border-lavender px-3 py-2.5 text-right font-mono text-[12.5px] tabular-nums"
                      >
                        <CellValue cell={c} currency={currency} />
                      </td>
                    ))}
                    <td className="whitespace-nowrap border-b border-lavender px-[22px] py-2.5 text-right font-mono text-[12.5px] font-semibold tabular-nums">
                      {r.lifetimeCents == null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        centsToMoneyExact(r.lifetimeCents, currency)
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="bg-lavender">
                  <td className="sticky left-0 z-10 bg-lavender px-[22px] py-3 font-semibold">
                    Total
                  </td>
                  {monthColumnTotals.map((t, j) => (
                    <td
                      key={months[j] ?? j}
                      className="whitespace-nowrap px-3 py-3 text-right font-mono text-[12.5px] font-bold text-violet tabular-nums"
                    >
                      {t == null ? <span className="text-muted">—</span> : centsToMoneyExact(t, currency)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-[22px] py-3 text-right font-mono text-[13px] font-bold text-violet tabular-nums">
                    {rows.some((r) => r.lifetimeCents == null)
                      ? "—"
                      : centsToMoneyExact(
                          rows.reduce((a, r) => a + (r.lifetimeCents ?? 0), 0),
                          currency,
                        )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="mt-3 max-w-[760px] font-mono text-[11.5px] leading-relaxed text-muted">
        {BASIS_NOTE} Each month runs on that client&rsquo;s own timezone, so it matches what they
        see in their own dashboard. A blank cell is a month before the workspace opened;
        &ldquo;—&rdquo; means the figure could not be loaded and is never a zero.
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  badge,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-ink/10 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 bg-surface-tint px-[22px] py-3.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display text-[15px] font-semibold">{title}</span>
            {badge ? (
              <span className="rounded-[6px] border border-warning/40 bg-warning/10 px-1.5 py-px font-mono text-[10px] font-medium text-warning">
                {badge}
              </span>
            ) : null}
          </div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
            {subtitle}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function CellValue({ cell, currency }: { cell: UsageCell; currency: string }) {
  if (cell.kind === "before-open") return <span className="text-muted/40">·</span>;
  if (cell.kind === "unavailable") return <span className="text-muted">—</span>;
  return cell.cents === 0 ? (
    <span className="text-muted">{centsToMoneyExact(0, currency)}</span>
  ) : (
    <>{centsToMoneyExact(cell.cents, currency)}</>
  );
}

function Money({
  cents,
  currency,
  bold,
}: {
  cents: number | null;
  currency: string;
  bold?: boolean;
}) {
  return (
    <div
      className={`text-right font-mono text-[13px] tabular-nums ${
        bold ? "font-semibold" : ""
      } ${cents == null ? "text-muted" : ""}`}
    >
      {cents == null ? "—" : centsToMoneyExact(cents, currency)}
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <div
      className={`font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted ${
        right ? "text-right" : ""
      }`}
    >
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-[22px] py-10 text-center text-[13px] text-muted">{children}</div>;
}
