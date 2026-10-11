import Link from "next/link";
import {
  adminRemoveCard,
  chargeNow,
  emailSetupLink,
  generateSetupLink,
  retryCharge,
  revokeLink,
  saveClientBilling,
} from "@/app/console/billing/actions";
import { CopyButton } from "@/components/ui/CopyButton";
import { SubmitButton } from "@/components/ui/states/SubmitButton";
import type { BillingSettings, ClientBilling } from "@/lib/billing/config";
import type { InvoiceRow, MonthFigure } from "@/lib/billing/invoices";
import { bpsToPercent, centsToDollarsInput } from "@/lib/billing/money";
import { cardLabel } from "@/lib/billing/notify";
import type { SetupLink } from "@/lib/billing/setup";
import { INVOICE_STATUS_LABEL, STATUS_LABEL, setupLinkState, type ClientBillingStatus } from "@/lib/billing/status";
import { initials as toInitials, relTime } from "@/lib/format";
import { centsToMoneyExact, dayLabel, monthLabel } from "@/lib/usage";

export interface BillingClientViewProps {
  client: { id: string; name: string; timezone: string | null };
  cb: ClientBilling | null;
  settings: BillingSettings;
  /** Markup is unreleased: when false, no markup field, figure or billed-usage line is shown. */
  markupEnabled: boolean;
  /** Pre-fills a link's email box when the client has no billing contact yet. */
  suggestedEmail: string | null;
  status: ClientBillingStatus;
  links: SetupLink[];
  baseUrl: string;
  invoices: InvoiceRow[];
  /** Last closed month: usage + fee (raw → billed once markup is released). null when billing is off. */
  preview: MonthFigure | null;
  chargeableMonths: string[];
  nextCharge: string | null;
  notice: string | null;
  error: string | null;
  extra: Record<string, string | undefined>;
}

const STATUS_CLASS: Record<ClientBillingStatus, string> = {
  off: "border-white/20 bg-white/10 text-white",
  no_card: "border-warning/60 bg-warning/20 text-white",
  active: "border-success/60 bg-success/20 text-white",
  payment_failed: "border-danger/60 bg-danger/25 text-white",
  action_required: "border-warning/60 bg-warning/20 text-white",
};

function noticeText(p: BillingClientViewProps): string | null {
  switch (p.notice) {
    case "saved":
      return "Billing settings saved.";
    case "link":
      return "Setup link created. Copy it or email it below.";
    case "sent":
      return "Setup link emailed.";
    case "revoked":
      return "Link revoked.";
    case "card_removed":
      return "Card removed. Nothing will be charged until a new card is added.";
    case "no_card":
      return "There was no card on file to remove.";
    case "charged": {
      const o = p.extra.outcome;
      const s = p.extra.status;
      if (o === "invoiced") return `Invoice created — ${s === "paid" ? "paid" : s === "failed" ? "payment failed (see below)" : s}.`;
      if (o === "skipped_zero") return "Nothing to bill for that month.";
      if (o === "skipped_no_card") return "Not charged: no card on file.";
      if (o === "usage_unavailable") return "Not charged: usage could not be loaded. Try again later.";
      if (o === "skipped_disabled") return "Not charged: billing is switched off for this client.";
      if (o === "already_invoiced") return "That month already has an invoice.";
      return `Charge did not complete (${o ?? "error"}).`;
    }
    case "retried":
      return p.extra.ok === "1" ? "Payment succeeded." : `Retry did not succeed (${p.extra.status ?? "failed"}).`;
    default:
      return null;
  }
}

function errorText(code: string | null, storedBillFrom: string | null, markupEnabled: boolean): string | null {
  switch (code) {
    case "bill_from_reenable":
      return `Billing was off since ${storedBillFrom ? monthLabel(storedBillFrom) : "an earlier month"}. Set the bill-from month you want to start charging from, then save again.`;
    case "invalid":
      return `Check the values: ${markupEnabled ? "markup 0–300%, " : ""}fee in dollars, anchor day 1–28, month as YYYY-MM.`;
    case "email":
      return "Enter a valid email address.";
    case "send":
      return "The email could not be sent — copy the link instead.";
    case "save":
      return "Settings could not be saved. Try again.";
    case "link":
      return "That setup link could not be created, found or revoked. Reload and try again.";
    case "remove":
      return "The card could not be removed from the payment provider. It will not be charged, but check again shortly.";
    case "charge":
      return "The charge did not complete. Check the invoice list and try again.";
    case "retry":
      return "The retry did not complete. Check the invoice list and try again.";
    case "client":
      return "Client not found.";
    case "month":
      return "That month can't be charged.";
    case "bill_from":
      return "Bill-from can't be more than 12 months in the past.";
    case "no_valid_link":
      return "That link is no longer valid. Generate a new one.";
    default:
      return null;
  }
}

export function BillingClientView(p: BillingClientViewProps) {
  const { client, cb, settings } = p;
  const notice = noticeText(p);
  const error = errorText(p.error, cb?.billFromMonth ?? null, p.markupEnabled);
  const now = new Date();

  return (
    <div className="mx-auto max-w-[1000px]">
      <Link href="/console/billing" className="mb-4 inline-flex items-center gap-1.5 font-mono text-[12px] text-muted transition-colors hover:text-violet">
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5l-5 5 5 5" />
        </svg>
        Billing
      </Link>

      {/* hero */}
      <div className="relative mb-6 overflow-hidden rounded-[18px] bg-ink px-7 py-6 text-white">
        <div className="pointer-events-none absolute -right-16 -top-28 h-[260px] w-[260px] rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.5),transparent_62%)]" />
        <div className="relative flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-3.5">
            <span className="bg-gradient-brand flex h-12 w-12 flex-none items-center justify-center rounded-[13px] font-mono text-[15px] font-bold text-white">
              {toInitials(client.name)}
            </span>
            <div>
              <div className="text-[24px] font-bold tracking-[-0.01em]">{client.name}</div>
              <div className="mt-1 font-mono text-[11px] tracking-[0.04em] text-violet-light">
                {cb?.card ? cardLabel(cb.card) : "no card on file"} · {p.nextCharge ? `next charge ${dayLabel(p.nextCharge)}` : "billing off"}
              </div>
            </div>
          </div>
          <span className={`rounded-full border px-3 py-1 font-mono text-[11px] ${STATUS_CLASS[p.status]}`}>{STATUS_LABEL[p.status]}</span>
        </div>
      </div>

      {notice ? <div className="mb-5 rounded-[13px] border border-success/30 bg-success/10 px-4 py-3 text-[13px] text-ink/80">{notice}</div> : null}
      {error ? <div className="mb-5 rounded-[13px] border border-danger/30 bg-danger/8 px-4 py-3 text-[13px] text-danger">{error}</div> : null}

      <div className="grid gap-5 md:grid-cols-[1.4fr_1fr]">
        {/* config */}
        <Panel title="Billing settings" subtitle="blank override = platform default">
          <form action={saveClientBilling} className="flex flex-col gap-3 px-5 py-4">
            <input type="hidden" name="clientId" value={client.id} />
            <label className="flex items-center gap-2.5 text-[13.5px] font-medium">
              <input type="checkbox" name="enabled" defaultChecked={cb?.enabled ?? false} className="h-4 w-4 accent-violet" />
              Automatic billing on
            </label>
            <Field label="Billing email" name="billingEmail" type="email" defaultValue={cb?.billingEmail ?? ""} placeholder="billing@client.com" />
            <Field label="Bill from month" name="billFromMonth" type="month" defaultValue={cb?.billFromMonth ?? ""} placeholder="" hint="Months from here on are invoiced; earlier months are never touched." />
            <div className={`grid gap-3 ${p.markupEnabled ? "grid-cols-3" : "grid-cols-2"}`}>
              {p.markupEnabled ? (
                <Field label="Markup %" name="markup" defaultValue={cb?.overrides.markupBps == null ? "" : bpsToPercent(cb.overrides.markupBps)} placeholder={`Default ${bpsToPercent(settings.markupBps)}`} />
              ) : null}
              <Field label="Monthly fee (USD)" name="fee" defaultValue={cb?.overrides.feeCents == null ? "" : centsToDollarsInput(cb.overrides.feeCents)} placeholder={`Default ${centsToDollarsInput(settings.feeCents)}`} />
              <Field label="Anchor day" name="anchorDay" defaultValue={cb?.overrides.anchorDay == null ? "" : String(cb.overrides.anchorDay)} placeholder={`Default ${settings.anchorDay}`} />
            </div>
            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="font-mono text-[11px] text-muted">
                Effective: {p.markupEnabled ? `${bpsToPercent(cb?.effective.markupBps ?? settings.markupBps)}% · ` : ""}
                {centsToMoneyExact(cb?.effective.feeCents ?? settings.feeCents)} · day {cb?.effective.anchorDay ?? settings.anchorDay}
              </span>
              <SubmitButton pendingLabel="Saving…" className="bg-gradient-brand rounded-[10px] px-4 py-2 font-display text-[13px] font-semibold text-white transition-transform active:scale-95">
                Save
              </SubmitButton>
            </div>
          </form>
        </Panel>

        <div className="flex flex-col gap-5">
          {/* card */}
          <Panel title="Card on file">
            <div className="px-5 py-4">
              {cb?.card ? (
                <>
                  <div className="text-[14px] font-semibold">{cardLabel(cb.card)}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted">added {cb.card.addedAt ? relTime(cb.card.addedAt) : "—"}</div>
                  <form action={adminRemoveCard} className="mt-3">
                    <input type="hidden" name="clientId" value={client.id} />
                    <SubmitButton pendingLabel="Removing…" className="rounded-[9px] border border-ink/10 bg-white px-3 py-1.5 font-display text-[12.5px] font-medium text-danger transition-colors hover:bg-danger/8">
                      Remove card
                    </SubmitButton>
                  </form>
                </>
              ) : (
                <div className="text-[13px] text-muted">
                  No card on file{cb?.cardRemovedAt ? ` (removed ${relTime(cb.cardRemovedAt)})` : ""}. Send a setup link below.
                </div>
              )}
            </div>
          </Panel>

          {/* preview */}
          <Panel title="Last closed month" subtitle={p.preview ? p.preview.label : "billing off"}>
            {p.preview ? (
              <div className="flex flex-col">
                {p.markupEnabled ? (
                  <>
                    <Line label="Usage (raw)" value={p.preview.lines ? centsToMoneyExact(p.preview.lines.rawUsageCents) : "Unavailable"} />
                    <Line label={p.preview.lines ? `Billed usage (+${bpsToPercent(p.preview.lines.markupBps)}%)` : "Billed usage"} value={p.preview.lines ? centsToMoneyExact(p.preview.lines.billedUsageCents) : "Unavailable"} />
                  </>
                ) : (
                  <Line label="Usage" value={p.preview.lines ? centsToMoneyExact(p.preview.lines.billedUsageCents) : "Unavailable"} />
                )}
                <Line label="Monthly fee" value={p.preview.lines ? centsToMoneyExact(p.preview.lines.feeCents) : "Unavailable"} />
                <div className="flex items-center justify-between gap-3 bg-lavender px-5 py-3">
                  <span className="text-[12.5px] font-semibold">Total</span>
                  <span className="font-mono text-[14px] font-bold text-violet tabular-nums">{p.preview.lines ? centsToMoneyExact(p.preview.lines.totalCents) : "Unavailable"}</span>
                </div>
              </div>
            ) : (
              <div className="px-5 py-4 text-[13px] text-muted">Switch billing on to see the figures.</div>
            )}
          </Panel>
        </div>
      </div>

      {/* setup links */}
      <div className="mt-5">
        <Panel
          title="Card setup links"
          subtitle="public, 7 days, reusable until a card is added"
          action={
            <form action={generateSetupLink}>
              <input type="hidden" name="clientId" value={client.id} />
              <SubmitButton pendingLabel="Creating…" className="bg-gradient-brand rounded-[9px] px-3 py-[7px] font-display text-[12.5px] font-medium text-white transition-transform active:scale-95">
                Generate link
              </SubmitButton>
            </form>
          }
        >
          {p.links.length === 0 ? (
            <div className="px-5 py-6 text-center text-[13px] text-muted">No links yet.</div>
          ) : (
            p.links.map((l) => {
              const state = setupLinkState(l, now);
              const valid = state === "valid";
              const url = `${p.baseUrl}/billing/setup/${l.token}`;
              return (
                <div key={l.id} className="border-b border-lavender px-5 py-4 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={`flex-none rounded-full border px-2 py-0.5 font-mono text-[10.5px] ${valid ? "border-success/40 bg-success/10 text-ink" : "border-ink/10 bg-lavender text-muted"}`}>
                      {state}
                    </span>
                    {valid ? (
                      <>
                        <code className="min-w-0 flex-1 truncate rounded-[8px] border border-lavender-deep bg-lavender px-2.5 py-1.5 font-mono text-[11.5px] text-ink">{url}</code>
                        <CopyButton value={url} />
                        <form action={revokeLink}>
                          <input type="hidden" name="clientId" value={client.id} />
                          <input type="hidden" name="linkId" value={l.id} />
                          <SubmitButton pendingLabel="Revoking…" className="rounded-[8px] border border-ink/10 bg-white px-2.5 py-1.5 font-display text-[12px] font-medium text-danger transition-colors hover:bg-danger/8">
                            Revoke
                          </SubmitButton>
                        </form>
                      </>
                    ) : (
                      <span className="font-mono text-[11px] text-muted">
                        {state === "expired" ? "expired" : state} {dayLabel(l.expiresAt.slice(0, 10))}{l.sentTo ? ` · sent to ${l.sentTo}` : ""}
                      </span>
                    )}
                  </div>
                  {valid ? (
                    <form action={emailSetupLink} className="mt-2.5 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="clientId" value={client.id} />
                      <input type="hidden" name="linkId" value={l.id} />
                      <input type="email" name="email" required defaultValue={l.sentTo ?? cb?.billingEmail ?? p.suggestedEmail ?? ""} placeholder="billing@client.com" className="min-w-[220px] flex-1 rounded-[9px] border border-ink/10 bg-white px-3 py-1.5 font-display text-[12.5px] text-ink placeholder:text-muted/60" />
                      <SubmitButton pendingLabel="Sending…" className="rounded-[9px] border border-ink/10 bg-white px-3 py-1.5 font-display text-[12.5px] font-medium text-ink transition-colors hover:bg-lavender">
                        {l.sentTo ? "Email again" : "Email link"}
                      </SubmitButton>
                      <span className="font-mono text-[11px] text-muted">expires {dayLabel(l.expiresAt.slice(0, 10))}{l.sentTo ? ` · sent to ${l.sentTo}` : ""}</span>
                    </form>
                  ) : null}
                </div>
              );
            })
          )}
        </Panel>
      </div>

      {/* charge now + invoices */}
      <div className="mt-5">
        <Panel
          title="Invoices"
          subtitle="one per calendar month"
          action={
            cb?.enabled && p.chargeableMonths.length > 0 ? (
              <form action={chargeNow} className="flex items-center gap-2">
                <input type="hidden" name="clientId" value={client.id} />
                <select name="month" defaultValue={p.chargeableMonths[p.chargeableMonths.length - 1]} className="rounded-[9px] border border-ink/10 bg-white py-[6px] pl-2.5 pr-7 font-display text-[12.5px] text-ink">
                  {p.chargeableMonths.map((m) => (
                    <option key={m} value={m}>{monthLabel(m)}</option>
                  ))}
                </select>
                <SubmitButton pendingLabel="Charging…" className="rounded-[9px] border border-ink/10 bg-white px-3 py-[7px] font-display text-[12.5px] font-medium text-ink transition-colors hover:bg-lavender">
                  Charge now
                </SubmitButton>
              </form>
            ) : null
          }
        >
          {p.invoices.length === 0 ? (
            <div className="px-5 py-6 text-center text-[13px] text-muted">No invoices yet.</div>
          ) : (
            p.invoices.map((inv, i) => (
              <div key={inv.id} className={`grid grid-cols-[1fr_1fr_1fr_1fr_1.2fr_1.2fr] items-center gap-3 border-b border-lavender px-5 py-3 text-[13px] ${i % 2 ? "bg-lavender/40" : "bg-white"}`}>
                <div className="font-medium">
                  {monthLabel(inv.periodMonth)}
                  {!inv.livemode ? <span className="ml-1.5 font-mono text-[10px] text-warning">test</span> : null}
                </div>
                <div className="font-mono text-[12.5px] tabular-nums">{inv.billedUsageCents == null ? "—" : `${centsToMoneyExact(inv.billedUsageCents)} usage`}</div>
                <div className="font-mono text-[12.5px] tabular-nums">{inv.feeCents == null ? "—" : `${centsToMoneyExact(inv.feeCents)} fee`}</div>
                <div className="font-mono text-[12.5px] font-semibold tabular-nums">{inv.totalCents == null ? "—" : centsToMoneyExact(inv.totalCents)}</div>
                <div>
                  <span className="font-mono text-[11px] text-muted">{INVOICE_STATUS_LABEL[inv.status]}</span>
                  {inv.failureMessage ? <div className="mt-0.5 max-w-[220px] truncate text-[11px] text-danger" title={inv.failureMessage}>{inv.failureMessage}</div> : null}
                </div>
                <div className="flex items-center justify-end gap-2">
                  {inv.hostedInvoiceUrl ? (
                    <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer" className="font-display text-[12.5px] font-medium text-violet hover:underline">View</a>
                  ) : null}
                  {inv.status === "failed" || inv.status === "action_required" || inv.status === "open" ? (
                    <form action={retryCharge}>
                      <input type="hidden" name="clientId" value={client.id} />
                      <input type="hidden" name="invoiceId" value={inv.id} />
                      <SubmitButton pendingLabel="Retrying…" title={cb?.card ? undefined : "Add a card first"} className="rounded-[8px] border border-ink/10 bg-white px-2.5 py-1 font-display text-[12px] font-medium text-ink transition-colors hover:bg-lavender">
                        Retry
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-ink/10 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 bg-surface-tint px-5 py-3.5">
        <div>
          <div className="font-display text-[14px] font-semibold">{title}</div>
          {subtitle ? <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">{subtitle}</div> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({ label, name, defaultValue, placeholder, type = "text", hint }: { label: string; name: string; defaultValue: string; placeholder: string; type?: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">{label}</span>
      <input type={type} name={name} defaultValue={defaultValue} placeholder={placeholder} className="rounded-[9px] border border-ink/10 bg-white px-2.5 py-[6px] font-mono text-[12.5px] text-ink placeholder:text-muted/60" />
      {hint ? <span className="text-[11px] text-muted">{hint}</span> : null}
    </label>
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
