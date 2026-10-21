/**
 * Billing arithmetic — pure, integer cents, no I/O, no `server-only`, unit-tested by
 * `npm run test:billing`.
 *
 * Two rules run through this module because it feeds invoices:
 *   1. Money is integer cents until the final format. No float arithmetic.
 *   2. The markup is applied ONCE to a total, never per day, so the invoice's usage line equals
 *      the Usage report figure × the multiplier (the reconciliation invariant in the spec).
 */
import type { LeadDetail, Overview, Timeseries } from "@/lib/types";

export const BPS_SCALE = 10_000;
/** 300 %. Anything above is almost certainly a typo. */
export const MARKUP_BPS_MAX = 30_000;
/** $100,000. */
export const FEE_CENTS_MAX = 10_000_000;
export const ANCHOR_DAY_MIN = 1;
/** 28: a 29th–31st anchor would silently never fire in a shorter month. */
export const ANCHOR_DAY_MAX = 28;

export function isValidBps(bps: number): boolean {
  return Number.isInteger(bps) && bps >= 0 && bps <= MARKUP_BPS_MAX;
}

export function isValidFeeCents(cents: number): boolean {
  return Number.isInteger(cents) && cents >= 0 && cents <= FEE_CENTS_MAX;
}

export function isValidAnchorDay(day: number): boolean {
  return Number.isInteger(day) && day >= ANCHOR_DAY_MIN && day <= ANCHOR_DAY_MAX;
}

/**
 * `cents × (1 + bps/10000)`, rounded half-up to the cent. Throws on invalid input rather than
 * billing a wrong number — callers on the invoice path want the loud failure; dashboard callers
 * round their inputs first (see the `markup*` helpers below).
 */
export function applyMarkup(cents: number, bps: number): number {
  if (!isValidBps(bps)) throw new RangeError(`invalid markup bps: ${bps}`);
  if (!Number.isInteger(cents)) throw new RangeError(`cents must be an integer: ${cents}`);
  return Math.round((cents * (BPS_SCALE + bps)) / BPS_SCALE);
}

/**
 * The markup a client is actually charged. Markup is not released yet: until `released`
 * (`BILLING_MARKUP_ENABLED`), it is 0 whatever is stored, so every invoice and every figure is
 * usage at cost plus the fee. Once released, a client override (0 included) beats the default.
 */
export function effectiveMarkupBps(override: number | null, platformDefault: number, released: boolean): number {
  return released ? (override ?? platformDefault) : 0;
}

// ---- Admin form inputs ----
// Decorated numbers ("20 %", "$1,200.50") parse; anything else is null so a form can show an
// error instead of silently saving 0.

const PERCENT_RE = /^\d{1,3}(\.\d{1,2})?$/;

/** "12.5" → 1250 basis points. Accepts a trailing % and surrounding whitespace. */
export function parsePercentToBps(input: string): number | null {
  const s = input.trim().replace(/%$/, "").trim();
  if (!PERCENT_RE.test(s)) return null;
  const [whole = "0", frac = ""] = s.split(".");
  const bps = Number(whole) * 100 + Number(`${frac}00`.slice(0, 2));
  return isValidBps(bps) ? bps : null;
}

/** 1250 → "12.5" — the form value for a stored markup. */
export function bpsToPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

const DOLLARS_RE = /^(?:\d{1,7}|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;

/**
 * "$1,200.50" → 120050. At most two decimals. Commas are accepted only as thousands grouping
 * ("1,200", "1,000,000"); any other comma placement ("300,00", "12,50") returns null.
 */
export function parseDollarsToCents(input: string): number | null {
  const s = input.trim().replace(/^\$/, "").trim();
  if (!DOLLARS_RE.test(s)) return null;
  const [whole = "0", frac = ""] = s.replace(/,/g, "").split(".");
  const cents = Number(whole) * 100 + Number(`${frac}00`.slice(0, 2));
  return isValidFeeCents(cents) ? cents : null;
}

/** 29999 → "299.99" — the form value for a stored fee. */
export function centsToDollarsInput(cents: number): string {
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}

export function parseAnchorDay(input: string): number | null {
  const s = input.trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return isValidAnchorDay(n) ? n : null;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `YYYY-MM` or null. */
export function parseMonthKey(input: string): string | null {
  const s = input.trim();
  return MONTH_RE.test(s) ? s : null;
}

// ---- Invoice composition ----

export interface InvoiceLines {
  rawUsageCents: number;
  markupBps: number;
  billedUsageCents: number;
  feeCents: number;
  totalCents: number;
}

/** The two invoice lines and their total. A zero total is the caller's signal to skip. */
export function composeInvoice(
  rawUsageCents: number,
  markupBps: number,
  feeCents: number,
): InvoiceLines {
  if (!isValidFeeCents(feeCents)) throw new RangeError(`invalid fee cents: ${feeCents}`);
  const billedUsageCents = applyMarkup(rawUsageCents, markupBps);
  return {
    rawUsageCents,
    markupBps,
    billedUsageCents,
    feeCents,
    totalCents: billedUsageCents + feeCents,
  };
}

// ---- Dashboard payloads ----
// Applied in lib/olivia/service.ts AFTER cachedFetch returns, so cached rows stay raw. Inputs
// are rounded first: an upstream float must not throw on a live page. 0 bps returns the same
// object so the common case allocates nothing.

function safeMarkup(cents: number | undefined, bps: number): number {
  return applyMarkup(Math.round(cents ?? 0), bps);
}

export function markupOverview(ov: Overview, bps: number): Overview {
  if (bps === 0) return ov;
  return {
    ...ov,
    kpis: {
      ...ov.kpis,
      spend: { ...ov.kpis.spend, total_cents: safeMarkup(ov.kpis.spend.total_cents, bps) },
    },
  };
}

export function markupTimeseries(ts: Timeseries, bps: number): Timeseries {
  if (bps === 0) return ts;
  return {
    ...ts,
    series: ts.series.map((p) => ({ ...p, spend_cents: safeMarkup(p.spend_cents, bps) })),
  };
}

export function markupLeadDetail(ld: LeadDetail, bps: number): LeadDetail {
  if (bps === 0) return ld;
  return {
    ...ld,
    summary: {
      ...ld.summary,
      total_spend_cents: safeMarkup(ld.summary.total_spend_cents, bps),
    },
  };
}

// ---- Currencies ----
// AI Power Credits are always USD. The service fee is the agency's retail price, in AUD or USD.

export const FEE_CURRENCIES = ["usd", "aud"] as const;
export type FeeCurrency = (typeof FEE_CURRENCIES)[number];
export const CREDITS_CURRENCY = "usd";

export function isFeeCurrency(v: unknown): v is FeeCurrency {
  return typeof v === "string" && (FEE_CURRENCIES as readonly string[]).includes(v);
}

/** A form value → a fee currency, or null when it is not one we bill in. */
export function parseFeeCurrency(input: string): FeeCurrency | null {
  const s = input.trim().toLowerCase();
  return isFeeCurrency(s) ? s : null;
}

/**
 * "$450.00 AUD" / "$12.40 USD": the amount always carries its currency code on billing screens,
 * because a client billed in two currencies must never have to guess which a "$" means.
 */
export function moneyWithCurrency(cents: number, currency: string): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")} ${currency.toUpperCase()}`;
}
