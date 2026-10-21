import Link from "next/link";
import { runBillingNow, saveBillingDefaults } from "@/app/console/billing/actions";
import { SubmitButton } from "@/components/ui/states/SubmitButton";
import type { BillingSettings, ClientBilling } from "@/lib/billing/config";
import type { BillingRunInfo, InvoiceRow } from "@/lib/billing/invoices";
import { bpsToPercent, centsToDollarsInput, FEE_CURRENCIES, moneyWithCurrency } from "@/lib/billing/money";
import { cardLabel } from "@/lib/billing/notify";
import { INVOICE_STATUS_LABEL, STATUS_LABEL, STREAM_LABEL, type ClientBillingStatus } from "@/lib/billing/status";
import { relTime } from "@/lib/format";
import { dayLabel } from "@/lib/usage";

export interface BillingOverviewRow {
  client: { id: string; name: string; timezone: string | null };
  cb: ClientBilling | null;
  status: ClientBillingStatus;
  /** Next weekly AI Power Credits charge (Monday); null while off or suspended. */
  nextCredits: string | null;
  lastInvoice: InvoiceRow | null;
}

export interface BillingOverviewProps {
  settings: BillingSettings;
  /** Who per-client billing mail goes to when a client has no contact of its own. */
  defaultContact: string | null;
  /** Markup is unreleased: when false, no markup field or column is shown. */
  markupEnabled: boolean;
  rows: BillingOverviewRow[];
  lastRun: BillingRunInfo | null;
  livemode: boolean;
  notice: string | null;
  error: string | null;
  runInfo: { invoiced?: string; errors?: string };
}

const STATUS_CLASS: Record<ClientBillingStatus, string> = {
  off: "border-ink/10 bg-lavender text-muted",
  no_card: "border-warning/40 bg-warning/10 text-warning",
  active: "border-success/30 bg-success/10 text-success",
  payment_failed: "border-danger/30 bg-danger/10 text-danger",
  action_required: "border-warning/40 bg-warning/10 text-warning",
  suspended: "border-danger bg-danger text-white",
};

// Literal class strings (Tailwind only generates classes it can see in the source).
const COLS_WITH_MARKUP = "grid-cols-[1.6fr_1fr_1.2fr_1fr_0.7fr_0.8fr_1fr_1.5fr_0.9fr]";
const COLS = "grid-cols-[1.6fr_1fr_1.2fr_1fr_0.8fr_1fr_1.5fr_0.9fr]";

export function BillingOverview(p: BillingOverviewProps) {
  const cols = p.markupEnabled ? COLS_WITH_MARKUP : COLS;
  const counts = {
    active: p.rows.filter((r) => r.status === "active").length,
    noCard: p.rows.filter((r) => r.status === "no_card").length,
    failed: p.rows.filter((r) => r.status === "payment_failed" || r.status === "action_required").length,
    suspended: p.rows.filter((r) => r.status === "suspended").length,
  };
  const notice =
    p.notice === "saved"
      ? "Defaults saved."
      : p.notice === "run"
        ? `Billing run finished: ${p.runInfo.invoiced ?? 0} invoiced, ${p.runInfo.errors ?? 0} errors.`
        : null;
  const error =
    p.error === "invalid"
      ? `Check the values: ${p.markupEnabled ? "markup 0–300%, " : ""}fee day 1–28, threshold in dollars (blank = off), currency AUD or USD.`
      : p.error === "save_failed"
        ? "Could not save the defaults. Try again."
        : p.error === "client"
          ? "That workspace was not found."
          : p.error === "run_failed"
          ? "The billing run could not complete. Try again, or check the run log."
          : p.error === "run_unconfirmed"
          ? "Tick the confirmation box to run billing."
          : null;

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="font-display text-[26px] font-bold tracking-[-0.02em]">Billing</div>
          {!p.livemode ? (
            <span className="rounded-[6px] border border-warning/40 bg-warning/10 px-1.5 py-px font-mono text-[10px] font-medium text-warning">
              Stripe sandbox
            </span>
          ) : null}
        </div>
        <form action={runBillingNow} className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[12.5px] text-muted">
            <input type="checkbox" name="confirm" required className="h-4 w-4 accent-violet" />
            I understand this charges every client with a due service fee or a closed, unbilled week now
          </label>
          <SubmitButton
            pendingLabel="Running…"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-ink/10 bg-white px-3 py-[7px] font-display text-[12.5px] font-medium text-ink transition-colors hover:bg-lavender"
          >
            Run billing now
          </SubmitButton>
        </form>
      </div>
      <div className="mb-6 text-[14px] text-muted">
        Two charges per client on the same card · AI Power Credits (USD) every Monday for the previous week · the
        client&apos;s monthly service fee (its own amount and currency) in advance on the fee day
      </div>

      {notice ? (
        <div className="mb-5 rounded-[13px] border border-success/30 bg-success/10 px-4 py-3 text-[13px] text-ink/80">{notice}</div>
      ) : null}
      {error ? (
        <div className="mb-5 rounded-[13px] border border-danger/30 bg-danger/8 px-4 py-3 text-[13px] text-danger">{error}</div>
      ) : null}

      {/* defaults */}
      <form
        action={saveBillingDefaults}
        className="mb-6 flex flex-wrap items-end gap-3 rounded-[16px] border border-ink/10 bg-white px-5 py-4 shadow-sm"
      >
        <div className="w-full font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
          Agency defaults · each client&apos;s service fee is set on its own page
        </div>
        {p.markupEnabled ? (
          <Field label="Markup %" name="markup" defaultValue={bpsToPercent(p.settings.markupBps)} placeholder="0" />
        ) : null}
        <label className="flex w-[140px] flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">Fee currency</span>
          <select
            name="feeCurrency"
            defaultValue={p.settings.feeCurrency}
            className="rounded-[9px] border border-ink/10 bg-white px-2.5 py-[6px] font-mono text-[12.5px] text-ink"
          >
            {FEE_CURRENCIES.map((c) => (
              <option key={c} value={c}>{c.toUpperCase()}</option>
            ))}
          </select>
        </label>
        <Field label="Fee charge day" name="anchorDay" defaultValue={String(p.settings.anchorDay)} placeholder="3" type="number" />
        <Field
          label="Low-balance (USD)"
          name="lowBalance"
          defaultValue={p.settings.lowBalanceCents == null ? "" : centsToDollarsInput(p.settings.lowBalanceCents)}
          placeholder="off, e.g. 50"
        />
        <Field
          label="Billing contact at agency"
          name="alertEmail"
          defaultValue={p.settings.alertEmail ?? ""}
          placeholder={p.defaultContact ?? "billing@agency.com"}
          type="email"
          wide
        />
        <div className="w-full text-[11.5px] leading-relaxed text-muted">
          The billing contact gets every client&apos;s payment-failure alerts, receipt copies and suspension notices,
          unless a client has its own contact. Blank = the agency admin
          {p.defaultContact ? <> ({p.defaultContact})</> : null}. The low-balance limit charges unbilled AI Power
          Credits early, before Monday, once they reach it; blank = off.
        </div>
        <SubmitButton
          pendingLabel="Saving…"
          className="bg-gradient-brand rounded-[10px] px-4 py-2 font-display text-[13px] font-semibold text-white transition-transform active:scale-95"
        >
          Save defaults
        </SubmitButton>
      </form>

      {/* status strip */}
      <div className="mb-6 grid grid-cols-2 gap-3.5 md:grid-cols-5">
        <Kpi label="Active" value={String(counts.active)} accent />
        <Kpi label="No card" value={String(counts.noCard)} />
        <Kpi label="Payment issues" value={String(counts.failed)} />
        <Kpi label="Suspended" value={String(counts.suspended)} danger={counts.suspended > 0} />
        <Kpi
          label="Last run"
          value={p.lastRun ? relTime(p.lastRun.startedAt) : "never"}
          hint={p.lastRun ? `${p.lastRun.trigger} · ${p.lastRun.counts.invoiced ?? 0} invoiced` : "runs daily at 03:00 UTC"}
        />
      </div>

      {/* clients */}
      <div className="overflow-hidden rounded-[16px] border border-ink/10 bg-white shadow-sm">
        <div className={`grid ${cols} gap-3 border-b border-ink/10 bg-surface-tint px-[22px] py-[13px]`}>
          {["Client", "Status", "Card", "Service fee", ...(p.markupEnabled ? ["Markup"] : []), "Low-bal.", "Next credits", "Last invoice", ""].map((h, i) => (
            <div key={h || i} className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
              {h}
            </div>
          ))}
        </div>
        {p.rows.map((r, i) => (
          <div
            key={r.client.id}
            className={`grid ${cols} items-center gap-3 border-b border-lavender px-[22px] py-3 text-[13px] ${i % 2 ? "bg-lavender/40" : "bg-white"}`}
          >
            <div className="min-w-0 truncate font-medium">{r.client.name}</div>
            <div>
              <span className={`inline-flex rounded-full border px-2 py-[2px] font-mono text-[10.5px] ${STATUS_CLASS[r.status]}`}>
                {STATUS_LABEL[r.status]}
              </span>
            </div>
            <div className="truncate font-mono text-[12px] text-muted">{r.cb?.card ? cardLabel(r.cb.card) : "—"}</div>
            {/* The agency's retail fee for this client; a client without one is charged no fee. */}
            <div className="font-mono text-[12.5px] tabular-nums">
              {r.cb && r.cb.effective.feeCents > 0 ? moneyWithCurrency(r.cb.effective.feeCents, r.cb.effective.feeCurrency) : "—"}
            </div>
            {p.markupEnabled ? (
              <div className="font-mono text-[12.5px] tabular-nums">{bpsToPercent(r.cb?.effective.markupBps ?? p.settings.markupBps)}%</div>
            ) : null}
            <div className="font-mono text-[12.5px] tabular-nums">
              {r.cb?.effective.lowBalanceCents != null
                ? `$${centsToDollarsInput(r.cb.effective.lowBalanceCents)}`
                : r.cb == null && p.settings.lowBalanceCents != null
                  ? `$${centsToDollarsInput(p.settings.lowBalanceCents)}`
                  : "off"}
            </div>
            <div className="font-mono text-[12px] text-muted">{r.nextCredits ? dayLabel(r.nextCredits) : "—"}</div>
            <div className="min-w-0 truncate font-mono text-[12px]" title={r.lastInvoice ? `${STREAM_LABEL[r.lastInvoice.stream]} · ${r.lastInvoice.periodLabel}` : undefined}>
              {r.lastInvoice ? (
                <>
                  {r.lastInvoice.stream === "credits" ? "Credits" : "Fee"} ·{" "}
                  {r.lastInvoice.totalCents == null ? "—" : moneyWithCurrency(r.lastInvoice.totalCents, r.lastInvoice.currency)} ·{" "}
                  <span className="text-muted">{INVOICE_STATUS_LABEL[r.lastInvoice.status]}</span>
                </>
              ) : (
                <span className="text-muted">—</span>
              )}
            </div>
            <div className="flex justify-end">
              <Link
                href={`/console/billing/${r.client.id}`}
                className="rounded-[9px] border border-ink/10 bg-white px-3 py-[6px] font-display text-[12.5px] font-medium text-ink transition-colors hover:bg-lavender"
              >
                Configure
              </Link>
            </div>
          </div>
        ))}
        {p.rows.length === 0 ? (
          <div className="px-[22px] py-10 text-center text-[13px] text-muted">No clients found for this agency.</div>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  type = "text",
  wide,
}: {
  label: string;
  name: string;
  defaultValue: string;
  placeholder: string;
  type?: string;
  wide?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? "min-w-[240px] flex-1" : "w-[140px]"}`}>
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        min={type === "number" ? 1 : undefined}
        max={type === "number" ? 28 : undefined}
        className="rounded-[9px] border border-ink/10 bg-white px-2.5 py-[6px] font-mono text-[12.5px] text-ink placeholder:text-muted/60"
      />
    </label>
  );
}

function Kpi({ label, value, hint, accent, danger }: { label: string; value: string; hint?: string; accent?: boolean; danger?: boolean }) {
  return (
    <div className={`rounded-[13px] border bg-white px-4 py-3.5 shadow-sm ${danger ? "border-danger/50" : "border-ink/10"}`}>
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-muted">{label}</div>
      <div className={`font-display text-[22px] font-bold tracking-[-0.01em] ${danger ? "text-danger" : accent ? "text-violet" : "text-ink"}`}>{value}</div>
      {hint ? <div className="mt-0.5 font-mono text-[10.5px] text-muted">{hint}</div> : null}
    </div>
  );
}
