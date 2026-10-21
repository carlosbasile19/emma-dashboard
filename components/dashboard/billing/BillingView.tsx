import { removeMyCard, saveBillingEmail, startCardSetup } from "@/app/dashboard/billing/actions";
import { SubmitButton } from "@/components/ui/states/SubmitButton";
import type { CardOnFile } from "@/lib/billing/config";
import {
  BILLING_NOT_STARTED_COPY,
  BILLING_PAUSED_COPY,
  chargeSummary,
  mandateText,
  SUSPENDED_COPY,
  type ChargeTerms,
} from "@/lib/billing/copy";
import type { CreditsFigure, InvoiceRow } from "@/lib/billing/invoices";
import { moneyWithCurrency } from "@/lib/billing/money";
import { INVOICE_STATUS_LABEL, STREAM_LABEL, type InvoiceStatus } from "@/lib/billing/status";
import { dayLabel } from "@/lib/usage";

export interface BillingViewProps {
  clientName: string;
  /** Automatic monthly charging is on. Off: the card can still be saved, and nothing is charged. */
  automatic: boolean;
  card: CardOnFile | null;
  billingEmail: string | null;
  /** The agency's service fee, its currency and charge day. */
  terms: ChargeTerms;
  /** Paused for non-payment. */
  suspended: boolean;
  /** Unbilled AI Power Credits; null while automatic billing is off. */
  credits: CreditsFigure | null;
  /** Next service-fee charge date; null when off or no fee. */
  nextFee: string | null;
  invoices: InvoiceRow[];
  notice: string | null;
  error: string | null;
}

const NOTICE: Record<string, string> = {
  card_added: "Your card is on file.",
  card_removed: "Your card was removed. Nothing will be charged until a new card is added.",
  email_saved: "Billing contact saved.",
  setup_cancelled: "No changes were made to your payment method.",
};

const ERROR: Record<string, string> = {
  setup: "We couldn't confirm the card. Please try adding it again.",
  setup_start: "We couldn't open the secure card form just now. Please try again in a moment.",
  remove: "We couldn't remove the card cleanly. Please check it below and try again, or contact your Emma strategist.",
  email: "Enter a valid email address.",
  email_save: "We couldn't save the billing contact just now. Please try again.",
};

const PILL: Record<InvoiceStatus, string> = {
  paid: "border-success/30 bg-success/10 text-success",
  open: "border-info/30 bg-info/10 text-info",
  failed: "border-danger/30 bg-danger/10 text-danger",
  action_required: "border-warning/40 bg-warning/10 text-warning",
  void: "border-ink/10 bg-lavender text-muted",
  uncollectible: "border-danger/30 bg-danger/10 text-danger",
  skipped_zero: "border-ink/10 bg-lavender text-muted",
  reserved: "border-ink/10 bg-lavender text-muted",
};

function cardTitle(card: CardOnFile): string {
  const brand = card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : "Card";
  return `${brand} ····${card.last4 ?? "????"}`;
}

export function BillingView(p: BillingViewProps) {
  const noticeText = p.notice && Object.hasOwn(NOTICE, p.notice) ? NOTICE[p.notice] : null;
  const errorText = p.error && Object.hasOwn(ERROR, p.error) ? ERROR[p.error] : null;
  // Off with earlier invoices = billing ran before and was switched off; off without = never started.
  const paused = !p.automatic && p.invoices.length > 0;
  const offCopy = paused ? BILLING_PAUSED_COPY : BILLING_NOT_STARTED_COPY;

  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-5 text-[14px] text-muted">
        {p.automatic
          ? `Automatic billing for ${p.clientName} · ${STREAM_LABEL.credits} weekly (Mondays, USD)${p.terms.feeCents > 0 ? " · monthly service fee" : ""}`
          : `Billing for ${p.clientName} · ${paused ? "automatic billing is paused" : "automatic billing hasn't started yet"}`}
      </div>

      {p.suspended ? (
        <div className="mb-5 rounded-[13px] border-2 border-danger bg-danger/8 px-4 py-3.5">
          <div className="text-[14px] font-semibold text-danger">{SUSPENDED_COPY.title}</div>
          <div className="mt-1 text-[13px] leading-relaxed text-ink/80">{SUSPENDED_COPY.body}</div>
        </div>
      ) : null}

      {noticeText ? (
        <div className="mb-5 rounded-[13px] border border-success/30 bg-success/10 px-4 py-3 text-[13px] text-ink/80">
          {noticeText}
        </div>
      ) : null}
      {errorText ? (
        <div className="mb-5 rounded-[13px] border border-danger/30 bg-danger/8 px-4 py-3 text-[13px] text-danger">
          {errorText}
        </div>
      ) : null}

      <div className="mb-6 grid gap-5 md:grid-cols-2">
        {/* payment method */}
        <Panel title="Payment method">
          {p.card ? (
            <div className="px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-14 flex-none items-center justify-center rounded-[8px] border border-lavender-deep bg-lavender font-mono text-[10px] font-bold uppercase tracking-wider text-violet">
                  {p.card.brand ?? "card"}
                </span>
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold">{cardTitle(p.card)}</div>
                  <div className="font-mono text-[11.5px] text-muted">
                    {p.card.expMonth && p.card.expYear
                      ? `Expires ${String(p.card.expMonth).padStart(2, "0")}/${p.card.expYear}`
                      : "On file"}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <form action={startCardSetup}>
                  <SubmitButton
                    pendingLabel="Opening checkout…"
                    className="rounded-[10px] border border-ink/10 bg-white px-3.5 py-2 font-display text-[13px] font-medium text-ink transition-colors hover:bg-lavender"
                  >
                    Replace card
                  </SubmitButton>
                </form>
                <form action={removeMyCard}>
                  <SubmitButton
                    pendingLabel="Removing…"
                    className="rounded-[10px] border border-ink/10 bg-white px-3.5 py-2 font-display text-[13px] font-medium text-danger transition-colors hover:bg-danger/8"
                  >
                    Remove card
                  </SubmitButton>
                </form>
              </div>
            </div>
          ) : (
            <div className="px-5 py-4">
              <div className="text-[14px] font-medium">No card on file</div>
              <div className="mt-1 text-[13px] text-muted">
                {p.automatic
                  ? "Add a card to be billed automatically. Until then nothing is charged."
                  : paused
                    ? "Save a card for your Emma billing."
                    : "Save a card for your Emma billing. Nothing is charged until automatic billing starts."}
              </div>
              <form action={startCardSetup} className="mt-4">
                <SubmitButton
                  pendingLabel="Opening checkout…"
                  className="bg-gradient-brand rounded-[10px] px-4 py-2 font-display text-[13px] font-semibold text-white transition-transform active:scale-95"
                >
                  Add card with Stripe
                </SubmitButton>
              </form>
            </div>
          )}
          <div className="border-t border-lavender px-5 py-3 text-[11.5px] leading-relaxed text-muted">
            {mandateText(p.terms)}
          </div>
        </Panel>

        {/* next charge, or how billing will work before it starts */}
        {p.automatic && p.credits ? (
          <Panel title="Next charges" subtitle="estimate · same card, two charges">
            <div className="flex flex-col">
              <Line
                label={`${STREAM_LABEL.credits} since ${dayLabel(p.credits.from)}`}
                value={p.credits.usageCents == null ? "Unavailable" : moneyWithCurrency(p.credits.usageCents, "usd")}
              />
              <Line label="Charged weekly, next on" value={dayLabel(p.credits.nextChargeDate)} />
              {p.terms.feeCents > 0 ? (
                <>
                  <Line label={STREAM_LABEL.service_fee} value={moneyWithCurrency(p.terms.feeCents, p.terms.feeCurrency)} />
                  {p.nextFee ? <Line label="Charged monthly, next on" value={dayLabel(p.nextFee)} /> : null}
                </>
              ) : null}
              <div className="px-5 py-3 text-[12px] leading-relaxed text-muted">
                {chargeSummary(p.terms)} Credits accrue until the week closes, so the Monday amount can be higher.
                {p.credits.usageCents == null ? " Usage could not be loaded just now; this is not a zero." : ""}
              </div>
            </div>
          </Panel>
        ) : (
          <Panel title="Automatic billing" subtitle={paused ? "paused" : "not started yet"}>
            <div className="px-5 py-4">
              <div className="text-[14px] font-medium">{offCopy.title}</div>
              <div className="mt-1 text-[13px] leading-relaxed text-muted">{offCopy.body}</div>
            </div>
            <div className="border-t border-lavender px-5 py-3 text-[12.5px] leading-relaxed text-ink/80">
              When automatic billing is on: {chargeSummary(p.terms)}
            </div>
          </Panel>
        )}
      </div>

      {/* invoices — once billing is on, or when earlier invoices exist */}
      {p.automatic || p.invoices.length > 0 ? (
        <Panel title="Invoices" subtitle="credits weekly · service fee monthly">
          {p.invoices.length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-muted">
              No invoices yet. Your first one appears after the first charge date.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-surface-tint">
                    {["Item", "Period", "Amount", "Status", ""].map((h, i) => (
                      <th
                        key={h || i}
                        className={`px-5 py-[11px] font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted ${i === 2 ? "text-right" : "text-left"}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.invoices.map((inv, i) => (
                    <tr key={inv.id} className={i % 2 ? "bg-lavender/40" : "bg-white"}>
                      <td className="border-b border-lavender px-5 py-2.5 font-medium">{STREAM_LABEL[inv.stream]}</td>
                      <td className="border-b border-lavender px-5 py-2.5">{inv.periodLabel}</td>
                      <td className="border-b border-lavender px-5 py-2.5 text-right font-mono font-semibold tabular-nums">
                        {inv.totalCents == null ? "—" : moneyWithCurrency(inv.totalCents, inv.currency)}
                      </td>
                      <td className="border-b border-lavender px-5 py-2.5">
                        <span className={`inline-flex rounded-full border px-2 py-[2px] font-mono text-[10.5px] ${PILL[inv.status]}`}>
                          {INVOICE_STATUS_LABEL[inv.status]}
                        </span>
                        {inv.status === "failed" && inv.failureMessage ? (
                          <div className="mt-1 max-w-[260px] text-[11px] text-muted">{inv.failureMessage}</div>
                        ) : null}
                      </td>
                      <td className="border-b border-lavender px-5 py-2.5 text-right">
                        {inv.hostedInvoiceUrl ? (
                          <a
                            href={inv.hostedInvoiceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-display text-[12.5px] font-medium text-violet hover:underline"
                          >
                            {inv.status === "action_required" ? "Complete payment" : inv.status === "paid" ? "Receipt" : "View invoice"}
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : null}

      {/* billing contact */}
      <div className="mt-6">
        <Panel title="Billing contact" subtitle="receipts and payment notices go here">
          <form action={saveBillingEmail} className="flex flex-wrap items-center gap-2 px-5 py-4">
            <input
              type="email"
              name="email"
              required
              defaultValue={p.billingEmail ?? ""}
              placeholder="billing@company.com"
              className="min-w-[240px] flex-1 rounded-[9px] border border-ink/10 bg-white px-3 py-2 font-display text-[13px] text-ink placeholder:text-muted/60"
            />
            <SubmitButton
              pendingLabel="Saving…"
              className="rounded-[9px] border border-ink/10 bg-white px-3.5 py-2 font-display text-[13px] font-medium text-ink transition-colors hover:bg-lavender"
            >
              Save
            </SubmitButton>
          </form>
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-ink/10 bg-white shadow-sm">
      <div className="border-b border-ink/10 bg-surface-tint px-5 py-3.5">
        <div className="font-display text-[14px] font-semibold">{title}</div>
        {subtitle ? (
          <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">{subtitle}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-lavender px-5 py-3">
      <span className="text-[12.5px] text-muted">{label}</span>
      <span className="font-mono text-[12.5px] tabular-nums">{value}</span>
    </div>
  );
}
