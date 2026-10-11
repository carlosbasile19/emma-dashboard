# Stripe Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clients save a card with Stripe and are charged automatically each month for the previous calendar month's Emma usage (with an optional markup) plus a flat monthly fee, configured per client by platform admins in the console.

**Architecture:** A daily Vercel cron decides which client-months are due, reads usage through the existing `getUsageSeries` seam (null is never $0), and creates an itemised Stripe Invoice that is charged to the card on file. Cards are captured by Stripe Checkout in setup mode (hosted, no card data or Stripe.js in this app), reachable from the client's Billing page or a public token link. Stripe webhooks keep the local card mirror and invoice statuses current and drive the notification emails. The markup is applied once in the service layer so every spend figure a client sees equals what they are billed.

**Tech Stack:** Next.js 15.5 App Router (TypeScript strict, `noUncheckedIndexedAccess`), Tailwind v4 tokens, Supabase (Postgres via service role, RLS deny-all), `stripe` Node SDK v23, Resend emails via `lib/email`, Vercel cron, `tsx` + `node:assert` selftests.

**Spec:** `docs/superpowers/specs/2026-10-11-stripe-billing-design.md` — executors read both. Where this plan differs from the spec it says so explicitly (two places: in-app card removal notifies directly rather than via the webhook, to avoid a race; and every Stripe-linked row carries a `livemode` flag so sandbox state cannot leak into live billing).

## Global Constraints

- Money is **integer cents** everywhere; the markup is applied **once** to a month total, rounded half-up; **a failed usage read is `null` and never bills $0**; the **current month is never invoiced**; a month is **unique per client** (`billing_invoices (olivia_client_id, period_month)`).
- Currency is `usd`. Markup stored in basis points (0–30000), fee in cents (0–10,000,000), anchor day 1–28, months as `YYYY-MM`.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are server-only (`import "server-only"` in every module that touches them). No `NEXT_PUBLIC_` Stripe variable. No card data reaches this app.
- Feature flag `BILLING_ENABLED=true` gates the cron, the billing routes and the markup. `CRON_SECRET` is mandatory when the flag is on (fail closed, like `/api/cron/snapshot`).
- Tenant identity comes from the session only: console actions call `requireAdmin()` and re-check the client id against `olivia_clients`; member actions use `getSessionClientId()`; the Checkout return path checks `session.customer` against the stored customer id.
- User-facing copy says **Emma / Hey Emma**, never the upstream vendor name. Internal identifiers (`lib/olivia/*`, `olivia_clients`) are unchanged.
- Follow existing patterns: admin server actions redirect with `?error=`/`?notice=` query params (see `app/console/actions.ts`); forms use `SubmitButton`; pages are server components; new routes get a `loading.tsx` using `Skeleton`; money on billing screens is formatted with `centsToMoneyExact` (never `centsToMoney`, which rounds to whole dollars).
- Development runs against the **Stripe sandbox** (`acct_1TZzk5GwOpbR9yqS`, `sk_test_…` in `.env`). Nothing touches the live account until Task 20, which runs only on the user's explicit go.
- Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Commit only the files named in the task; `docs/api-reference/` is an unrelated untracked directory — never `git add -A`.
- Typecheck with `npx tsc --noEmit` and lint with `npm run lint` before each commit that touches TypeScript.

## Review Focus

1. **An invalid client timezone from upstream** (e.g. `"Australia/Brisbane "` with a stray space already trimmed by `billingTz`, or a garbage string): the local date must fall back to UTC, never throw and abort the run for every client. Pinned in Task 3's selftest (`localDate` with `Not/AZone`).
2. **Admin form input with decoration** (`"20 %"`, `"$1,200.50"`, `"29"` for anchor day): decorated numbers parse; an out-of-range anchor day or three-decimal amount is rejected with an error, never silently saved as 0. Pinned in Task 2's selftest.
3. **A Stripe event for an object that is not ours** (another product on the same Stripe account, or a card detached during a replacement): the webhook must acknowledge with 200 and change nothing. Pinned in Task 4's selftest (`planTransition` → `ignore`).
4. **A month with zero usage but a non-zero fee**: still invoiced for the fee (only an all-zero total is skipped). Pinned in Task 2's selftest (`composeInvoice`).
5. **A redelivered or out-of-order webhook** after our synchronous `pay` already recorded the outcome: no second email and no status flip from `paid` back to `failed`. Pinned in Task 12 (handler only notifies on a status change) and exercised by Task 19's manual pass (Stripe CLI `stripe events resend`).

---

## File structure

| File | Responsibility |
|---|---|
| `lib/stripe/client.ts` | Server-only SDK singleton + `stripeLivemode()`. |
| `lib/billing/money.ts` | Pure arithmetic, parsing/formatting of admin inputs, invoice composition, markup on dashboard payloads. |
| `lib/billing/schedule.ts` | Pure calendar logic: local date in a timezone, month arithmetic, due months, next charge date. |
| `lib/billing/status.ts` | Pure statuses, setup-link state, webhook event → transition planning. |
| `lib/billing/copy.ts` | Pure user-facing billing copy (mandate, ordinals). |
| `lib/billing/config.ts` | Server: settings + per-client config rows, effective values, markup for the active client. |
| `lib/billing/customers.ts` | Server: Stripe Customer, card on file (set/replace/remove/mirror). |
| `lib/billing/setup.ts` | Server: setup links, Checkout sessions, return reconciliation. |
| `lib/billing/notify.ts` | Server: recipients + every billing email send. |
| `lib/billing/invoices.ts` | Server: `invoiceMonth`, `runBilling`, retry, listings, estimate. |
| `lib/billing/webhooks.ts` | Server: event idempotency + applying transitions. |
| `app/api/stripe/webhook/route.ts`, `app/api/cron/billing/route.ts` | Endpoints. |
| `app/billing/setup/[token]/*`, `components/billing/SetupCard.tsx` | Public card-setup page. |
| `app/dashboard/billing/*`, `components/dashboard/billing/BillingView.tsx` | Client Billing page. |
| `app/console/billing/*`, `components/console/BillingOverview.tsx`, `components/console/BillingClientView.tsx` | Admin pages. |
| `lib/email/templates.ts` | Seven new templates. |
| `supabase/migrations/20261011000007_emma_billing.sql` | Schema. |
| `scripts/billing-selftest.ts`, `scripts/billing-livecheck.ts` | Tests. |

---

### Task 1: Stripe SDK, client singleton, feature flag, env documentation

**Files:**
- Modify: `package.json` (dependency + two scripts)
- Create: `lib/stripe/client.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `getStripe(): Stripe`, `stripeLivemode(): boolean` (used by every server billing module).

- [ ] **Step 1: Install the SDK**

Run: `npm install stripe@^23.0.0`
Expected: `package.json` gains `"stripe": "^23.0.0"` under `dependencies`; `package-lock.json` updates.

- [ ] **Step 2: Add the test scripts to `package.json`**

In the `"scripts"` block, after `"test:localtime"`, add:

```json
    "test:billing": "tsx scripts/billing-selftest.ts",
    "billing:livecheck": "NODE_OPTIONS=--conditions=react-server tsx --env-file=.env scripts/billing-livecheck.ts"
```

(Both scripts are created in later tasks; adding the entries now keeps every later "Run:" line valid.)

- [ ] **Step 3: Create `lib/stripe/client.ts`**

```ts
import "server-only";
import Stripe from "stripe";

let client: Stripe | null = null;

/**
 * Server-only Stripe SDK singleton. The API version is the one bundled with the installed SDK
 * (pinned by package.json), so an SDK upgrade is the only way the version moves.
 */
export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  client = new Stripe(key, { appInfo: { name: "Hey Emma dashboard" } });
  return client;
}

/**
 * True when the configured key is a live key. Every Stripe-linked row we write carries this
 * flag, and a customer created under the other mode is treated as absent, so sandbox state
 * can never be charged against live keys (or vice versa).
 */
export function stripeLivemode(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_");
}
```

- [ ] **Step 4: Document the variables in `.env.example`**

Append to the end of `.env.example`:

```bash

# --- Stripe billing (SERVER-ONLY — never expose to the browser) ---
# Spec: docs/superpowers/specs/2026-10-11-stripe-billing-design.md
# Local + Preview use the SANDBOX secret key (sk_test_…); Production uses the live key (sk_live_…).
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxx
# Signing secret of the webhook endpoint that points at THIS environment.
# Local dev: printed by `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxx
# Feature flag: true enables the billing routes, the client-facing markup and the daily cron.
# BILLING_ENABLED=false
# When BILLING_ENABLED=true, CRON_SECRET (above) is mandatory — the billing cron fails closed.
```

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add package.json package-lock.json lib/stripe/client.ts .env.example
git commit -m "feat(billing): Stripe SDK, server-only client, env documentation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Pure money module (`lib/billing/money.ts`)

**Files:**
- Create: `lib/billing/money.ts`
- Create: `scripts/billing-selftest.ts` (first section; later tasks append to it)

**Interfaces:**
- Produces: `applyMarkup(cents, bps)`, `composeInvoice(raw, bps, fee): InvoiceLines`, `parsePercentToBps`, `bpsToPercent`, `parseDollarsToCents`, `centsToDollarsInput`, `parseAnchorDay`, `parseMonthKey`, `isValidBps`, `isValidFeeCents`, `isValidAnchorDay`, `markupOverview`, `markupTimeseries`, `markupLeadDetail`, constants `MARKUP_BPS_MAX`, `FEE_CENTS_MAX`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/billing-selftest.ts`:

```ts
import assert from "node:assert/strict";
import {
  applyMarkup,
  bpsToPercent,
  centsToDollarsInput,
  composeInvoice,
  MARKUP_BPS_MAX,
  markupLeadDetail,
  markupOverview,
  markupTimeseries,
  parseAnchorDay,
  parseDollarsToCents,
  parseMonthKey,
  parsePercentToBps,
} from "../lib/billing/money";
import type { LeadDetail, Overview, Timeseries } from "../lib/types";

// ---- applyMarkup: one rounding, on the total ----
assert.equal(applyMarkup(67791, 0), 67791);
assert.equal(applyMarkup(67791, 2000), 81349); // 67791 × 1.2 = 81349.2
assert.equal(applyMarkup(1, 5000), 2); // 1.5 rounds half-up
assert.equal(applyMarkup(3, 5000), 5); // 4.5 rounds half-up
assert.equal(applyMarkup(0, 2000), 0);
// Rounding once on the sum, not per day: three 1-cent days at 50% is 4.5 → 5, never 2+2+2.
assert.equal(applyMarkup(1 + 1 + 1, 5000), 5);
assert.throws(() => applyMarkup(100, -1), RangeError);
assert.throws(() => applyMarkup(100, MARKUP_BPS_MAX + 1), RangeError);
assert.throws(() => applyMarkup(10.5, 0), RangeError);

// ---- admin inputs: decorated numbers parse, garbage is null (never a silent 0) ----
assert.equal(parsePercentToBps("20"), 2000);
assert.equal(parsePercentToBps("12.5"), 1250);
assert.equal(parsePercentToBps("12.50"), 1250);
assert.equal(parsePercentToBps(" 7 % "), 700);
assert.equal(parsePercentToBps("0"), 0);
assert.equal(parsePercentToBps("300"), 30000);
assert.equal(parsePercentToBps("300.01"), null);
assert.equal(parsePercentToBps(""), null);
assert.equal(parsePercentToBps("abc"), null);
assert.equal(parsePercentToBps("-1"), null);
assert.equal(parsePercentToBps("1e2"), null);
assert.equal(bpsToPercent(0), "0");
assert.equal(bpsToPercent(2000), "20");
assert.equal(bpsToPercent(1250), "12.5");
assert.equal(bpsToPercent(1205), "12.05");
assert.equal(bpsToPercent(1), "0.01");

assert.equal(parseDollarsToCents("300"), 30000);
assert.equal(parseDollarsToCents("299.99"), 29999);
assert.equal(parseDollarsToCents("$1,200.50"), 120050);
assert.equal(parseDollarsToCents("0"), 0);
assert.equal(parseDollarsToCents("1.999"), null);
assert.equal(parseDollarsToCents("-5"), null);
assert.equal(parseDollarsToCents(""), null);
assert.equal(parseDollarsToCents("100000.01"), null); // over the $100,000 cap
assert.equal(centsToDollarsInput(30000), "300");
assert.equal(centsToDollarsInput(29999), "299.99");
assert.equal(centsToDollarsInput(5), "0.05");

assert.equal(parseAnchorDay("3"), 3);
assert.equal(parseAnchorDay("1"), 1);
assert.equal(parseAnchorDay("28"), 28);
assert.equal(parseAnchorDay("29"), null); // a 29th–31st would never fire in a short month
assert.equal(parseAnchorDay("0"), null);
assert.equal(parseAnchorDay("31"), null);
assert.equal(parseAnchorDay("abc"), null);
assert.equal(parseAnchorDay("2.5"), null);

assert.equal(parseMonthKey("2026-09"), "2026-09");
assert.equal(parseMonthKey(" 2026-09 "), "2026-09");
assert.equal(parseMonthKey("2026-13"), null);
assert.equal(parseMonthKey("2026-9"), null);
assert.equal(parseMonthKey("202609"), null);

// ---- composeInvoice ----
assert.deepEqual(composeInvoice(67791, 2000, 30000), {
  rawUsageCents: 67791,
  markupBps: 2000,
  billedUsageCents: 81349,
  feeCents: 30000,
  totalCents: 111349,
});
// Zero usage with a fee still produces an invoice (only an all-zero total is skipped).
assert.equal(composeInvoice(0, 2000, 30000).totalCents, 30000);
assert.equal(composeInvoice(5000, 0, 0).totalCents, 5000);
assert.equal(composeInvoice(0, 0, 0).totalCents, 0);
assert.throws(() => composeInvoice(100, 0, -1), RangeError);

// ---- dashboard payloads ----
const overview = {
  client_id: "c1",
  period: { from: "2026-09-01", to: "2026-09-30", tz: "UTC" },
  kpis: {
    leads_total: 1,
    calls_total: 1,
    pickup_rate: 0,
    avg_call_duration_sec: 0,
    bookings_rate: 0,
    converted_count: 0,
    spend: { total_cents: 1000, currency: "usd", basis: "billed_voice" },
    leads_by_stage: {},
  },
} as Overview;
const marked = markupOverview(overview, 2000);
assert.equal(marked.kpis.spend.total_cents, 1200);
assert.equal(overview.kpis.spend.total_cents, 1000, "input must not be mutated");
assert.equal(markupOverview(overview, 0), overview, "0 bps returns the same object");
// A float from upstream is rounded before the markup rather than throwing on a live page.
const floaty = { ...overview, kpis: { ...overview.kpis, spend: { ...overview.kpis.spend, total_cents: 10.6 } } } as Overview;
assert.equal(markupOverview(floaty, 0).kpis.spend.total_cents, 10.6);
assert.equal(markupOverview(floaty, 1000).kpis.spend.total_cents, 12); // round(10.6) = 11, × 1.1 = 12.1 → 12

const ts = {
  client_id: "c1",
  period: { from: "2026-09-01", to: "2026-09-02", tz: "UTC" },
  series: [
    { date: "2026-09-01", calls: 1, picked_up: 1, bookings: 0, spend_cents: 100 },
    { date: "2026-09-02", calls: 1, picked_up: 1, bookings: 0, spend_cents: 250 },
  ],
} as Timeseries;
assert.deepEqual(
  markupTimeseries(ts, 2000).series.map((p) => p.spend_cents),
  [120, 300],
);
assert.equal(ts.series[0]?.spend_cents, 100, "input must not be mutated");

const lead = {
  lead: { id: "l1" },
  pipeline: null,
  summary: { total_spend_cents: 333, currency: "usd", basis: "billed", calls: 1, bookings: 0, days_in_pipeline: 1 },
  calls: [],
  bookings: [],
  conversations: [],
} as unknown as LeadDetail;
assert.equal(markupLeadDetail(lead, 1000).summary.total_spend_cents, 366); // 366.3 → 366

console.log("billing-selftest: money OK");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:billing`
Expected: FAIL — `Cannot find module '../lib/billing/money'`.

- [ ] **Step 3: Implement `lib/billing/money.ts`**

```ts
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

const DOLLARS_RE = /^\d{1,7}(\.\d{1,2})?$/;

/** "$1,200.50" → 120050. At most two decimals. */
export function parseDollarsToCents(input: string): number | null {
  const s = input.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  if (!DOLLARS_RE.test(s)) return null;
  const [whole = "0", frac = ""] = s.split(".");
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:billing`
Expected: `billing-selftest: money OK`.

(If the `floaty` assertion fails, the arithmetic is: `Math.round(10.6) = 11`, `11 × 1.1 = 12.1`, `Math.round → 12`. The comment in the test shows the working.)

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

```bash
git add lib/billing/money.ts scripts/billing-selftest.ts
git commit -m "feat(billing): pure money module — markup, invoice lines, admin input parsing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Pure schedule module (`lib/billing/schedule.ts`) and copy (`lib/billing/copy.ts`)

**Files:**
- Create: `lib/billing/schedule.ts`
- Create: `lib/billing/copy.ts`
- Modify: `scripts/billing-selftest.ts` (append)

**Interfaces:**
- Produces: `localDate(now, tz)`, `monthOf(ymd)`, `dayOfMonth(ymd)`, `prevMonth(m)`, `nextMonth(m)`, `monthRange(from, to)`, `dueMonths({ today, anchorDay, billFromMonth, invoicedMonths })`, `closedMonthsWithoutInvoice(today, billFromMonth, invoicedMonths)`, `nextChargeDate(today, anchorDay)`; `ordinal(n)`, `mandateText(anchorDay)`, `CHECKOUT_SUBMIT_MESSAGE`, `BILLING_DISABLED_COPY`.

- [ ] **Step 1: Append the failing tests**

Append to `scripts/billing-selftest.ts` (before the final `console.log`, replace that line with the block's own log at the end):

```ts
import {
  closedMonthsWithoutInvoice,
  dueMonths,
  localDate,
  monthRange,
  nextChargeDate,
  nextMonth,
  prevMonth,
} from "../lib/billing/schedule";
import { mandateText, ordinal } from "../lib/billing/copy";

// ---- localDate: the client's calendar date decides which month closed ----
// 03:00 UTC is the cron time. Brisbane (UTC+10, no DST) is already 13:00 the same day;
// New York (UTC-4 in October) is still 23:00 the previous day.
assert.equal(localDate(new Date("2026-10-03T03:00:00Z"), "Australia/Brisbane"), "2026-10-03");
assert.equal(localDate(new Date("2026-10-03T03:00:00Z"), "America/New_York"), "2026-10-02");
// A UTC instant that is already tomorrow in Sydney.
assert.equal(localDate(new Date("2026-10-03T14:30:00Z"), "Australia/Sydney"), "2026-10-04");
assert.equal(localDate(new Date("2026-10-03T14:30:00Z"), "UTC"), "2026-10-03");
// Review Focus 1: an unknown zone falls back to UTC instead of throwing.
assert.equal(localDate(new Date("2026-10-03T14:30:00Z"), "Not/AZone"), "2026-10-03");

// ---- month arithmetic ----
assert.equal(prevMonth("2026-01"), "2025-12");
assert.equal(nextMonth("2026-12"), "2027-01");
assert.deepEqual(monthRange("2026-07", "2026-10"), ["2026-07", "2026-08", "2026-09", "2026-10"]);
assert.deepEqual(monthRange("2026-10", "2026-07"), []);
assert.deepEqual(monthRange("2026-10", "2026-10"), ["2026-10"]);

// ---- dueMonths ----
// On the anchor day, last month is due.
assert.deepEqual(
  dueMonths({ today: "2026-10-03", anchorDay: 3, billFromMonth: "2026-09", invoicedMonths: [] }),
  ["2026-09"],
);
// Before the anchor day, nothing.
assert.deepEqual(
  dueMonths({ today: "2026-10-02", anchorDay: 3, billFromMonth: "2026-09", invoicedMonths: [] }),
  [],
);
// Catch-up: older months are due regardless of the anchor; oldest first.
assert.deepEqual(
  dueMonths({ today: "2026-10-02", anchorDay: 3, billFromMonth: "2026-07", invoicedMonths: [] }),
  ["2026-07", "2026-08"],
);
assert.deepEqual(
  dueMonths({ today: "2026-10-03", anchorDay: 3, billFromMonth: "2026-07", invoicedMonths: [] }),
  ["2026-07", "2026-08", "2026-09"],
);
// An existing row (any status) removes its month.
assert.deepEqual(
  dueMonths({ today: "2026-10-03", anchorDay: 3, billFromMonth: "2026-07", invoicedMonths: ["2026-08"] }),
  ["2026-07", "2026-09"],
);
// The current month is never due, even on the last day.
assert.deepEqual(
  dueMonths({ today: "2026-10-31", anchorDay: 1, billFromMonth: "2026-10", invoicedMonths: [] }),
  [],
);
// Anchor 28 on the 28th fires.
assert.deepEqual(
  dueMonths({ today: "2026-02-28", anchorDay: 28, billFromMonth: "2026-01", invoicedMonths: [] }),
  ["2026-01"],
);

// ---- closedMonthsWithoutInvoice: the "Charge now" picker ----
assert.deepEqual(closedMonthsWithoutInvoice("2026-10-15", "2026-07", ["2026-08"]), ["2026-07", "2026-09"]);
assert.deepEqual(closedMonthsWithoutInvoice("2026-10-15", "2026-10", []), []);

// ---- nextChargeDate ----
assert.equal(nextChargeDate("2026-10-02", 3), "2026-10-03");
assert.equal(nextChargeDate("2026-10-03", 3), "2026-10-03");
assert.equal(nextChargeDate("2026-10-04", 3), "2026-11-03");
assert.equal(nextChargeDate("2026-12-31", 1), "2027-01-01");

// ---- copy ----
assert.equal(ordinal(1), "1st");
assert.equal(ordinal(2), "2nd");
assert.equal(ordinal(3), "3rd");
assert.equal(ordinal(4), "4th");
assert.equal(ordinal(11), "11th");
assert.equal(ordinal(12), "12th");
assert.equal(ordinal(13), "13th");
assert.equal(ordinal(21), "21st");
assert.equal(ordinal(22), "22nd");
assert.equal(ordinal(23), "23rd");
assert.match(mandateText(3), /on the 3rd of each month/);
assert.doesNotMatch(mandateText(3), /Olivia/);

console.log("billing-selftest: schedule + copy OK");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:billing`
Expected: FAIL — `Cannot find module '../lib/billing/schedule'`.

- [ ] **Step 3: Implement `lib/billing/schedule.ts`**

```ts
/**
 * The billing calendar — pure, no I/O, no `server-only`.
 *
 * Every date here is a `YYYY-MM-DD` string in the CLIENT's own timezone and every month a
 * `YYYY-MM`; both compare lexicographically, so there is no Date arithmetic on the hot path and
 * no process timezone can leak in. The only place a Date meets a timezone is `localDate`.
 */
import type { MonthKey } from "@/lib/usage";

export type { MonthKey };

/**
 * The calendar date in an IANA timezone. An unknown zone falls back to UTC rather than
 * throwing: one bad client timezone must not abort the billing run for every client.
 */
export function localDate(now: Date, tz: string): string {
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  try {
    return fmt(tz);
  } catch {
    return fmt("UTC");
  }
}

export function monthOf(ymd: string): MonthKey {
  return ymd.slice(0, 7);
}

export function dayOfMonth(ymd: string): number {
  return Number(ymd.slice(8, 10));
}

function shiftMonth(m: MonthKey, delta: number): MonthKey {
  const y = Number(m.slice(0, 4));
  const zeroBased = Number(m.slice(5, 7)) - 1 + delta;
  const yy = y + Math.floor(zeroBased / 12);
  const mm = ((zeroBased % 12) + 12) % 12 + 1;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}

export function prevMonth(m: MonthKey): MonthKey {
  return shiftMonth(m, -1);
}

export function nextMonth(m: MonthKey): MonthKey {
  return shiftMonth(m, 1);
}

/** Inclusive, ascending. Empty when `from` is after `to`. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let m = from; m <= to; m = nextMonth(m)) out.push(m);
  return out;
}

export interface DueArgs {
  /** Today in the client's timezone. */
  today: string;
  anchorDay: number;
  billFromMonth: MonthKey;
  /** Months that already have a `billing_invoices` row, in any status. */
  invoicedMonths: Iterable<MonthKey>;
}

/**
 * The months owed right now, oldest first.
 *
 * The most recent closed month waits for the anchor day so upstream usage can settle. Older
 * months (catch-up after enabling billing with an earlier bill-from, or after a missed run)
 * are past that window and are due immediately. The current month is never included.
 */
export function dueMonths({ today, anchorDay, billFromMonth, invoicedMonths }: DueArgs): MonthKey[] {
  const prev = prevMonth(monthOf(today));
  const done = new Set(invoicedMonths);
  const anchorPassed = dayOfMonth(today) >= anchorDay;
  return monthRange(billFromMonth, prev).filter((m) => !done.has(m) && (m < prev || anchorPassed));
}

/** Closed months with no row yet — the choices for an admin's "Charge now". Ignores the anchor. */
export function closedMonthsWithoutInvoice(
  today: string,
  billFromMonth: MonthKey,
  invoicedMonths: Iterable<MonthKey>,
): MonthKey[] {
  const done = new Set(invoicedMonths);
  return monthRange(billFromMonth, prevMonth(monthOf(today))).filter((m) => !done.has(m));
}

/** The first date on or after `today` whose day-of-month is the anchor day. */
export function nextChargeDate(today: string, anchorDay: number): string {
  const day = String(anchorDay).padStart(2, "0");
  const m = monthOf(today);
  return dayOfMonth(today) <= anchorDay ? `${m}-${day}` : `${nextMonth(m)}-${day}`;
}
```

- [ ] **Step 4: Implement `lib/billing/copy.ts`**

```ts
/**
 * User-facing billing copy. Says Emma / Hey Emma; "Skilled Coaching" is the agency's legal
 * entity and the name on the card statement, so the mandate names it too.
 */

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** The off-session mandate shown before Checkout. Card-network rules require it. */
export function mandateText(anchorDay: number): string {
  return (
    `By saving a card you authorise Hey Emma (Skilled Coaching) to charge it automatically on the ` +
    `${ordinal(anchorDay)} of each month for the previous month's Emma usage plus the monthly fee ` +
    `shown on your Billing page. You can replace or remove the card at any time from your Billing page.`
  );
}

/** Shown inside Stripe Checkout above the submit button (max 1,200 characters). */
export const CHECKOUT_SUBMIT_MESSAGE =
  "Your card will be charged automatically each month for your Emma usage and monthly fee. " +
  "You can replace or remove it at any time from your Billing page.";

export const BILLING_DISABLED_COPY = {
  title: "Billing isn't set up for this workspace",
  body: "Your Hey Emma administrator hasn't switched on automatic billing here yet. Nothing is charged until they do.",
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:billing`
Expected: both `OK` lines print.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add lib/billing/schedule.ts lib/billing/copy.ts scripts/billing-selftest.ts
git commit -m "feat(billing): pure schedule module (due months, local dates) and billing copy

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Pure status and webhook-transition module (`lib/billing/status.ts`)

**Files:**
- Create: `lib/billing/status.ts`
- Modify: `scripts/billing-selftest.ts` (append)

**Interfaces:**
- Produces: `InvoiceStatus`, `INVOICE_STATUSES`, `isInvoiceStatus`, `ClientBillingStatus`, `STATUS_LABEL`, `deriveStatus`, `invoiceStatusFromStripe`, `SetupLinkState`, `setupLinkState`, `WebhookEventShape`, `eventSubject`, `TransitionContext`, `BillingTransition`, `planTransition`.

- [ ] **Step 1: Append the failing tests**

Append to `scripts/billing-selftest.ts`:

```ts
import {
  deriveStatus,
  eventSubject,
  invoiceStatusFromStripe,
  planTransition,
  setupLinkState,
  type WebhookEventShape,
} from "../lib/billing/status";

// ---- deriveStatus ----
assert.equal(deriveStatus({ enabled: false, hasCard: true, lastInvoiceStatus: "paid" }), "off");
assert.equal(deriveStatus({ enabled: true, hasCard: false, lastInvoiceStatus: null }), "no_card");
assert.equal(deriveStatus({ enabled: true, hasCard: true, lastInvoiceStatus: null }), "active");
assert.equal(deriveStatus({ enabled: true, hasCard: true, lastInvoiceStatus: "paid" }), "active");
assert.equal(deriveStatus({ enabled: true, hasCard: true, lastInvoiceStatus: "open" }), "active");
assert.equal(deriveStatus({ enabled: true, hasCard: true, lastInvoiceStatus: "failed" }), "payment_failed");
assert.equal(deriveStatus({ enabled: true, hasCard: true, lastInvoiceStatus: "uncollectible" }), "payment_failed");
assert.equal(deriveStatus({ enabled: true, hasCard: true, lastInvoiceStatus: "action_required" }), "action_required");
assert.equal(deriveStatus({ enabled: true, hasCard: true, lastInvoiceStatus: "skipped_zero" }), "active");

// ---- invoiceStatusFromStripe ----
assert.equal(invoiceStatusFromStripe("paid"), "paid");
assert.equal(invoiceStatusFromStripe("open"), "open");
assert.equal(invoiceStatusFromStripe("void"), "void");
assert.equal(invoiceStatusFromStripe("uncollectible"), "uncollectible");
assert.equal(invoiceStatusFromStripe("draft"), "reserved");
assert.equal(invoiceStatusFromStripe(undefined), "open");

// ---- setupLinkState ----
const NOW = new Date("2026-10-11T10:00:00Z");
assert.equal(setupLinkState({ status: "pending", expiresAt: "2026-10-18T10:00:00Z" }, NOW), "valid");
assert.equal(setupLinkState({ status: "pending", expiresAt: "2026-10-10T10:00:00Z" }, NOW), "expired");
assert.equal(setupLinkState({ status: "revoked", expiresAt: "2026-10-18T10:00:00Z" }, NOW), "revoked");
assert.equal(setupLinkState({ status: "completed", expiresAt: "2026-10-18T10:00:00Z" }, NOW), "completed");
assert.equal(setupLinkState({ status: "weird", expiresAt: "2026-10-18T10:00:00Z" }, NOW), "invalid");
assert.equal(setupLinkState({ status: "pending", expiresAt: "not a date" }, NOW), "invalid");

// ---- webhook events ----
const ev = (type: string, object: Record<string, unknown>): WebhookEventShape => ({
  id: `evt_${type}`,
  type,
  data: { object },
});
const CTX_NONE = { clientId: null, mirroredPaymentMethodId: null };
const CTX_C1 = { clientId: "c1", mirroredPaymentMethodId: "pm_on_file" };

// eventSubject pulls the ids the server needs to resolve a client.
assert.deepEqual(eventSubject(ev("payment_method.detached", { id: "pm_1", customer: null })), {
  customerId: null,
  paymentMethodId: "pm_1",
  clientIdFromMetadata: null,
});
assert.deepEqual(eventSubject(ev("customer.updated", { id: "cus_1", metadata: { emma_client_id: "c1" } })), {
  customerId: "cus_1",
  paymentMethodId: null,
  clientIdFromMetadata: "c1",
});
assert.deepEqual(
  eventSubject(ev("invoice.paid", { id: "in_1", customer: "cus_1", metadata: { emma_client_id: "c1", emma_period: "2026-09" } })),
  { customerId: "cus_1", paymentMethodId: null, clientIdFromMetadata: "c1" },
);
assert.deepEqual(eventSubject(ev("checkout.session.completed", { id: "cs_1", customer: { id: "cus_1" }, metadata: { emma_client_id: "c1" } })), {
  customerId: "cus_1",
  paymentMethodId: null,
  clientIdFromMetadata: "c1",
});

// checkout.session.completed → reconcile; non-setup or non-Emma sessions are ignored.
assert.deepEqual(
  planTransition(ev("checkout.session.completed", { id: "cs_1", mode: "setup", metadata: { emma_client_id: "c1" } }), CTX_C1),
  { kind: "reconcile_checkout", sessionId: "cs_1", clientId: "c1" },
);
assert.equal(planTransition(ev("checkout.session.completed", { id: "cs_2", mode: "payment", metadata: { emma_client_id: "c1" } }), CTX_C1).kind, "ignore");
assert.equal(planTransition(ev("checkout.session.completed", { id: "cs_3", mode: "setup", metadata: {} }), CTX_NONE).kind, "ignore");

// payment_method.detached: only the card on file clears + notifies. Review Focus 3: a card
// detached during a replacement (no longer the mirror) and a card we never knew are ignored.
assert.deepEqual(planTransition(ev("payment_method.detached", { id: "pm_on_file" }), CTX_C1), {
  kind: "card_cleared",
  clientId: "c1",
  notify: true,
});
assert.equal(planTransition(ev("payment_method.detached", { id: "pm_old" }), CTX_C1).kind, "ignore");
assert.equal(planTransition(ev("payment_method.detached", { id: "pm_x" }), CTX_NONE).kind, "ignore");

// payment_method.automatically_updated refreshes the mirror for the card on file only.
assert.deepEqual(planTransition(ev("payment_method.automatically_updated", { id: "pm_on_file" }), CTX_C1), {
  kind: "card_refresh",
  clientId: "c1",
  paymentMethodId: "pm_on_file",
});
assert.equal(planTransition(ev("payment_method.automatically_updated", { id: "pm_other" }), CTX_C1).kind, "ignore");

// customer.updated: unchanged default → ignore; new default → refresh; null → clear WITHOUT notify.
assert.equal(
  planTransition(ev("customer.updated", { id: "cus_1", invoice_settings: { default_payment_method: "pm_on_file" } }), CTX_C1).kind,
  "ignore",
);
assert.deepEqual(
  planTransition(ev("customer.updated", { id: "cus_1", invoice_settings: { default_payment_method: "pm_new" } }), CTX_C1),
  { kind: "card_refresh", clientId: "c1", paymentMethodId: "pm_new" },
);
assert.deepEqual(
  planTransition(ev("customer.updated", { id: "cus_1", invoice_settings: { default_payment_method: null } }), CTX_C1),
  { kind: "card_cleared", clientId: "c1", notify: false },
);
assert.equal(planTransition(ev("customer.updated", { id: "cus_other" }), CTX_NONE).kind, "ignore");

assert.deepEqual(planTransition(ev("customer.deleted", { id: "cus_1" }), CTX_C1), { kind: "customer_deleted", clientId: "c1" });
assert.equal(planTransition(ev("customer.deleted", { id: "cus_other" }), CTX_NONE).kind, "ignore");

// invoice.* events are scoped by metadata; the status and the notification flags are data.
const INV = { id: "in_1", status: "paid", hosted_invoice_url: "https://inv", invoice_pdf: "https://pdf", metadata: { emma_client_id: "c1", emma_period: "2026-09" } };
const paid = planTransition(ev("invoice.paid", { ...INV, status_transitions: { paid_at: 1_790_000_000 } }), CTX_NONE);
assert.equal(paid.kind, "invoice_status");
if (paid.kind === "invoice_status") {
  assert.equal(paid.status, "paid");
  assert.equal(paid.paidAt, new Date(1_790_000_000 * 1000).toISOString());
  assert.equal(paid.hostedInvoiceUrl, "https://inv");
  assert.equal(paid.notifyAdmins, false);
  assert.equal(paid.clientId, "c1");
  assert.equal(paid.periodMonth, "2026-09");
}
const failed = planTransition(ev("invoice.payment_failed", { ...INV, status: "open" }), CTX_NONE);
if (failed.kind === "invoice_status") {
  assert.equal(failed.status, "failed");
  assert.equal(failed.lookupFailure, true, "the server looks up the decline reason");
  assert.equal(failed.notifyAdmins, true);
  assert.equal(failed.notifyClient, true);
} else assert.fail("expected invoice_status");
const action = planTransition(ev("invoice.payment_action_required", INV), CTX_NONE);
if (action.kind === "invoice_status") assert.equal(action.status, "action_required");
else assert.fail("expected invoice_status");
const fin = planTransition(ev("invoice.finalization_failed", { ...INV, last_finalization_error: { message: "no default payment method" } }), CTX_NONE);
if (fin.kind === "invoice_status") {
  assert.equal(fin.status, "failed");
  assert.equal(fin.failureMessage, "no default payment method");
  assert.equal(fin.notifyAdmins, true);
  assert.equal(fin.notifyClient, false);
} else assert.fail("expected invoice_status");
const voided = planTransition(ev("invoice.voided", INV), CTX_NONE);
if (voided.kind === "invoice_status") assert.equal(voided.status, "void");
else assert.fail("expected invoice_status");
const unc = planTransition(ev("invoice.marked_uncollectible", INV), CTX_NONE);
if (unc.kind === "invoice_status") assert.equal(unc.status, "uncollectible");
else assert.fail("expected invoice_status");
// Review Focus 3: an invoice without Emma metadata (another product on the account) is ignored.
assert.equal(planTransition(ev("invoice.paid", { id: "in_other", metadata: {} }), CTX_NONE).kind, "ignore");
// Unknown event types are ignored, never thrown.
assert.equal(planTransition(ev("charge.refunded", { id: "ch_1" }), CTX_C1).kind, "ignore");

console.log("billing-selftest: status + transitions OK");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:billing`
Expected: FAIL — `Cannot find module '../lib/billing/status'`.

- [ ] **Step 3: Implement `lib/billing/status.ts`**

```ts
/**
 * Billing statuses and webhook transition planning — pure, no I/O, no `server-only`.
 *
 * `planTransition` turns a Stripe event into a description of what should change. The server
 * (lib/billing/webhooks.ts) resolves ids to a client first, then applies the plan. Keeping the
 * decision pure means every event type is unit-tested without Stripe or a database.
 */

export const INVOICE_STATUSES = [
  "reserved",
  "open",
  "paid",
  "failed",
  "action_required",
  "void",
  "uncollectible",
  "skipped_zero",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export function isInvoiceStatus(s: string): s is InvoiceStatus {
  return (INVOICE_STATUSES as readonly string[]).includes(s);
}

export type ClientBillingStatus = "off" | "no_card" | "active" | "payment_failed" | "action_required";

export const STATUS_LABEL: Record<ClientBillingStatus, string> = {
  off: "Off",
  no_card: "No card",
  active: "Active",
  payment_failed: "Payment failed",
  action_required: "Action required",
};

/** The badge for a client. `open` is a payment still in flight, so it reads as active. */
export function deriveStatus(a: {
  enabled: boolean;
  hasCard: boolean;
  lastInvoiceStatus: InvoiceStatus | null;
}): ClientBillingStatus {
  if (!a.enabled) return "off";
  if (!a.hasCard) return "no_card";
  if (a.lastInvoiceStatus === "action_required") return "action_required";
  if (a.lastInvoiceStatus === "failed" || a.lastInvoiceStatus === "uncollectible") return "payment_failed";
  return "active";
}

/** Stripe's invoice status → ours. Anything unrecognised is treated as still open. */
export function invoiceStatusFromStripe(s: string | null | undefined): InvoiceStatus {
  switch (s) {
    case "paid":
      return "paid";
    case "void":
      return "void";
    case "uncollectible":
      return "uncollectible";
    case "draft":
      return "reserved";
    default:
      return "open";
  }
}

export type SetupLinkState = "valid" | "expired" | "revoked" | "completed" | "invalid";

export function setupLinkState(row: { status: string; expiresAt: string }, now: Date): SetupLinkState {
  if (row.status === "revoked") return "revoked";
  if (row.status === "completed") return "completed";
  if (row.status !== "pending") return "invalid";
  const exp = Date.parse(row.expiresAt);
  if (Number.isNaN(exp)) return "invalid";
  return exp > now.getTime() ? "valid" : "expired";
}

// ---- Webhook transitions ----

/** The slice of a Stripe event this module reads. Structural so tests need no SDK types. */
export interface WebhookEventShape {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface EventSubject {
  customerId: string | null;
  paymentMethodId: string | null;
  clientIdFromMetadata: string | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** A Stripe reference is either an id string or an expanded object with an id. */
function idOf(v: unknown): string | null {
  if (typeof v === "string") return str(v);
  if (v && typeof v === "object" && "id" in v) return str((v as { id: unknown }).id);
  return null;
}

function meta(o: Record<string, unknown>, key: string): string | null {
  const m = o.metadata;
  return m && typeof m === "object" ? str((m as Record<string, unknown>)[key]) : null;
}

/** The ids the server must resolve to a client before planning. */
export function eventSubject(ev: WebhookEventShape): EventSubject {
  const o = ev.data.object;
  if (ev.type.startsWith("payment_method.")) {
    return { customerId: idOf(o.customer), paymentMethodId: str(o.id), clientIdFromMetadata: null };
  }
  if (ev.type.startsWith("customer.")) {
    return { customerId: str(o.id), paymentMethodId: null, clientIdFromMetadata: meta(o, "emma_client_id") };
  }
  if (ev.type.startsWith("invoice.") || ev.type.startsWith("checkout.")) {
    return { customerId: idOf(o.customer), paymentMethodId: null, clientIdFromMetadata: meta(o, "emma_client_id") };
  }
  return { customerId: null, paymentMethodId: null, clientIdFromMetadata: null };
}

export interface TransitionContext {
  /** The client the event's customer / payment method belongs to, or null when unknown to us. */
  clientId: string | null;
  /** The payment method currently mirrored as that client's card on file. */
  mirroredPaymentMethodId: string | null;
}

export type BillingTransition =
  | { kind: "ignore"; reason: string }
  | { kind: "reconcile_checkout"; sessionId: string; clientId: string }
  | { kind: "card_cleared"; clientId: string; notify: boolean }
  | { kind: "card_refresh"; clientId: string; paymentMethodId: string }
  | { kind: "customer_deleted"; clientId: string }
  | {
      kind: "invoice_status";
      clientId: string;
      periodMonth: string;
      stripeInvoiceId: string;
      status: InvoiceStatus;
      hostedInvoiceUrl: string | null;
      invoicePdfUrl: string | null;
      paidAt: string | null;
      failureMessage: string | null;
      /** The decline reason lives on the PaymentIntent; the server fetches it when true. */
      lookupFailure: boolean;
      notifyAdmins: boolean;
      notifyClient: boolean;
    };

const INVOICE_EVENTS = new Set([
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.finalization_failed",
  "invoice.voided",
  "invoice.marked_uncollectible",
]);

export function planTransition(ev: WebhookEventShape, ctx: TransitionContext): BillingTransition {
  const o = ev.data.object;

  if (ev.type === "checkout.session.completed") {
    const clientId = meta(o, "emma_client_id");
    if (o.mode !== "setup" || !clientId) return { kind: "ignore", reason: "not an Emma setup session" };
    return { kind: "reconcile_checkout", sessionId: String(o.id), clientId };
  }

  if (ev.type === "payment_method.detached") {
    if (!ctx.clientId || ctx.mirroredPaymentMethodId !== str(o.id)) {
      return { kind: "ignore", reason: "not the card on file" };
    }
    return { kind: "card_cleared", clientId: ctx.clientId, notify: true };
  }

  if (ev.type === "payment_method.automatically_updated") {
    if (!ctx.clientId || ctx.mirroredPaymentMethodId !== str(o.id)) {
      return { kind: "ignore", reason: "not the card on file" };
    }
    return { kind: "card_refresh", clientId: ctx.clientId, paymentMethodId: String(o.id) };
  }

  if (ev.type === "customer.updated") {
    if (!ctx.clientId) return { kind: "ignore", reason: "customer not on file" };
    const settings = o.invoice_settings as Record<string, unknown> | undefined;
    const pm = idOf(settings?.default_payment_method);
    if (pm === ctx.mirroredPaymentMethodId) return { kind: "ignore", reason: "default card unchanged" };
    return pm
      ? { kind: "card_refresh", clientId: ctx.clientId, paymentMethodId: pm }
      : { kind: "card_cleared", clientId: ctx.clientId, notify: false };
  }

  if (ev.type === "customer.deleted") {
    if (!ctx.clientId) return { kind: "ignore", reason: "customer not on file" };
    return { kind: "customer_deleted", clientId: ctx.clientId };
  }

  if (INVOICE_EVENTS.has(ev.type)) {
    const clientId = meta(o, "emma_client_id");
    const periodMonth = meta(o, "emma_period");
    if (!clientId || !periodMonth) return { kind: "ignore", reason: "not an Emma invoice" };
    const base = {
      clientId,
      periodMonth,
      stripeInvoiceId: String(o.id),
      hostedInvoiceUrl: str(o.hosted_invoice_url),
      invoicePdfUrl: str(o.invoice_pdf),
      paidAt: null as string | null,
      failureMessage: null as string | null,
      lookupFailure: false,
      notifyAdmins: false,
      notifyClient: false,
    };
    switch (ev.type) {
      case "invoice.paid": {
        const transitions = o.status_transitions as Record<string, unknown> | undefined;
        const paidAtSec = transitions?.paid_at;
        const paidAt = typeof paidAtSec === "number" ? new Date(paidAtSec * 1000).toISOString() : null;
        return { kind: "invoice_status", ...base, status: "paid", paidAt };
      }
      case "invoice.payment_failed":
        return { kind: "invoice_status", ...base, status: "failed", lookupFailure: true, notifyAdmins: true, notifyClient: true };
      case "invoice.payment_action_required":
        return { kind: "invoice_status", ...base, status: "action_required", notifyAdmins: true, notifyClient: true };
      case "invoice.finalization_failed": {
        const err = o.last_finalization_error as Record<string, unknown> | undefined;
        return {
          kind: "invoice_status",
          ...base,
          status: "failed",
          failureMessage: str(err?.message) ?? "Invoice could not be finalised",
          notifyAdmins: true,
        };
      }
      case "invoice.voided":
        return { kind: "invoice_status", ...base, status: "void" };
      default:
        return { kind: "invoice_status", ...base, status: "uncollectible" };
    }
  }

  return { kind: "ignore", reason: `unhandled event type ${ev.type}` };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:billing`
Expected: three `OK` lines.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add lib/billing/status.ts scripts/billing-selftest.ts
git commit -m "feat(billing): pure status derivation and webhook transition planner

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 5: Database migration

**Files:**
- Create: `supabase/migrations/20261011000007_emma_billing.sql`

**Interfaces:**
- Produces: tables `billing_settings` (singleton), `client_billing`, `billing_invoices`, `billing_setup_links`, `billing_events`, `billing_runs` — all RLS-enabled with no policies (service role only). Column names are the contract every server module in Tasks 6–12 reads.

- [ ] **Step 1: Write the migration**

```sql
-- Stripe billing: platform defaults, per-client config + card mirror, invoices, card-setup
-- links, webhook idempotency and the run log. Every table is service-role only — RLS enabled
-- with NO policies denies anon/authenticated, exactly like `invites`. All money is integer
-- cents; markup is basis points; months are 'YYYY-MM'.
--
-- `livemode` columns: rows written while the app ran on a sandbox key are tagged false. The
-- server ignores a Stripe customer created under the other key mode, so sandbox state can
-- never be charged against live keys.

create table if not exists public.billing_settings (
  id int primary key default 1 check (id = 1),
  markup_bps int not null default 0 check (markup_bps between 0 and 30000),
  fee_cents int not null default 0 check (fee_cents >= 0),
  anchor_day int not null default 3 check (anchor_day between 1 and 28),
  currency text not null default 'usd',
  alert_email text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
comment on table public.billing_settings is 'Platform-wide billing defaults (single row, id = 1).';
insert into public.billing_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.client_billing (
  olivia_client_id text primary key references public.olivia_clients(olivia_client_id),
  enabled boolean not null default false,
  stripe_customer_id text unique,
  stripe_livemode boolean,
  billing_email text,
  bill_from_month text check (bill_from_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- Per-client overrides; null = use billing_settings.
  markup_bps int check (markup_bps between 0 and 30000),
  fee_cents int check (fee_cents >= 0),
  anchor_day int check (anchor_day between 1 and 28),
  -- Mirror of the card on file (Stripe is the source of truth; webhooks keep this current).
  default_payment_method_id text,
  card_brand text,
  card_last4 text,
  card_exp_month int,
  card_exp_year int,
  card_added_at timestamptz,
  card_removed_at timestamptz,
  -- The last due month an admin was emailed "no card on file" for — alert once per month.
  no_card_alerted_month text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
comment on table public.client_billing is 'Per-workspace Stripe billing config + card-on-file mirror.';
create index if not exists client_billing_pm_idx on public.client_billing (default_payment_method_id);

create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  olivia_client_id text not null,
  period_month text not null check (period_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  period_from date,
  period_to date,
  tz text,
  raw_usage_cents int,
  markup_bps int,
  billed_usage_cents int,
  fee_cents int,
  total_cents int,
  currency text not null default 'usd',
  stripe_invoice_id text unique,
  hosted_invoice_url text,
  invoice_pdf_url text,
  -- reserved | open | paid | failed | action_required | void | uncollectible | skipped_zero
  status text not null default 'reserved',
  failure_code text,
  failure_message text,
  trigger text not null default 'cron', -- cron | manual
  created_by uuid references auth.users(id) on delete set null,
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  -- THE idempotency guard: a client-month can never be invoiced twice.
  unique (olivia_client_id, period_month)
);
comment on table public.billing_invoices is 'One row per client per billed month; the (client, month) pair is unique.';
create index if not exists billing_invoices_client_idx on public.billing_invoices (olivia_client_id, period_month desc);

create table if not exists public.billing_setup_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  olivia_client_id text not null,
  created_by uuid references auth.users(id) on delete set null,
  sent_to text,
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'pending', -- pending | completed | revoked
  completed_at timestamptz
);
comment on table public.billing_setup_links is 'Public card-setup links (token-gated, 7-day TTL, reusable until completed).';
create index if not exists billing_setup_links_client_idx on public.billing_setup_links (olivia_client_id);

create table if not exists public.billing_events (
  stripe_event_id text primary key,
  type text not null,
  livemode boolean not null default false,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
comment on table public.billing_events is 'Stripe webhook idempotency: processed events are no-ops on redelivery.';

create table if not exists public.billing_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null, -- cron | manual
  livemode boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb
);
comment on table public.billing_runs is 'One row per billing run with per-client outcomes.';

alter table public.billing_settings enable row level security;
alter table public.client_billing enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_setup_links enable row level security;
alter table public.billing_events enable row level security;
alter table public.billing_runs enable row level security;
-- No policies on purpose: only the service role (server code) may read or write billing data.
```

- [ ] **Step 2: Apply it to the Supabase project**

This repo has one Supabase project (`zieagshjnznbmdlfhssr`) used by local dev and production alike; earlier features applied their migrations the same way. Apply with the Supabase MCP tool `apply_migration` (`name: "emma_billing"`, `query:` the SQL above, verbatim).

- [ ] **Step 3: Verify the tables exist and are locked down**

With the Supabase MCP `execute_sql`:

```sql
select c.relname as table_name, c.relrowsecurity as rls_on,
       (select count(*) from pg_policies p where p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('billing_settings','client_billing','billing_invoices','billing_setup_links','billing_events','billing_runs')
order by 1;
```

Expected: six rows, `rls_on = true`, `policies = 0`. Then `select * from public.billing_settings;` → exactly one row with `id = 1`, `anchor_day = 3`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261011000007_emma_billing.sql
git commit -m "feat(billing): schema — settings, client config, invoices, setup links, events, runs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Server config module (`lib/billing/config.ts`)

**Files:**
- Create: `lib/billing/config.ts`

**Interfaces:**
- Consumes: Task 2 validators; Task 5 columns.
- Produces: `billingFeatureEnabled()`, `BillingSettings`, `DEFAULT_SETTINGS`, `CardOnFile`, `ClientBilling`, `loadBillingSettings()`, `getBillingSettings()` (per-request memo), `rowToClientBilling(row, settings)`, `loadClientBilling(clientId)`, `getClientBilling(clientId)` (memo), `listClientBilling()`, `clientIdForCustomer(customerId)`, `clientIdForPaymentMethod(pmId)`, `ClientBillingPatch`, `upsertClientBilling(clientId, patch, userId)`, `updateClientBillingColumns(clientId, cols)`, `saveBillingSettings(patch, userId)`, `activeMarkupBps()`.

- [ ] **Step 1: Create `lib/billing/config.ts`**

```ts
import "server-only";
import { cache } from "react";
import { getSessionClientId } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidAnchorDay, isValidBps, isValidFeeCents } from "./money";

/**
 * Billing configuration: the platform defaults row and one row per client, read through the
 * service role (these tables have no RLS policies). `get*` variants are React `cache()`d so a
 * page that asks three times pays one query; after a WRITE use the `load*` variant, which
 * always hits the database.
 */

export function billingFeatureEnabled(): boolean {
  return process.env.BILLING_ENABLED === "true";
}

export interface BillingSettings {
  markupBps: number;
  feeCents: number;
  anchorDay: number;
  currency: string;
  alertEmail: string | null;
  updatedAt: string | null;
}

export const DEFAULT_SETTINGS: BillingSettings = {
  markupBps: 0,
  feeCents: 0,
  anchorDay: 3,
  currency: "usd",
  alertEmail: null,
  updatedAt: null,
};

export interface CardOnFile {
  paymentMethodId: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  addedAt: string | null;
}

export interface ClientBilling {
  clientId: string;
  enabled: boolean;
  stripeCustomerId: string | null;
  /** The key mode the customer was created under; a mismatch with the current key = no customer. */
  stripeLivemode: boolean | null;
  billingEmail: string | null;
  billFromMonth: string | null;
  /** Per-client overrides; null = platform default. */
  overrides: { markupBps: number | null; feeCents: number | null; anchorDay: number | null };
  /** What actually applies to this client. */
  effective: { markupBps: number; feeCents: number; anchorDay: number; currency: string };
  card: CardOnFile | null;
  cardRemovedAt: string | null;
  noCardAlertedMonth: string | null;
  updatedAt: string | null;
}

type Row = Record<string, unknown>;

const num = (v: unknown): number | null =>
  typeof v === "number" ? v : v == null ? null : Number(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export async function loadBillingSettings(): Promise<BillingSettings> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("billing_settings")
    .select("markup_bps, fee_cents, anchor_day, currency, alert_email, updated_at")
    .eq("id", 1)
    .maybeSingle();
  if (!data) return DEFAULT_SETTINGS;
  return {
    markupBps: num(data.markup_bps) ?? 0,
    feeCents: num(data.fee_cents) ?? 0,
    anchorDay: num(data.anchor_day) ?? 3,
    currency: text(data.currency) ?? "usd",
    alertEmail: text(data.alert_email),
    updatedAt: text(data.updated_at),
  };
}

export const getBillingSettings = cache(loadBillingSettings);

const CLIENT_COLS =
  "olivia_client_id, enabled, stripe_customer_id, stripe_livemode, billing_email, bill_from_month, " +
  "markup_bps, fee_cents, anchor_day, default_payment_method_id, card_brand, card_last4, " +
  "card_exp_month, card_exp_year, card_added_at, card_removed_at, no_card_alerted_month, updated_at";

export function rowToClientBilling(r: Row, s: BillingSettings): ClientBilling {
  const pm = text(r.default_payment_method_id);
  const overrides = {
    markupBps: num(r.markup_bps),
    feeCents: num(r.fee_cents),
    anchorDay: num(r.anchor_day),
  };
  return {
    clientId: String(r.olivia_client_id),
    enabled: r.enabled === true,
    stripeCustomerId: text(r.stripe_customer_id),
    stripeLivemode: typeof r.stripe_livemode === "boolean" ? r.stripe_livemode : null,
    billingEmail: text(r.billing_email),
    billFromMonth: text(r.bill_from_month),
    overrides,
    effective: {
      markupBps: overrides.markupBps ?? s.markupBps,
      feeCents: overrides.feeCents ?? s.feeCents,
      anchorDay: overrides.anchorDay ?? s.anchorDay,
      currency: s.currency,
    },
    card: pm
      ? {
          paymentMethodId: pm,
          brand: text(r.card_brand),
          last4: text(r.card_last4),
          expMonth: num(r.card_exp_month),
          expYear: num(r.card_exp_year),
          addedAt: text(r.card_added_at),
        }
      : null,
    cardRemovedAt: text(r.card_removed_at),
    noCardAlertedMonth: text(r.no_card_alerted_month),
    updatedAt: text(r.updated_at),
  };
}

export async function loadClientBilling(clientId: string): Promise<ClientBilling | null> {
  const admin = createAdminClient();
  const [settings, { data }] = await Promise.all([
    loadBillingSettings(),
    admin.from("client_billing").select(CLIENT_COLS).eq("olivia_client_id", clientId).maybeSingle(),
  ]);
  return data ? rowToClientBilling(data as Row, settings) : null;
}

export const getClientBilling = cache(loadClientBilling);

export async function listClientBilling(): Promise<ClientBilling[]> {
  const admin = createAdminClient();
  const [settings, { data }] = await Promise.all([
    loadBillingSettings(),
    admin.from("client_billing").select(CLIENT_COLS),
  ]);
  return (data ?? []).map((r) => rowToClientBilling(r as Row, settings));
}

export async function clientIdForCustomer(customerId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("client_billing")
    .select("olivia_client_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return text(data?.olivia_client_id);
}

export async function clientIdForPaymentMethod(paymentMethodId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("client_billing")
    .select("olivia_client_id")
    .eq("default_payment_method_id", paymentMethodId)
    .maybeSingle();
  return text(data?.olivia_client_id);
}

export interface ClientBillingPatch {
  enabled?: boolean;
  billingEmail?: string | null;
  billFromMonth?: string | null;
  markupBps?: number | null;
  feeCents?: number | null;
  anchorDay?: number | null;
}

/**
 * Create or update a client's row. Only the keys present in `patch` change (an omitted key is
 * untouched; an explicit null clears an override). Ranges are re-validated here so a caller
 * that forgot to parse cannot store garbage.
 */
export async function upsertClientBilling(
  clientId: string,
  patch: ClientBillingPatch,
  userId: string | null,
): Promise<ClientBilling> {
  if (patch.markupBps != null && !isValidBps(patch.markupBps)) throw new RangeError("invalid markup");
  if (patch.feeCents != null && !isValidFeeCents(patch.feeCents)) throw new RangeError("invalid fee");
  if (patch.anchorDay != null && !isValidAnchorDay(patch.anchorDay)) throw new RangeError("invalid anchor day");
  const admin = createAdminClient();
  const cols: Row = {
    olivia_client_id: clientId,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  if (patch.enabled !== undefined) cols.enabled = patch.enabled;
  if (patch.billingEmail !== undefined) cols.billing_email = patch.billingEmail;
  if (patch.billFromMonth !== undefined) cols.bill_from_month = patch.billFromMonth;
  if (patch.markupBps !== undefined) cols.markup_bps = patch.markupBps;
  if (patch.feeCents !== undefined) cols.fee_cents = patch.feeCents;
  if (patch.anchorDay !== undefined) cols.anchor_day = patch.anchorDay;
  const { error } = await admin.from("client_billing").upsert(cols, { onConflict: "olivia_client_id" });
  if (error) throw new Error(`client_billing upsert failed: ${error.message}`);
  const row = await loadClientBilling(clientId);
  if (!row) throw new Error("client_billing row missing after upsert");
  return row;
}

/** Raw column update for the card mirror / customer id. customers.ts owns these column names. */
export async function updateClientBillingColumns(clientId: string, cols: Row): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("client_billing")
    .update({ ...cols, updated_at: new Date().toISOString() })
    .eq("olivia_client_id", clientId);
  if (error) throw new Error(`client_billing update failed: ${error.message}`);
}

export async function saveBillingSettings(
  patch: { markupBps?: number; feeCents?: number; anchorDay?: number; alertEmail?: string | null },
  userId: string | null,
): Promise<void> {
  if (patch.markupBps !== undefined && !isValidBps(patch.markupBps)) throw new RangeError("invalid markup");
  if (patch.feeCents !== undefined && !isValidFeeCents(patch.feeCents)) throw new RangeError("invalid fee");
  if (patch.anchorDay !== undefined && !isValidAnchorDay(patch.anchorDay)) throw new RangeError("invalid anchor day");
  const admin = createAdminClient();
  const cols: Row = { id: 1, updated_at: new Date().toISOString(), updated_by: userId };
  if (patch.markupBps !== undefined) cols.markup_bps = patch.markupBps;
  if (patch.feeCents !== undefined) cols.fee_cents = patch.feeCents;
  if (patch.anchorDay !== undefined) cols.anchor_day = patch.anchorDay;
  if (patch.alertEmail !== undefined) cols.alert_email = patch.alertEmail;
  const { error } = await admin.from("billing_settings").upsert(cols, { onConflict: "id" });
  if (error) throw new Error(`billing_settings upsert failed: ${error.message}`);
}

/**
 * The multiplier for the ACTIVE client's dashboard figures: 0 unless the feature is on and
 * billing is enabled for that workspace. Never throws — a billing lookup must not take the
 * overview page down.
 */
export async function activeMarkupBps(): Promise<number> {
  if (!billingFeatureEnabled()) return 0;
  try {
    const cb = await getClientBilling(await getSessionClientId());
    return cb?.enabled ? cb.effective.markupBps : 0;
  } catch {
    return 0;
  }
}
```

- [ ] **Step 2: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean (the module is not yet imported anywhere; that is fine).

```bash
git add lib/billing/config.ts
git commit -m "feat(billing): server config module — settings, per-client rows, effective values

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Markup on every client-facing spend figure + fresh usage reads

**Files:**
- Modify: `lib/olivia/service.ts` (`fetchOverview`, `fetchTimeseries`, `fetchLeadDetail`)
- Modify: `lib/olivia/usage.ts` (`fetchDaily`, `getUsageSeries` gain a `fresh` option)

**Interfaces:**
- Consumes: `activeMarkupBps()` (Task 6), `markupOverview/markupTimeseries/markupLeadDetail` (Task 2).
- Produces: `getUsageSeries(clientId, tz, from, to, opts?: { fresh?: boolean })`.

- [ ] **Step 1: Apply the markup in the service layer**

In `lib/olivia/service.ts`, add two imports after the existing `import { cachedFetch, invalidateEndpoints, TIERS } from "./cache";` line:

```ts
import { activeMarkupBps } from "@/lib/billing/config";
import { markupLeadDetail, markupOverview, markupTimeseries } from "@/lib/billing/money";
```

Replace the bodies of the three fetchers. `fetchOverview` becomes:

```ts
export async function fetchOverview(
  params: DateParams = {},
  opts: Opts = {},
): Promise<WithFreshness<Overview>> {
  const clientId = await getSessionClientId();
  // The markup is applied AFTER the cache so response_cache rows stay raw; a markup change
  // takes effect on the next request without any invalidation.
  const [res, bps] = await Promise.all([
    cachedFetch({
      clientId,
      endpoint: "overview",
      params: rec(params),
      tier: TIERS.overview,
      force: opts.force,
      fetcher: () => api.getOverview(clientId, params),
    }),
    activeMarkupBps(),
  ]);
  return bps ? { ...res, data: markupOverview(res.data, bps) } : res;
}
```

`fetchTimeseries` becomes:

```ts
export async function fetchTimeseries(
  params: DateParams = {},
  opts: Opts = {},
): Promise<WithFreshness<Timeseries>> {
  const clientId = await getSessionClientId();
  const [res, bps] = await Promise.all([
    cachedFetch({
      clientId,
      endpoint: "timeseries",
      params: rec(params),
      tier: TIERS.timeseries,
      force: opts.force,
      fetcher: () => api.getTimeseries(clientId, params),
    }),
    activeMarkupBps(),
  ]);
  return bps ? { ...res, data: markupTimeseries(res.data, bps) } : res;
}
```

`fetchLeadDetail` becomes:

```ts
export async function fetchLeadDetail(
  leadId: string,
  opts: Opts = {},
): Promise<WithFreshness<LeadDetail>> {
  const clientId = await getSessionClientId();
  const [res, bps] = await Promise.all([
    cachedFetch({
      clientId,
      endpoint: "lead-detail",
      params: { leadId },
      tier: TIERS.leadDetail,
      force: opts.force,
      fetcher: () => api.getLeadDetail(clientId, leadId),
    }),
    activeMarkupBps(),
  ]);
  return bps ? { ...res, data: markupLeadDetail(res.data, bps) } : res;
}
```

These three are the only client-facing spend sources (`app/dashboard/page.tsx` + `lib/overview.ts` + `lib/narrate.ts` all read the overview/timeseries; `LeadDetailView` reads `summary.total_spend_cents`). Console modules (`lib/olivia/agency.ts`, `lib/olivia/usage.ts`) are untouched and stay raw.

- [ ] **Step 2: Add the `fresh` option to `getUsageSeries`**

In `lib/olivia/usage.ts`, change `fetchDaily` to accept and forward a `fresh` flag:

```ts
async function fetchDaily(
  clientId: string,
  tz: string,
  from: string,
  to: string,
  fresh = false,
): Promise<DailySpend[] | null> {
  const params = { from, to, tz };
  try {
    const res = await cachedFetch({
      clientId,
      // Namespaced away from the dashboard's `timeseries` rows on purpose: the cross-window
      // fallback picks the closest cached window within an endpoint, and a billing read must
      // only ever fall back onto other billing reads.
      endpoint: "usage-timeseries",
      params,
      tier: TIERS.usage,
      // An invoice run asks for a fresh upstream read; a stale same-window row is still the
      // on-error fallback, and a different window is rejected below either way.
      force: fresh,
      fetcher: () => api.getTimeseries(clientId, params),
    });
```

(the rest of the function is unchanged), and change `getUsageSeries`'s signature and the one call site inside it:

```ts
export async function getUsageSeries(
  clientId: string,
  tz: string,
  from: string,
  to: string,
  opts: { fresh?: boolean } = {},
): Promise<UsageSeries | null> {
  const window = padWindow({ from, to });
  const parts = await Promise.all(
    yearChunks(window.from, window.to).map((c) =>
      fetchDaily(clientId, tz, c.from, c.to, opts.fresh === true),
    ),
  );
```

(the rest unchanged). Existing callers pass four arguments and keep their behaviour.

- [ ] **Step 3: Typecheck, lint, run the existing usage selftest**

Run: `npx tsc --noEmit && npm run lint && npm run test:usage`
Expected: clean; the usage selftest still passes (it exercises the pure module only).

- [ ] **Step 4: Commit**

```bash
git add lib/olivia/service.ts lib/olivia/usage.ts
git commit -m "feat(billing): apply the client markup after the cache; fresh usage reads for invoicing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 8: Email templates and the notification module

**Files:**
- Modify: `lib/email/templates.ts` (append eight templates)
- Create: `lib/billing/notify.ts`
- Modify: `scripts/billing-selftest.ts` (append template assertions)

**Interfaces:**
- Consumes: `renderShell` (`lib/email/layout.ts`), `sendEmail` (`lib/email/send.ts`), `loadBillingSettings`, `CardOnFile` (Task 6), `ordinal` (Task 3), `centsToMoneyExact`, `monthLabel` (`lib/usage.ts`).
- Produces: templates `billingSetupLink`, `billingCardAdded`, `billingCardRemoved`, `billingPaymentFailedAdmin`, `billingPaymentFailedClient`, `billingUsageUnavailable`, `billingNoCard`, `billingRunSummary`; and `adminRecipients()`, `clientDisplayName(clientId)`, `cardLabel(card)`, `notifyCardAdded(clientId, card, origin)`, `notifyCardRemoved(clientId, reason, origin)`, `notifyPaymentFailed(args)`, `notifyUsageUnavailable(clientId, clientName, month, origin)`, `notifyNoCard(clientId, clientName, month, origin)`, `notifyRunSummary(args, origin)`, `sendSetupLinkEmail(args)`, type `RunSummaryLine`.

(The spec lists seven templates; this task adds an eighth, `billingNoCard`, so the once-per-month "no card" alert has its own wording instead of borrowing the usage-unavailable one.)

- [ ] **Step 1: Append the failing template assertions to `scripts/billing-selftest.ts`**

```ts
import {
  billingCardAdded,
  billingCardRemoved,
  billingNoCard,
  billingPaymentFailedAdmin,
  billingPaymentFailedClient,
  billingRunSummary,
  billingSetupLink,
  billingUsageUnavailable,
} from "../lib/email/templates";

// Every billing email: branded shell, the CTA url present in html + text, never the vendor name.
const tpl = [
  billingSetupLink({ clientName: "Freedom Boat Club", setupUrl: "https://x.test/billing/setup/tok", feeLabel: "$300.00", anchorLabel: "3rd", expiresInDays: 7 }),
  billingCardAdded({ clientName: "Freedom Boat Club", cardLabel: "Visa ····4242 (exp 12/30)", consoleUrl: "https://x.test/console/billing/c1" }),
  billingCardRemoved({ clientName: "Freedom Boat Club", detail: "removed from the Billing page", consoleUrl: "https://x.test/console/billing/c1" }),
  billingPaymentFailedAdmin({ clientName: "Freedom Boat Club", periodLabel: "Sep 2026", amount: "$1,113.49", reason: "Your card has insufficient funds.", kind: "failed", consoleUrl: "https://x.test/console/billing/c1" }),
  billingPaymentFailedClient({ clientName: "Freedom Boat Club", periodLabel: "Sep 2026", amount: "$1,113.49", reason: "Your card has insufficient funds.", kind: "failed", actionLabel: "Update your card", actionUrl: "https://x.test/billing/setup/tok" }),
  billingUsageUnavailable({ clientName: "Freedom Boat Club", periodLabel: "Sep 2026", consoleUrl: "https://x.test/console/billing/c1" }),
  billingNoCard({ clientName: "Freedom Boat Club", periodLabel: "Sep 2026", consoleUrl: "https://x.test/console/billing/c1" }),
  billingRunSummary({ headline: "2 invoiced, 1 failed", dateLabel: "11 Oct 2026", lines: ["SOLVI · Sep 2026: invoiced $813.49 — paid"], consoleUrl: "https://x.test/console/billing" }),
];
for (const t of tpl) {
  assert.ok(t.subject.length > 0);
  assert.match(t.html, /https:\/\/x\.test\//);
  assert.match(t.text, /https:\/\/x\.test\//);
  assert.doesNotMatch(t.html, /Olivia/);
  assert.doesNotMatch(t.subject, /Olivia/);
}
assert.match(tpl[0]!.subject, /Freedom Boat Club/);
assert.match(tpl[0]!.html, /3rd/);
assert.match(tpl[3]!.subject, /Payment failed/);
assert.match(tpl[4]!.html, /Update your card/);
assert.match(tpl[7]!.html, /SOLVI · Sep 2026/);

console.log("billing-selftest: templates OK");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:billing`
Expected: FAIL — `billingSetupLink` is not exported.

- [ ] **Step 3: Append the templates to `lib/email/templates.ts`**

```ts
// ---- Billing ----
// All billing mail reuses the shell. Admin mail links to the console; client mail links to a
// card-setup page or the Stripe-hosted invoice. Copy says Emma / Hey Emma only.

export interface BillingSetupLinkArgs {
  clientName: string;
  setupUrl: string;
  /** "$300.00" or "" when there is no fee. */
  feeLabel: string;
  /** "3rd" */
  anchorLabel: string;
  expiresInDays: number;
}

export function billingSetupLink(
  a: BillingSetupLinkArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `Add a card to ${a.clientName}'s Hey Emma account for automatic monthly billing.`,
    eyebrow: "Billing setup",
    heading: "Add a card for automatic billing",
    bodyParagraphs: [
      `Hey Emma will charge ${a.clientName}'s card on the ${a.anchorLabel} of each month for the previous month's Emma usage${a.feeLabel ? ` plus the ${a.feeLabel} monthly fee` : ""}.`,
      "Add a card securely with Stripe — it takes a minute, and you can replace or remove it at any time from your Billing page.",
    ],
    cta: { label: "Add your card", url: a.setupUrl },
    notes: [`This link expires in ${a.expiresInDays} days. Only use it if you manage billing for ${a.clientName}.`],
  });
  return { subject: `Add a card for ${a.clientName} on Hey Emma`, html, text };
}

export interface BillingCardAddedArgs {
  clientName: string;
  cardLabel: string;
  consoleUrl: string;
}

export function billingCardAdded(
  a: BillingCardAddedArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `${a.clientName} added ${a.cardLabel}.`,
    eyebrow: "Billing",
    heading: "A card was added",
    bodyParagraphs: [
      `${a.clientName} now has ${a.cardLabel} on file. Automatic billing will charge it on the next charge date.`,
    ],
    cta: { label: "Open billing", url: a.consoleUrl },
  });
  return { subject: `Card added: ${a.clientName}`, html, text };
}

export interface BillingCardRemovedArgs {
  clientName: string;
  /** "removed from the Billing page" / "removed in Stripe" / "the Stripe customer was deleted" */
  detail: string;
  consoleUrl: string;
}

export function billingCardRemoved(
  a: BillingCardRemovedArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `${a.clientName} no longer has a card on file.`,
    eyebrow: "Billing",
    heading: "A card was removed",
    bodyParagraphs: [
      `${a.clientName} no longer has a card on file (${a.detail}). Their next charge will be skipped until a new card is added — send them a setup link from the console.`,
    ],
    cta: { label: "Open billing", url: a.consoleUrl },
  });
  return { subject: `Card removed: ${a.clientName}`, html, text };
}

export interface BillingPaymentFailedAdminArgs {
  clientName: string;
  periodLabel: string;
  amount: string;
  reason: string;
  kind: "failed" | "action_required";
  consoleUrl: string;
}

export function billingPaymentFailedAdmin(
  a: BillingPaymentFailedAdminArgs,
): { subject: string; html: string; text: string } {
  const needsAuth = a.kind === "action_required";
  const { html, text } = renderShell({
    preheader: `${a.clientName}'s ${a.amount} payment for ${a.periodLabel} did not go through.`,
    eyebrow: "Billing",
    heading: needsAuth ? "A payment needs the client's authentication" : "A payment failed",
    bodyParagraphs: [
      `The ${a.amount} invoice for ${a.periodLabel} could not be charged to ${a.clientName}'s card.`,
      `Reason: ${a.reason}`,
      needsAuth
        ? "The client has been emailed a link to authenticate the payment with their bank. Nothing further is needed from you unless they don't complete it."
        : "Stripe will retry automatically. The client has been emailed a link to update their card; you can also retry the charge from the console once a new card is on file.",
    ],
    cta: { label: "Open billing", url: a.consoleUrl },
  });
  return {
    subject: `${needsAuth ? "Payment needs authentication" : "Payment failed"}: ${a.clientName} · ${a.periodLabel}`,
    html,
    text,
  };
}

export interface BillingPaymentFailedClientArgs {
  clientName: string;
  periodLabel: string;
  amount: string;
  reason: string;
  kind: "failed" | "action_required";
  actionLabel: string;
  actionUrl: string;
}

export function billingPaymentFailedClient(
  a: BillingPaymentFailedClientArgs,
): { subject: string; html: string; text: string } {
  const needsAuth = a.kind === "action_required";
  const { html, text } = renderShell({
    preheader: `Your Hey Emma payment of ${a.amount} for ${a.periodLabel} needs attention.`,
    eyebrow: "Billing",
    heading: needsAuth ? "Please authenticate your payment" : "We couldn't charge your card",
    bodyParagraphs: [
      `The ${a.amount} invoice for ${a.clientName}'s Emma usage in ${a.periodLabel} ${needsAuth ? "needs a quick confirmation with your bank" : "could not be charged to the card on file"}.`,
      `Reason: ${a.reason}`,
      needsAuth
        ? "Use the button below to complete the payment securely with Stripe."
        : "Add a new card below and we'll retry the charge. Your Emma service continues in the meantime.",
    ],
    cta: { label: a.actionLabel, url: a.actionUrl },
  });
  return { subject: `Action needed: your Hey Emma payment for ${a.periodLabel}`, html, text };
}

export interface BillingUsageUnavailableArgs {
  clientName: string;
  periodLabel: string;
  consoleUrl: string;
}

export function billingUsageUnavailable(
  a: BillingUsageUnavailableArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `${a.clientName}'s ${a.periodLabel} invoice was not created.`,
    eyebrow: "Billing",
    heading: "Usage could not be loaded",
    bodyParagraphs: [
      `Emma's usage figures for ${a.clientName} in ${a.periodLabel} could not be loaded, so no invoice was created and nothing was charged. The daily run will try again tomorrow.`,
      "If this repeats, check the Usage report for the same month — a figure that is missing there is missing here.",
    ],
    cta: { label: "Open billing", url: a.consoleUrl },
  });
  return { subject: `Could not bill ${a.clientName} for ${a.periodLabel}`, html, text };
}

export interface BillingNoCardArgs {
  clientName: string;
  periodLabel: string;
  consoleUrl: string;
}

export function billingNoCard(
  a: BillingNoCardArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `${a.clientName} has no card on file; ${a.periodLabel} was not charged.`,
    eyebrow: "Billing",
    heading: "No card on file",
    bodyParagraphs: [
      `${a.periodLabel} is due for ${a.clientName}, but they have no card on file, so nothing was charged. Send them a setup link from the console; the month will be invoiced on the next run after a card is added.`,
    ],
    cta: { label: "Open billing", url: a.consoleUrl },
  });
  return { subject: `No card on file: ${a.clientName} (${a.periodLabel} not charged)`, html, text };
}

export interface BillingRunSummaryArgs {
  /** "2 invoiced, 1 failed" */
  headline: string;
  dateLabel: string;
  /** One line per client-month, already formatted. */
  lines: string[];
  consoleUrl: string;
}

export function billingRunSummary(
  a: BillingRunSummaryArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `Billing run ${a.dateLabel}: ${a.headline}.`,
    eyebrow: "Billing run",
    heading: `Billing run · ${a.dateLabel}`,
    bodyParagraphs: [a.headline, ...a.lines],
    cta: { label: "Open billing", url: a.consoleUrl },
  });
  return { subject: `Billing run ${a.dateLabel}: ${a.headline}`, html, text };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:billing`
Expected: `billing-selftest: templates OK` among the OK lines.

- [ ] **Step 5: Create `lib/billing/notify.ts`**

```ts
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import {
  billingCardAdded,
  billingCardRemoved,
  billingNoCard,
  billingPaymentFailedAdmin,
  billingPaymentFailedClient,
  billingRunSummary,
  billingSetupLink,
  billingUsageUnavailable,
} from "@/lib/email/templates";
import { centsToMoneyExact, dayLabel, monthLabel } from "@/lib/usage";
import { ordinal } from "./copy";
import { loadBillingSettings, loadClientBilling, type CardOnFile } from "./config";

/**
 * Every billing email, in one place. All sends are fail-soft: a Resend error is logged and
 * swallowed, because a card change or an invoice must never be rolled back by a mail outage.
 *
 * This module reads platform admins directly through the service role rather than via
 * `listAgencyTeam()` — that helper gates on `requireAdmin()`, and webhooks and crons have no
 * session.
 */

/** Every platform admin's email plus the optional alerts address. Lower-cased, de-duplicated. */
export async function adminRecipients(): Promise<string[]> {
  const admin = createAdminClient();
  const [{ data: members }, users, settings] = await Promise.all([
    admin.from("workspace_members").select("user_id").eq("role", "platform_admin"),
    admin.auth.admin.listUsers({ perPage: 1000 }),
    loadBillingSettings(),
  ]);
  const adminIds = new Set((members ?? []).map((m) => m.user_id as string));
  const emails = new Set<string>();
  for (const u of users.data?.users ?? []) {
    if (u.email && adminIds.has(u.id)) emails.add(u.email.toLowerCase());
  }
  if (settings.alertEmail) emails.add(settings.alertEmail.toLowerCase());
  return [...emails];
}

export async function clientDisplayName(clientId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("olivia_clients")
    .select("name")
    .eq("olivia_client_id", clientId)
    .maybeSingle();
  return (data?.name as string | null) ?? clientId;
}

/** "Visa ····4242 (exp 12/30)" */
export function cardLabel(card: CardOnFile | null): string {
  if (!card) return "no card";
  const brand = card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : "Card";
  const exp =
    card.expMonth && card.expYear
      ? ` (exp ${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)})`
      : "";
  return `${brand} ····${card.last4 ?? "????"}${exp}`;
}

async function sendTo(
  recipients: string[],
  msg: { subject: string; html: string; text: string },
  tag: string,
): Promise<void> {
  await Promise.all(
    recipients.map(async (to) => {
      try {
        const { error } = await sendEmail({ to, ...msg });
        if (error) console.error(`[billing:${tag}] email to ${to} failed:`, error);
      } catch (e) {
        console.error(`[billing:${tag}] email to ${to} threw:`, e);
      }
    }),
  );
}

const consoleUrl = (origin: string, clientId: string) => `${origin}/console/billing/${clientId}`;

export async function notifyCardAdded(clientId: string, card: CardOnFile, origin: string): Promise<void> {
  const [to, clientName] = await Promise.all([adminRecipients(), clientDisplayName(clientId)]);
  await sendTo(to, billingCardAdded({ clientName, cardLabel: cardLabel(card), consoleUrl: consoleUrl(origin, clientId) }), "card-added");
}

export async function notifyCardRemoved(
  clientId: string,
  reason: "removed" | "detached" | "customer_deleted",
  origin: string,
): Promise<void> {
  const [to, clientName] = await Promise.all([adminRecipients(), clientDisplayName(clientId)]);
  const detail =
    reason === "removed"
      ? "removed from the Billing page"
      : reason === "detached"
        ? "removed in Stripe"
        : "the Stripe customer was deleted";
  await sendTo(to, billingCardRemoved({ clientName, detail, consoleUrl: consoleUrl(origin, clientId) }), "card-removed");
}

export interface PaymentFailedArgs {
  clientId: string;
  clientName: string;
  month: string;
  totalCents: number;
  reason: string;
  kind: "failed" | "action_required";
  origin: string;
  /** Where the client's button goes: a fresh setup link, or the hosted invoice for authentication. */
  clientActionUrl: string | null;
}

export async function notifyPaymentFailed(a: PaymentFailedArgs): Promise<void> {
  const [admins, cb] = await Promise.all([adminRecipients(), loadClientBilling(a.clientId)]);
  const periodLabel = monthLabel(a.month);
  const amount = centsToMoneyExact(a.totalCents);
  await sendTo(
    admins,
    billingPaymentFailedAdmin({ clientName: a.clientName, periodLabel, amount, reason: a.reason, kind: a.kind, consoleUrl: consoleUrl(a.origin, a.clientId) }),
    "payment-failed-admin",
  );
  if (cb?.billingEmail && a.clientActionUrl) {
    await sendTo(
      [cb.billingEmail],
      billingPaymentFailedClient({
        clientName: a.clientName,
        periodLabel,
        amount,
        reason: a.reason,
        kind: a.kind,
        actionLabel: a.kind === "action_required" ? "Complete payment" : "Update your card",
        actionUrl: a.clientActionUrl,
      }),
      "payment-failed-client",
    );
  }
}

export async function notifyUsageUnavailable(clientId: string, clientName: string, month: string, origin: string): Promise<void> {
  const to = await adminRecipients();
  await sendTo(to, billingUsageUnavailable({ clientName, periodLabel: monthLabel(month), consoleUrl: consoleUrl(origin, clientId) }), "usage-unavailable");
}

export async function notifyNoCard(clientId: string, clientName: string, month: string, origin: string): Promise<void> {
  const to = await adminRecipients();
  await sendTo(to, billingNoCard({ clientName, periodLabel: monthLabel(month), consoleUrl: consoleUrl(origin, clientId) }), "no-card");
}

export interface RunSummaryLine {
  clientName: string;
  month: string;
  outcome: string;
  status: string | null;
  totalCents: number | null;
  error: string | null;
}

function describeLine(l: RunSummaryLine): string {
  const amount = l.totalCents == null ? "" : ` ${centsToMoneyExact(l.totalCents)}`;
  switch (l.outcome) {
    case "invoiced":
      return `invoiced${amount} — ${l.status ?? "open"}`;
    case "skipped_no_card":
      return "skipped — no card on file";
    case "skipped_zero":
      return "nothing to bill";
    case "usage_unavailable":
      return "usage unavailable — will retry tomorrow";
    case "already_invoiced":
      return "already invoiced";
    default:
      return `error: ${l.error ?? "unknown"}`;
  }
}

export async function notifyRunSummary(
  a: { trigger: string; startedAt: string; lines: RunSummaryLine[] },
  origin: string,
): Promise<void> {
  const to = await adminRecipients();
  const invoiced = a.lines.filter((l) => l.outcome === "invoiced").length;
  const failed = a.lines.filter((l) => l.status === "failed" || l.status === "action_required" || l.outcome === "error").length;
  const headline = `${invoiced} invoiced, ${failed} failed (${a.trigger})`;
  await sendTo(
    to,
    billingRunSummary({
      headline,
      dateLabel: dayLabel(a.startedAt.slice(0, 10)),
      lines: a.lines.map((l) => `${l.clientName} · ${monthLabel(l.month)}: ${describeLine(l)}`),
      consoleUrl: `${origin}/console/billing`,
    }),
    "run-summary",
  );
}

export async function sendSetupLinkEmail(a: {
  clientId: string;
  clientName: string;
  to: string;
  setupUrl: string;
  feeCents: number;
  anchorDay: number;
  expiresInDays: number;
}): Promise<{ error: string | null }> {
  const msg = billingSetupLink({
    clientName: a.clientName,
    setupUrl: a.setupUrl,
    feeLabel: a.feeCents > 0 ? centsToMoneyExact(a.feeCents) : "",
    anchorLabel: ordinal(a.anchorDay),
    expiresInDays: a.expiresInDays,
  });
  try {
    const { error } = await sendEmail({ to: a.to, ...msg });
    return { error };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unknown send error" };
  }
}
```

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint && npm run test:billing && npm run test:narrate || true`
Expected: tsc/lint/billing clean. (`test:narrate` has a pre-existing unrelated failure on master — ignore it; it is listed here only so you notice it is not new.)

```bash
git add lib/email/templates.ts lib/billing/notify.ts scripts/billing-selftest.ts
git commit -m "feat(billing): branded billing emails and the notification module

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Stripe customers and the card on file (`lib/billing/customers.ts`)

**Files:**
- Create: `lib/billing/customers.ts`

**Interfaces:**
- Consumes: `getStripe`, `stripeLivemode` (Task 1); `loadClientBilling`, `upsertClientBilling`, `updateClientBillingColumns`, `CardOnFile` (Task 6); `notifyCardRemoved` (Task 8).
- Produces: `cardMirrorFromPaymentMethod(pm, addedAt)`, `ensureCustomer(clientId): Promise<string>`, `writeCardMirror(clientId, card | null)`, `setDefaultCard(clientId, paymentMethodId): Promise<CardOnFile>`, `refreshCardMirror(clientId, paymentMethodId)`, `removeCard(clientId, origin): Promise<boolean>`, `clearCustomer(clientId)`.

- [ ] **Step 1: Create `lib/billing/customers.ts`**

```ts
import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeLivemode } from "@/lib/stripe/client";
import {
  loadClientBilling,
  updateClientBillingColumns,
  upsertClientBilling,
  type CardOnFile,
} from "./config";
import { notifyCardRemoved } from "./notify";

/**
 * One Stripe Customer per workspace and exactly one card on file. Stripe is the source of
 * truth; `client_billing` holds a mirror (brand, last4, expiry) so pages never call Stripe to
 * render, and webhooks keep the mirror current.
 */

export function cardMirrorFromPaymentMethod(
  pm: Stripe.PaymentMethod,
  addedAt: string | null,
): CardOnFile {
  return {
    paymentMethodId: pm.id,
    brand: pm.card?.brand ?? null,
    last4: pm.card?.last4 ?? null,
    expMonth: pm.card?.exp_month ?? null,
    expYear: pm.card?.exp_year ?? null,
    addedAt,
  };
}

async function clientName(clientId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("olivia_clients")
    .select("name")
    .eq("olivia_client_id", clientId)
    .maybeSingle();
  return (data?.name as string | null) ?? clientId;
}

/**
 * The client's Stripe Customer id, created on first use. A customer created under the OTHER
 * key mode (sandbox vs live) is treated as absent and a fresh one is created, so sandbox state
 * never leaks into live billing. Creation is idempotent per client and mode.
 */
export async function ensureCustomer(clientId: string): Promise<string> {
  const live = stripeLivemode();
  const cb = (await loadClientBilling(clientId)) ?? (await upsertClientBilling(clientId, {}, null));
  if (cb.stripeCustomerId && cb.stripeLivemode === live) return cb.stripeCustomerId;
  const customer = await getStripe().customers.create(
    {
      name: await clientName(clientId),
      email: cb.billingEmail ?? undefined,
      description: "Emma workspace",
      metadata: { emma_client_id: clientId },
    },
    { idempotencyKey: `emma:cus:${live ? "live" : "test"}:${clientId}` },
  );
  await updateClientBillingColumns(clientId, {
    stripe_customer_id: customer.id,
    stripe_livemode: live,
    default_payment_method_id: null,
    card_brand: null,
    card_last4: null,
    card_exp_month: null,
    card_exp_year: null,
    card_added_at: null,
  });
  return customer.id;
}

/** Persist (or clear) the card mirror. Clearing stamps `card_removed_at`. */
export async function writeCardMirror(clientId: string, card: CardOnFile | null): Promise<void> {
  await updateClientBillingColumns(
    clientId,
    card
      ? {
          default_payment_method_id: card.paymentMethodId,
          card_brand: card.brand,
          card_last4: card.last4,
          card_exp_month: card.expMonth,
          card_exp_year: card.expYear,
          card_added_at: card.addedAt ?? new Date().toISOString(),
          card_removed_at: null,
        }
      : {
          default_payment_method_id: null,
          card_brand: null,
          card_last4: null,
          card_exp_month: null,
          card_exp_year: null,
          card_removed_at: new Date().toISOString(),
        },
  );
}

/**
 * Make `paymentMethodId` the card on file: Stripe's default for invoices, the local mirror,
 * and every OTHER card detached so "remove" always means "no card". The mirror is written
 * BEFORE the old cards are detached, so the `payment_method.detached` webhooks they trigger see
 * a different card on file and are ignored.
 */
export async function setDefaultCard(clientId: string, paymentMethodId: string): Promise<CardOnFile> {
  const stripe = getStripe();
  const customerId = await ensureCustomer(clientId);
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  const owner = typeof pm.customer === "string" ? pm.customer : (pm.customer?.id ?? null);
  if (owner !== customerId) throw new Error("payment method does not belong to this client's customer");
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: pm.id },
  });
  const card = cardMirrorFromPaymentMethod(pm, new Date().toISOString());
  await writeCardMirror(clientId, card);
  const others = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 100 });
  for (const other of others.data) {
    if (other.id !== pm.id) {
      await stripe.paymentMethods.detach(other.id).catch((e) => {
        console.warn("[billing] detaching a replaced card failed:", e);
      });
    }
  }
  return card;
}

/** Re-read a card from Stripe into the mirror (issuer-refreshed expiry, default changed in Stripe). */
export async function refreshCardMirror(clientId: string, paymentMethodId: string): Promise<void> {
  const cb = await loadClientBilling(clientId);
  const pm = await getStripe().paymentMethods.retrieve(paymentMethodId);
  await writeCardMirror(
    clientId,
    cardMirrorFromPaymentMethod(pm, cb?.card?.addedAt ?? new Date().toISOString()),
  );
}

/**
 * Remove the card on file (member or admin). Returns false when there was none.
 *
 * The mirror is cleared BEFORE the detach, so the `payment_method.detached` webhook finds no
 * card on file and stays silent; this function emails the admins itself. A card removed inside
 * the Stripe dashboard takes the other path (mirror still set → the webhook clears it and
 * emails). Either way a removal notifies exactly once. This deviates from the spec's "the
 * webhook is the single notification place": racing our own clear against Stripe's delivery
 * made that unreliable.
 */
export async function removeCard(clientId: string, origin: string): Promise<boolean> {
  const cb = await loadClientBilling(clientId);
  const pmId = cb?.card?.paymentMethodId;
  if (!pmId) return false;
  await writeCardMirror(clientId, null);
  await getStripe()
    .paymentMethods.detach(pmId)
    .catch((e) => console.warn("[billing] detach failed:", e));
  await notifyCardRemoved(clientId, "removed", origin);
  return true;
}

/** Stripe reported the customer deleted: forget it and the card. The next enable recreates it. */
export async function clearCustomer(clientId: string): Promise<void> {
  await updateClientBillingColumns(clientId, {
    stripe_customer_id: null,
    stripe_livemode: null,
    default_payment_method_id: null,
    card_brand: null,
    card_last4: null,
    card_exp_month: null,
    card_exp_year: null,
    card_removed_at: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add lib/billing/customers.ts
git commit -m "feat(billing): Stripe customer + card-on-file mirror (set, replace, remove, refresh)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Setup links and Checkout sessions (`lib/billing/setup.ts`)

**Files:**
- Create: `lib/billing/setup.ts`

**Interfaces:**
- Consumes: Tasks 1, 6, 8, 9; `setupLinkState` (Task 4); `CHECKOUT_SUBMIT_MESSAGE` (Task 3).
- Produces: `SETUP_LINK_TTL_DAYS`, `SetupLink`, `setupLinkUrl(origin, token)`, `createSetupLink(clientId, createdBy)`, `listSetupLinks(clientId)`, `revokeSetupLink(id)`, `markSetupLinkSent(id, to)`, `getSetupLink(token)`, `completeSetupLink(token)`, `createCheckoutSession(args): Promise<string>`, `ReconcileResult`, `reconcileCheckoutSession(sessionId, expectedClientId, origin)`.

- [ ] **Step 1: Create `lib/billing/setup.ts`**

```ts
import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeLivemode } from "@/lib/stripe/client";
import { loadClientBilling, type CardOnFile } from "./config";
import { CHECKOUT_SUBMIT_MESSAGE } from "./copy";
import { ensureCustomer, setDefaultCard } from "./customers";
import { notifyCardAdded } from "./notify";
import { setupLinkState, type SetupLinkState } from "./status";

/**
 * Card capture. Two entry points (the client's Billing page and a public token link) create
 * the same Stripe Checkout Session in setup mode; one reconcile function handles the return
 * from Stripe and the `checkout.session.completed` webhook identically and idempotently.
 */

export const SETUP_LINK_TTL_DAYS = 7;

export interface SetupLink {
  id: string;
  token: string;
  clientId: string;
  createdBy: string | null;
  sentTo: string | null;
  createdAt: string;
  expiresAt: string;
  status: string;
  completedAt: string | null;
}

const COLS = "id, token, olivia_client_id, created_by, sent_to, created_at, expires_at, status, completed_at";

function rowToLink(r: Record<string, unknown>): SetupLink {
  return {
    id: String(r.id),
    token: String(r.token),
    clientId: String(r.olivia_client_id),
    createdBy: (r.created_by as string | null) ?? null,
    sentTo: (r.sent_to as string | null) ?? null,
    createdAt: String(r.created_at),
    expiresAt: String(r.expires_at),
    status: String(r.status),
    completedAt: (r.completed_at as string | null) ?? null,
  };
}

export function setupLinkUrl(origin: string, token: string): string {
  return `${origin}/billing/setup/${token}`;
}

export async function createSetupLink(clientId: string, createdBy: string | null): Promise<SetupLink> {
  const admin = createAdminClient();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SETUP_LINK_TTL_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("billing_setup_links")
    .insert({
      token,
      olivia_client_id: clientId,
      created_by: createdBy,
      expires_at: expiresAt,
      livemode: stripeLivemode(),
    })
    .select(COLS)
    .single();
  if (error || !data) throw new Error(`could not create setup link: ${error?.message ?? "no row"}`);
  return rowToLink(data as Record<string, unknown>);
}

/** Newest first. */
export async function listSetupLinks(clientId: string): Promise<SetupLink[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("billing_setup_links")
    .select(COLS)
    .eq("olivia_client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []).map((r) => rowToLink(r as Record<string, unknown>));
}

export async function revokeSetupLink(id: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("billing_setup_links").update({ status: "revoked" }).eq("id", id).eq("status", "pending");
}

export async function markSetupLinkSent(id: string, to: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("billing_setup_links").update({ sent_to: to }).eq("id", id);
}

export async function getSetupLink(
  token: string,
): Promise<{ link: SetupLink; state: SetupLinkState } | null> {
  if (!token) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("billing_setup_links").select(COLS).eq("token", token).maybeSingle();
  if (!data) return null;
  const link = rowToLink(data as Record<string, unknown>);
  return { link, state: setupLinkState({ status: link.status, expiresAt: link.expiresAt }, new Date()) };
}

export async function completeSetupLink(token: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("billing_setup_links")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("token", token)
    .eq("status", "pending");
}

/**
 * A Stripe Checkout Session in setup mode for the client's customer. Returns the hosted URL to
 * redirect the browser to. `successUrl` must contain the literal `{CHECKOUT_SESSION_ID}`
 * placeholder — Stripe substitutes it, and the return page uses it to reconcile.
 */
export async function createCheckoutSession(args: {
  clientId: string;
  successUrl: string;
  cancelUrl: string;
  setupToken?: string | null;
}): Promise<string> {
  const customerId = await ensureCustomer(args.clientId);
  const metadata: Record<string, string> = {
    emma_client_id: args.clientId,
    emma_origin: args.setupToken ? "link" : "dashboard",
  };
  if (args.setupToken) metadata.emma_setup_token = args.setupToken;
  const session = await getStripe().checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    currency: "usd",
    payment_method_types: ["card"],
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    custom_text: { submit: { message: CHECKOUT_SUBMIT_MESSAGE } },
    metadata,
    setup_intent_data: { metadata: { emma_client_id: args.clientId } },
  });
  if (!session.url) throw new Error("Stripe returned a Checkout session without a url");
  return session.url;
}

export type ReconcileResult =
  | { ok: true; clientId: string; card: CardOnFile; alreadyDone: boolean }
  | {
      ok: false;
      reason: "incomplete" | "not_emma" | "client_mismatch" | "customer_mismatch" | "no_payment_method";
    };

/**
 * After Checkout: verify the session, make its payment method the card on file, complete the
 * setup link it came from, and email the admins. Idempotent — the return page and the webhook
 * both call it; the second caller finds the card already mirrored and sends nothing.
 *
 * `expectedClientId` is the tenant guard for the return page (the session's client must be the
 * one the page belongs to); the webhook passes the session's own client id.
 */
export async function reconcileCheckoutSession(
  sessionId: string,
  expectedClientId: string | null,
  origin: string,
): Promise<ReconcileResult> {
  const session = await getStripe().checkout.sessions.retrieve(sessionId, { expand: ["setup_intent"] });
  if (session.mode !== "setup" || session.status !== "complete") return { ok: false, reason: "incomplete" };
  const clientId = session.metadata?.emma_client_id;
  if (!clientId) return { ok: false, reason: "not_emma" };
  if (expectedClientId && expectedClientId !== clientId) return { ok: false, reason: "client_mismatch" };

  const cb = await loadClientBilling(clientId);
  const customerId = typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
  if (!cb?.stripeCustomerId || !customerId || cb.stripeCustomerId !== customerId) {
    return { ok: false, reason: "customer_mismatch" };
  }

  const setupIntent = session.setup_intent;
  const pmRef = setupIntent && typeof setupIntent !== "string" ? setupIntent.payment_method : null;
  const pmId = typeof pmRef === "string" ? pmRef : (pmRef?.id ?? null);
  if (!pmId) return { ok: false, reason: "no_payment_method" };

  const setupToken = session.metadata?.emma_setup_token || null;
  if (cb.card?.paymentMethodId === pmId) {
    if (setupToken) await completeSetupLink(setupToken);
    return { ok: true, clientId, card: cb.card, alreadyDone: true };
  }
  const card = await setDefaultCard(clientId, pmId);
  if (setupToken) await completeSetupLink(setupToken);
  await notifyCardAdded(clientId, card, origin);
  return { ok: true, clientId, card, alreadyDone: false };
}
```

- [ ] **Step 2: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add lib/billing/setup.ts
git commit -m "feat(billing): setup links, Checkout setup-mode sessions and return reconciliation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 11: Invoicing (`lib/billing/invoices.ts`)

**Files:**
- Create: `lib/billing/invoices.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 3, 4, 6, 7, 8, 10.
- Produces: `tzOf(timezone)`, `loadClientsIndex()`, `InvoiceRow`, `listInvoices(clientId?)`, `invoicedMonthsByClient()`, `latestInvoiceByClient()`, `lastBillingRun()`, `UsageProvider`, `liveUsage`, `InvoiceOutcome`, `InvoiceMonthResult`, `invoiceMonth(clientId, month, trigger, opts?)`, `payInvoice(stripe, invoiceId, idempotencyKey)`, `RunSummary`, `runBilling(trigger, opts?)`, `retryInvoice(rowId)`, `estimateCurrentMonth(cb, tz, now?)`, `previewLastClosedMonth(cb, tz, now?)`.

- [ ] **Step 1: Create `lib/billing/invoices.ts`**

```ts
import "server-only";
import Stripe from "stripe";
import { getUsageSeries } from "@/lib/olivia/usage";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeLivemode } from "@/lib/stripe/client";
import { monthBounds, monthLabel, sumRange } from "@/lib/usage";
import {
  listClientBilling,
  loadClientBilling,
  updateClientBillingColumns,
  type ClientBilling,
} from "./config";
import { composeInvoice, type InvoiceLines } from "./money";
import {
  notifyNoCard,
  notifyPaymentFailed,
  notifyRunSummary,
  notifyUsageUnavailable,
  type RunSummaryLine,
} from "./notify";
import { dueMonths, localDate, monthOf, nextChargeDate, prevMonth } from "./schedule";
import { createSetupLink, setupLinkUrl } from "./setup";
import { invoiceStatusFromStripe, isInvoiceStatus, type InvoiceStatus } from "./status";

/**
 * The monthly charge. `invoiceMonth` is the one path that creates a Stripe Invoice; the cron,
 * the admin's "Charge now" and the livecheck all go through it.
 *
 * Billing-safety rules, in the order the code applies them:
 *   1. The (client, month) row is RESERVED before Stripe is called — the unique constraint is
 *      the lock, so two runs can never bill a month twice and a crash leaves a visible row.
 *   2. Usage that fails to load is `null`: the reservation is released, admins are told, and
 *      tomorrow's run retries. Never $0.
 *   3. Every Stripe create carries an idempotency key built from the reservation id, so a replay
 *      within 24h returns the same objects and a fresh reservation never collides.
 *   4. Pay synchronously so the run reports a real outcome; Stripe's automatic collection keeps
 *      retrying a decline afterwards.
 */

export function tzOf(timezone: string | null | undefined): string {
  return timezone?.trim() || "UTC";
}

interface ClientInfo {
  id: string;
  name: string;
  timezone: string | null;
}

export async function loadClientsIndex(): Promise<Map<string, ClientInfo>> {
  const admin = createAdminClient();
  const { data } = await admin.from("olivia_clients").select("olivia_client_id, name, timezone");
  return new Map(
    (data ?? []).map((c) => [
      c.olivia_client_id as string,
      {
        id: c.olivia_client_id as string,
        name: (c.name as string | null) ?? (c.olivia_client_id as string),
        timezone: (c.timezone as string | null) ?? null,
      },
    ]),
  );
}

export interface InvoiceRow {
  id: string;
  clientId: string;
  periodMonth: string;
  periodFrom: string | null;
  periodTo: string | null;
  tz: string | null;
  rawUsageCents: number | null;
  markupBps: number | null;
  billedUsageCents: number | null;
  feeCents: number | null;
  totalCents: number | null;
  currency: string;
  stripeInvoiceId: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  status: InvoiceStatus;
  failureCode: string | null;
  failureMessage: string | null;
  trigger: string;
  livemode: boolean;
  createdAt: string;
  finalizedAt: string | null;
  paidAt: string | null;
}

const INVOICE_COLS =
  "id, olivia_client_id, period_month, period_from, period_to, tz, raw_usage_cents, markup_bps, " +
  "billed_usage_cents, fee_cents, total_cents, currency, stripe_invoice_id, hosted_invoice_url, " +
  "invoice_pdf_url, status, failure_code, failure_message, trigger, livemode, created_at, finalized_at, paid_at";

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" ? v : v == null ? null : Number(v));
const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const now = () => new Date().toISOString();

function rowToInvoice(r: Row): InvoiceRow {
  const status = String(r.status);
  return {
    id: String(r.id),
    clientId: String(r.olivia_client_id),
    periodMonth: String(r.period_month),
    periodFrom: text(r.period_from),
    periodTo: text(r.period_to),
    tz: text(r.tz),
    rawUsageCents: num(r.raw_usage_cents),
    markupBps: num(r.markup_bps),
    billedUsageCents: num(r.billed_usage_cents),
    feeCents: num(r.fee_cents),
    totalCents: num(r.total_cents),
    currency: text(r.currency) ?? "usd",
    stripeInvoiceId: text(r.stripe_invoice_id),
    hostedInvoiceUrl: text(r.hosted_invoice_url),
    invoicePdfUrl: text(r.invoice_pdf_url),
    status: isInvoiceStatus(status) ? status : "open",
    failureCode: text(r.failure_code),
    failureMessage: text(r.failure_message),
    trigger: text(r.trigger) ?? "cron",
    livemode: r.livemode === true,
    createdAt: String(r.created_at),
    finalizedAt: text(r.finalized_at),
    paidAt: text(r.paid_at),
  };
}

/** Newest month first. */
export async function listInvoices(clientId?: string): Promise<InvoiceRow[]> {
  const admin = createAdminClient();
  let q = admin.from("billing_invoices").select(INVOICE_COLS).order("period_month", { ascending: false });
  if (clientId) q = q.eq("olivia_client_id", clientId);
  const { data } = await q;
  return (data ?? []).map((r) => rowToInvoice(r as Row));
}

/** Every month that has a row, in any status, per client. */
export async function invoicedMonthsByClient(): Promise<Map<string, string[]>> {
  const admin = createAdminClient();
  const { data } = await admin.from("billing_invoices").select("olivia_client_id, period_month");
  const out = new Map<string, string[]>();
  for (const r of data ?? []) {
    const id = r.olivia_client_id as string;
    out.set(id, [...(out.get(id) ?? []), r.period_month as string]);
  }
  return out;
}

export async function latestInvoiceByClient(): Promise<Map<string, InvoiceRow>> {
  const out = new Map<string, InvoiceRow>();
  for (const inv of await listInvoices()) if (!out.has(inv.clientId)) out.set(inv.clientId, inv);
  return out;
}

export interface BillingRunInfo {
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  counts: Record<string, number>;
}

export async function lastBillingRun(): Promise<BillingRunInfo | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("billing_runs")
    .select("trigger, started_at, finished_at, summary")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const summary = (data.summary as { counts?: Record<string, number> } | null) ?? null;
  return {
    trigger: String(data.trigger),
    startedAt: String(data.started_at),
    finishedAt: text(data.finished_at),
    counts: summary?.counts ?? {},
  };
}

// ---- Usage ----

/** Raw billed cents for a window, or null when it could not be loaded. */
export type UsageProvider = (clientId: string, tz: string, from: string, to: string) => Promise<number | null>;

/** The real thing: a fresh upstream read through the Usage report's seam. */
export const liveUsage: UsageProvider = async (clientId, tz, from, to) => {
  const series = await getUsageSeries(clientId, tz, from, to, { fresh: true });
  return series ? Math.round(sumRange(series.daily, from, to)) : null;
};

// ---- invoiceMonth ----

export type InvoiceOutcome =
  | "invoiced"
  | "skipped_zero"
  | "skipped_no_card"
  | "skipped_disabled"
  | "already_invoiced"
  | "usage_unavailable"
  | "error";

export interface InvoiceMonthResult {
  clientId: string;
  clientName: string;
  month: string;
  outcome: InvoiceOutcome;
  status: InvoiceStatus | null;
  totalCents: number | null;
  stripeInvoiceId: string | null;
  hostedInvoiceUrl: string | null;
  error: string | null;
}

export interface PayOutcome {
  status: InvoiceStatus;
  failureCode: string | null;
  failureMessage: string | null;
  paidAt: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
}

const AUTH_CODES = new Set(["authentication_required", "invoice_payment_intent_requires_action"]);

/** Pay a finalised invoice now. A decline is an outcome, not an exception; anything else throws. */
export async function payInvoice(stripe: Stripe, invoiceId: string, idempotencyKey: string): Promise<PayOutcome> {
  try {
    const paid = await stripe.invoices.pay(invoiceId, {}, { idempotencyKey });
    const paidAtSec = paid.status_transitions?.paid_at ?? null;
    return {
      status: invoiceStatusFromStripe(paid.status),
      failureCode: null,
      failureMessage: null,
      paidAt: paidAtSec ? new Date(paidAtSec * 1000).toISOString() : null,
      hostedInvoiceUrl: paid.hosted_invoice_url ?? null,
      invoicePdfUrl: paid.invoice_pdf ?? null,
    };
  } catch (e) {
    if (e instanceof Stripe.errors.StripeCardError || e instanceof Stripe.errors.StripeInvalidRequestError) {
      const code = e.code ?? null;
      return {
        status: code && AUTH_CODES.has(code) ? "action_required" : "failed",
        failureCode: ("decline_code" in e && typeof e.decline_code === "string" ? e.decline_code : null) ?? code ?? "payment_failed",
        failureMessage: e.message,
        paidAt: null,
        hostedInvoiceUrl: null,
        invoicePdfUrl: null,
      };
    }
    throw e;
  }
}

async function findStripeInvoice(stripe: Stripe, clientId: string, month: string): Promise<Stripe.Invoice | null> {
  try {
    const res = await stripe.invoices.search({
      query: `metadata['emma_client_id']:'${clientId}' AND metadata['emma_period']:'${month}'`,
      limit: 1,
    });
    return res.data[0] ?? null;
  } catch {
    return null;
  }
}

type Admin = ReturnType<typeof createAdminClient>;

type Reservation =
  | { kind: "reserved"; rowId: string }
  | { kind: "exists"; row: { id: string; status: string; createdAt: string; stripeInvoiceId: string | null } }
  | { kind: "error"; message: string };

async function reserveMonth(
  admin: Admin,
  cols: Row,
  clientId: string,
  month: string,
): Promise<Reservation> {
  const { data, error } = await admin.from("billing_invoices").insert(cols).select("id").single();
  if (!error && data) return { kind: "reserved", rowId: String(data.id) };
  if (error?.code !== "23505") return { kind: "error", message: error?.message ?? "reserve failed" };
  const { data: row } = await admin
    .from("billing_invoices")
    .select("id, status, created_at, stripe_invoice_id")
    .eq("olivia_client_id", clientId)
    .eq("period_month", month)
    .maybeSingle();
  if (!row) return { kind: "error", message: "reservation vanished" };
  return {
    kind: "exists",
    row: {
      id: String(row.id),
      status: String(row.status),
      createdAt: String(row.created_at),
      stripeInvoiceId: text(row.stripe_invoice_id),
    },
  };
}

/** A `reserved` row older than this came from a crashed run and is reconciled, not respected. */
const RESERVATION_STALE_MS = 60 * 60 * 1000;

export async function invoiceMonth(
  clientId: string,
  month: string,
  trigger: "cron" | "manual",
  opts: { usage?: UsageProvider; createdBy?: string | null; origin?: string } = {},
): Promise<InvoiceMonthResult> {
  const admin = createAdminClient();
  const stripe = getStripe();
  const live = stripeLivemode();
  const origin = opts.origin ?? "";
  const client = (await loadClientsIndex()).get(clientId);
  const clientName = client?.name ?? clientId;
  const result = (outcome: InvoiceOutcome, extra: Partial<InvoiceMonthResult> = {}): InvoiceMonthResult => ({
    clientId,
    clientName,
    month,
    outcome,
    status: null,
    totalCents: null,
    stripeInvoiceId: null,
    hostedInvoiceUrl: null,
    error: null,
    ...extra,
  });

  const cb = await loadClientBilling(clientId);
  if (!cb?.enabled) return result("skipped_disabled");
  if (!cb.card || !cb.stripeCustomerId || cb.stripeLivemode !== live) {
    // Once per due month, not once per day.
    if (cb.noCardAlertedMonth !== month) {
      await notifyNoCard(clientId, clientName, month, origin);
      await updateClientBillingColumns(clientId, { no_card_alerted_month: month });
    }
    return result("skipped_no_card");
  }

  const tz = tzOf(client?.timezone);
  const { from, to } = monthBounds(month);
  const reserveCols: Row = {
    olivia_client_id: clientId,
    period_month: month,
    period_from: from,
    period_to: to,
    tz,
    currency: "usd",
    status: "reserved",
    trigger,
    created_by: opts.createdBy ?? null,
    livemode: live,
  };

  // 1. Reserve the month.
  let reservation = await reserveMonth(admin, reserveCols, clientId, month);
  if (reservation.kind === "exists") {
    const { row } = reservation;
    const stale = row.status === "reserved" && Date.now() - Date.parse(row.createdAt) > RESERVATION_STALE_MS;
    if (!stale) {
      return result("already_invoiced", {
        status: isInvoiceStatus(row.status) ? row.status : null,
        stripeInvoiceId: row.stripeInvoiceId,
      });
    }
    // A crashed run. Adopt a finalised Stripe invoice if one exists, delete a draft, start over.
    const found = await findStripeInvoice(stripe, clientId, month);
    if (found && found.status !== "draft") {
      const status = invoiceStatusFromStripe(found.status);
      await admin
        .from("billing_invoices")
        .update({
          stripe_invoice_id: found.id,
          status,
          hosted_invoice_url: found.hosted_invoice_url ?? null,
          invoice_pdf_url: found.invoice_pdf ?? null,
          total_cents: found.total,
          updated_at: now(),
        })
        .eq("id", row.id);
      return result("already_invoiced", { status, stripeInvoiceId: found.id, totalCents: found.total });
    }
    if (found) await stripe.invoices.del(found.id).catch(() => undefined);
    await admin.from("billing_invoices").delete().eq("id", row.id);
    reservation = await reserveMonth(admin, reserveCols, clientId, month);
  }
  if (reservation.kind !== "reserved") {
    return result("error", { error: reservation.kind === "error" ? reservation.message : "could not reserve the month" });
  }
  const rowId = reservation.rowId;

  // 2. Usage. null releases the reservation so tomorrow's run retries. Never $0.
  const raw = await (opts.usage ?? liveUsage)(clientId, tz, from, to);
  if (raw == null) {
    await admin.from("billing_invoices").delete().eq("id", rowId);
    await notifyUsageUnavailable(clientId, clientName, month, origin);
    return result("usage_unavailable");
  }

  // 3. Lines.
  const lines = composeInvoice(raw, cb.effective.markupBps, cb.effective.feeCents);
  const lineCols: Row = {
    raw_usage_cents: lines.rawUsageCents,
    markup_bps: lines.markupBps,
    billed_usage_cents: lines.billedUsageCents,
    fee_cents: lines.feeCents,
    total_cents: lines.totalCents,
  };
  if (lines.totalCents === 0) {
    await admin.from("billing_invoices").update({ ...lineCols, status: "skipped_zero", updated_at: now() }).eq("id", rowId);
    return result("skipped_zero", { status: "skipped_zero", totalCents: 0 });
  }

  // 4. Stripe.
  const k = `emma:inv:${rowId}`;
  const label = monthLabel(month);
  try {
    const invoice = await stripe.invoices.create(
      {
        customer: cb.stripeCustomerId,
        collection_method: "charge_automatically",
        auto_advance: true,
        currency: "usd",
        pending_invoice_items_behavior: "exclude",
        description: `Emma · ${label}`,
        statement_descriptor: "HEY EMMA",
        metadata: { emma_client_id: clientId, emma_period: month },
      },
      { idempotencyKey: `${k}:create` },
    );
    if (lines.billedUsageCents > 0) {
      await stripe.invoiceItems.create(
        {
          customer: cb.stripeCustomerId,
          invoice: invoice.id,
          amount: lines.billedUsageCents,
          currency: "usd",
          description: `Emma usage · ${label}`,
        },
        { idempotencyKey: `${k}:usage` },
      );
    }
    if (lines.feeCents > 0) {
      await stripe.invoiceItems.create(
        {
          customer: cb.stripeCustomerId,
          invoice: invoice.id,
          amount: lines.feeCents,
          currency: "usd",
          description: `Monthly fee · ${label}`,
        },
        { idempotencyKey: `${k}:fee` },
      );
    }
    const finalized = await stripe.invoices.finalizeInvoice(
      invoice.id,
      { auto_advance: true },
      { idempotencyKey: `${k}:finalize` },
    );
    await admin
      .from("billing_invoices")
      .update({
        ...lineCols,
        stripe_invoice_id: finalized.id,
        hosted_invoice_url: finalized.hosted_invoice_url ?? null,
        invoice_pdf_url: finalized.invoice_pdf ?? null,
        status: "open",
        finalized_at: now(),
        updated_at: now(),
      })
      .eq("id", rowId);

    const outcome = await payInvoice(stripe, finalized.id, `${k}:pay`);
    const hostedInvoiceUrl = outcome.hostedInvoiceUrl ?? finalized.hosted_invoice_url ?? null;
    await admin
      .from("billing_invoices")
      .update({
        status: outcome.status,
        failure_code: outcome.failureCode,
        failure_message: outcome.failureMessage,
        paid_at: outcome.paidAt,
        hosted_invoice_url: hostedInvoiceUrl,
        invoice_pdf_url: outcome.invoicePdfUrl ?? finalized.invoice_pdf ?? null,
        updated_at: now(),
      })
      .eq("id", rowId);

    if (outcome.status === "failed" || outcome.status === "action_required") {
      await notifyPaymentFailed({
        clientId,
        clientName,
        month,
        totalCents: lines.totalCents,
        reason: outcome.failureMessage ?? "Payment declined",
        kind: outcome.status,
        origin,
        clientActionUrl: await clientActionUrl(clientId, outcome.status, hostedInvoiceUrl, origin),
      });
    }
    return result("invoiced", {
      status: outcome.status,
      totalCents: lines.totalCents,
      stripeInvoiceId: finalized.id,
      hostedInvoiceUrl,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin
      .from("billing_invoices")
      .update({ ...lineCols, status: "failed", failure_code: "stripe_error", failure_message: message, updated_at: now() })
      .eq("id", rowId);
    return result("error", { status: "failed", error: message });
  }
}

/** Where the client's "fix it" button goes: the hosted invoice for authentication, else a fresh setup link. */
export async function clientActionUrl(
  clientId: string,
  kind: "failed" | "action_required",
  hostedInvoiceUrl: string | null,
  origin: string,
): Promise<string | null> {
  if (kind === "action_required" && hostedInvoiceUrl) return hostedInvoiceUrl;
  if (!origin) return null;
  const link = await createSetupLink(clientId, null);
  return setupLinkUrl(origin, link.token);
}

// ---- runBilling ----

export interface RunSummary {
  trigger: "cron" | "manual";
  startedAt: string;
  finishedAt: string;
  results: InvoiceMonthResult[];
  counts: Record<InvoiceOutcome, number>;
}

function countOutcomes(results: InvoiceMonthResult[]): Record<InvoiceOutcome, number> {
  const counts: Record<InvoiceOutcome, number> = {
    invoiced: 0,
    skipped_zero: 0,
    skipped_no_card: 0,
    skipped_disabled: 0,
    already_invoiced: 0,
    usage_unavailable: 0,
    error: 0,
  };
  for (const r of results) counts[r.outcome] += 1;
  return counts;
}

/**
 * The daily job (also "Run billing now" in the console). Clients are processed one at a time
 * and their due months oldest first. A summary row is always written; admins are emailed only
 * on a day that invoiced or failed.
 */
export async function runBilling(
  trigger: "cron" | "manual",
  opts: { clientId?: string; now?: Date; origin?: string; usage?: UsageProvider } = {},
): Promise<RunSummary> {
  const at = opts.now ?? new Date();
  const startedAt = at.toISOString();
  const admin = createAdminClient();
  const [configs, clients, invoiced] = await Promise.all([
    listClientBilling(),
    loadClientsIndex(),
    invoicedMonthsByClient(),
  ]);

  const results: InvoiceMonthResult[] = [];
  for (const cb of configs) {
    if (opts.clientId && cb.clientId !== opts.clientId) continue;
    if (!cb.enabled) continue;
    const today = localDate(at, tzOf(clients.get(cb.clientId)?.timezone));
    const months = dueMonths({
      today,
      anchorDay: cb.effective.anchorDay,
      billFromMonth: cb.billFromMonth ?? monthOf(today),
      invoicedMonths: invoiced.get(cb.clientId) ?? [],
    });
    for (const month of months) {
      results.push(await invoiceMonth(cb.clientId, month, trigger, { origin: opts.origin, usage: opts.usage }));
    }
  }

  const counts = countOutcomes(results);
  const summary: RunSummary = { trigger, startedAt, finishedAt: now(), results, counts };
  await admin.from("billing_runs").insert({
    trigger,
    livemode: stripeLivemode(),
    started_at: startedAt,
    finished_at: summary.finishedAt,
    summary,
  });

  const anyFailure = results.some((r) => r.status === "failed" || r.status === "action_required");
  if (counts.invoiced > 0 || counts.error > 0 || anyFailure) {
    const lines: RunSummaryLine[] = results.map((r) => ({
      clientName: r.clientName,
      month: r.month,
      outcome: r.outcome,
      status: r.status,
      totalCents: r.totalCents,
      error: r.error,
    }));
    await notifyRunSummary({ trigger, startedAt, lines }, opts.origin ?? "");
  }
  return summary;
}

/** Admin "Retry charge" on a failed/open/action-required invoice. No emails; the UI shows the result. */
export async function retryInvoice(
  rowId: string,
): Promise<{ ok: boolean; status: InvoiceStatus | null; message: string | null }> {
  const admin = createAdminClient();
  const { data } = await admin.from("billing_invoices").select(INVOICE_COLS).eq("id", rowId).maybeSingle();
  if (!data) return { ok: false, status: null, message: "Invoice not found" };
  const row = rowToInvoice(data as Row);
  if (!row.stripeInvoiceId || !["failed", "open", "action_required"].includes(row.status)) {
    return { ok: false, status: row.status, message: "This invoice can't be retried" };
  }
  const outcome = await payInvoice(getStripe(), row.stripeInvoiceId, `emma:inv:${rowId}:retry:${Date.now()}`);
  await admin
    .from("billing_invoices")
    .update({
      status: outcome.status,
      failure_code: outcome.failureCode,
      failure_message: outcome.failureMessage,
      paid_at: outcome.paidAt,
      updated_at: now(),
    })
    .eq("id", rowId);
  return { ok: outcome.status === "paid", status: outcome.status, message: outcome.failureMessage };
}

// ---- Read-only figures for the pages ----

export interface MonthFigure {
  month: string;
  label: string;
  /** null = usage could not be loaded (never 0). */
  lines: InvoiceLines | null;
}

/** The client Billing page's "Next charge": month-to-date usage with the markup, plus the fee. */
export async function estimateCurrentMonth(
  cb: ClientBilling,
  tz: string,
  at: Date = new Date(),
): Promise<MonthFigure & { nextChargeDate: string }> {
  const today = localDate(at, tz);
  const month = monthOf(today);
  const from = `${month}-01`;
  const series = await getUsageSeries(cb.clientId, tz, from, today);
  const raw = series ? Math.round(sumRange(series.daily, from, today)) : null;
  return {
    month,
    label: monthLabel(month),
    lines: raw == null ? null : composeInvoice(raw, cb.effective.markupBps, cb.effective.feeCents),
    nextChargeDate: nextChargeDate(today, cb.effective.anchorDay),
  };
}

/** The console's raw → billed preview for the last closed month (normal cache, not forced). */
export async function previewLastClosedMonth(cb: ClientBilling, tz: string, at: Date = new Date()): Promise<MonthFigure> {
  const month = prevMonth(monthOf(localDate(at, tz)));
  const { from, to } = monthBounds(month);
  const series = await getUsageSeries(cb.clientId, tz, from, to);
  const raw = series ? Math.round(sumRange(series.daily, from, to)) : null;
  return {
    month,
    label: monthLabel(month),
    lines: raw == null ? null : composeInvoice(raw, cb.effective.markupBps, cb.effective.feeCents),
  };
}
```

- [ ] **Step 2: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. If `paid.status_transitions` or `invoice_pdf` typecheck differently in the installed SDK, fix the access to match `node_modules/stripe/types/Invoices.d.ts` — do not cast to `any`.

```bash
git add lib/billing/invoices.ts
git commit -m "feat(billing): invoiceMonth, runBilling, retry and page figures

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Webhook handler and endpoint

**Files:**
- Create: `lib/billing/webhooks.ts`
- Create: `app/api/stripe/webhook/route.ts`

**Interfaces:**
- Consumes: `eventSubject`, `planTransition` (Task 4); `clientIdForCustomer`, `clientIdForPaymentMethod`, `loadClientBilling` (Task 6); `writeCardMirror`, `refreshCardMirror`, `clearCustomer` (Task 9); `reconcileCheckoutSession` (Task 10); `notifyCardRemoved`, `notifyPaymentFailed` (Task 8); `clientActionUrl` (Task 11).
- Produces: `handleStripeEvent(event, origin)`.

- [ ] **Step 1: Create `lib/billing/webhooks.ts`**

```ts
import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { clientIdForCustomer, clientIdForPaymentMethod, loadClientBilling } from "./config";
import { clearCustomer, refreshCardMirror, writeCardMirror } from "./customers";
import { clientActionUrl } from "./invoices";
import { clientDisplayName, notifyCardRemoved, notifyPaymentFailed } from "./notify";
import { reconcileCheckoutSession } from "./setup";
import { eventSubject, planTransition, type BillingTransition, type WebhookEventShape } from "./status";

/**
 * Stripe → us. Idempotent by event id (`billing_events`): a processed event is a no-op on
 * redelivery; an event whose handler threw stays unprocessed so Stripe's retry runs it again.
 * Decisions live in the pure `planTransition`; this file only resolves ids and applies.
 */
export async function handleStripeEvent(event: Stripe.Event, origin: string): Promise<void> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("billing_events")
    .select("processed_at")
    .eq("stripe_event_id", event.id)
    .maybeSingle();
  if (existing?.processed_at) return;
  if (!existing) {
    await admin
      .from("billing_events")
      .insert({ stripe_event_id: event.id, type: event.type, livemode: event.livemode });
  }
  try {
    await applyEvent(event as unknown as WebhookEventShape, origin);
    await admin
      .from("billing_events")
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq("stripe_event_id", event.id);
  } catch (e) {
    await admin
      .from("billing_events")
      .update({ error: e instanceof Error ? e.message : String(e) })
      .eq("stripe_event_id", event.id);
    throw e;
  }
}

async function applyEvent(ev: WebhookEventShape, origin: string): Promise<void> {
  const subject = eventSubject(ev);
  let clientId = subject.clientIdFromMetadata;
  if (!clientId && subject.paymentMethodId) clientId = await clientIdForPaymentMethod(subject.paymentMethodId);
  if (!clientId && subject.customerId) clientId = await clientIdForCustomer(subject.customerId);
  const cb = clientId ? await loadClientBilling(clientId) : null;
  const plan = planTransition(ev, {
    clientId: cb ? cb.clientId : null,
    mirroredPaymentMethodId: cb?.card?.paymentMethodId ?? null,
  });
  switch (plan.kind) {
    case "ignore":
      return;
    case "reconcile_checkout":
      await reconcileCheckoutSession(plan.sessionId, plan.clientId, origin);
      return;
    case "card_cleared":
      await writeCardMirror(plan.clientId, null);
      if (plan.notify) await notifyCardRemoved(plan.clientId, "detached", origin);
      return;
    case "card_refresh":
      await refreshCardMirror(plan.clientId, plan.paymentMethodId);
      return;
    case "customer_deleted":
      await clearCustomer(plan.clientId);
      await notifyCardRemoved(plan.clientId, "customer_deleted", origin);
      return;
    case "invoice_status":
      await applyInvoiceStatus(plan, origin);
      return;
  }
}

type InvoiceStatusPlan = Extract<BillingTransition, { kind: "invoice_status" }>;

/**
 * Only a CHANGE of status notifies. Our synchronous `pay` already recorded a decline and sent the
 * emails; the `invoice.payment_failed` Stripe sends for that same attempt arrives later and must
 * not send them again (Review Focus 5). A later retry that fails after a success is impossible,
 * and a retry that keeps failing stays `failed` → silent.
 */
async function applyInvoiceStatus(plan: InvoiceStatusPlan, origin: string): Promise<void> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("billing_invoices")
    .select("id, status, total_cents, hosted_invoice_url")
    .eq("stripe_invoice_id", plan.stripeInvoiceId)
    .maybeSingle();
  if (!row) return; // Not one of ours, or the run that created it has not written the id yet.
  const changed = row.status !== plan.status;
  let failureCode: string | null = null;
  let failureMessage = plan.failureMessage;
  if (plan.lookupFailure && changed) {
    const f = await lookupFailure(plan.stripeInvoiceId);
    failureCode = f.code;
    failureMessage = f.message;
  }
  const hostedInvoiceUrl = plan.hostedInvoiceUrl ?? (row.hosted_invoice_url as string | null) ?? null;
  await admin
    .from("billing_invoices")
    .update({
      status: plan.status,
      hosted_invoice_url: hostedInvoiceUrl,
      invoice_pdf_url: plan.invoicePdfUrl ?? undefined,
      paid_at: plan.paidAt ?? undefined,
      failure_code: changed ? failureCode : undefined,
      failure_message: changed ? failureMessage : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  if (changed && (plan.notifyAdmins || plan.notifyClient) && (plan.status === "failed" || plan.status === "action_required")) {
    await notifyPaymentFailed({
      clientId: plan.clientId,
      clientName: await clientDisplayName(plan.clientId),
      month: plan.periodMonth,
      totalCents: Number(row.total_cents ?? 0),
      reason: failureMessage ?? "Payment failed",
      kind: plan.status,
      origin,
      clientActionUrl: await clientActionUrl(plan.clientId, plan.status, hostedInvoiceUrl, origin),
    });
  }
}

/**
 * The decline reason lives on the PaymentIntent behind the invoice's latest payment. In the
 * current API version the invoice no longer carries `payment_intent` directly; it carries a
 * `payments` list. Best-effort: any failure here degrades to a generic message.
 */
async function lookupFailure(invoiceId: string): Promise<{ code: string | null; message: string | null }> {
  try {
    const stripe = getStripe();
    const invoice = (await stripe.invoices.retrieve(invoiceId, { expand: ["payments"] })) as unknown as {
      payments?: { data?: Array<{ payment?: { payment_intent?: string | { id: string } | null } }> };
    };
    const ref = invoice.payments?.data?.[0]?.payment?.payment_intent;
    const piId = typeof ref === "string" ? ref : (ref?.id ?? null);
    if (!piId) return { code: null, message: "Payment failed" };
    const pi = await stripe.paymentIntents.retrieve(piId);
    const err = pi.last_payment_error;
    return { code: err?.decline_code ?? err?.code ?? null, message: err?.message ?? "Payment failed" };
  } catch {
    return { code: null, message: "Payment failed" };
  }
}
```

- [ ] **Step 2: Create `app/api/stripe/webhook/route.ts`**

```ts
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { billingFeatureEnabled } from "@/lib/billing/config";
import { handleStripeEvent } from "@/lib/billing/webhooks";
import { getRequestOrigin } from "@/lib/origin";
import { getStripe, stripeLivemode } from "@/lib/stripe/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Stripe webhook endpoint. The raw body is needed for signature verification, so this handler
 * reads `req.text()` and never the parsed JSON. `api/*` is outside the auth middleware; the
 * signature IS the authentication.
 */
export async function POST(req: Request): Promise<Response> {
  if (!billingFeatureEnabled()) {
    // Acknowledge so Stripe doesn't retry forever against a deploy that has billing off.
    return NextResponse.json({ ok: true, ignored: "billing disabled" });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "misconfigured", message: "STRIPE_WEBHOOK_SECRET is not set" }, { status: 500 });
  }
  const payload = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch (e) {
    console.warn("[stripe-webhook] bad signature:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }
  // A live event hitting a sandbox-keyed deploy (or vice versa) is acknowledged and dropped.
  if (event.livemode !== stripeLivemode()) {
    return NextResponse.json({ ok: true, ignored: "livemode mismatch" });
  }
  try {
    await handleStripeEvent(event, await getRequestOrigin());
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[stripe-webhook] %s failed:", event.type, e);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add lib/billing/webhooks.ts app/api/stripe/webhook/route.ts
git commit -m "feat(billing): Stripe webhook endpoint with idempotent, status-change-only handling

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Daily cron endpoint

**Files:**
- Create: `app/api/cron/billing/route.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `runBilling` (Task 11), `billingFeatureEnabled` (Task 6).

- [ ] **Step 1: Create `app/api/cron/billing/route.ts`**

```ts
import { NextResponse } from "next/server";
import { billingFeatureEnabled } from "@/lib/billing/config";
import { getRequestOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily billing run (vercel.json: 03:00 UTC). Same shape as /api/cron/snapshot: a no-op while
 * the feature flag is off; with it on, CRON_SECRET is mandatory and must match (fail closed).
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically when the variable is set.
 */
export async function GET(request: Request) {
  if (!billingFeatureEnabled()) {
    return NextResponse.json({ status: "disabled", message: "Set BILLING_ENABLED=true to run billing." });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "misconfigured", message: "CRON_SECRET is required when BILLING_ENABLED=true" },
      { status: 500 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { runBilling } = await import("@/lib/billing/invoices");
  const summary = await runBilling("cron", { origin: await getRequestOrigin() });
  return NextResponse.json({ status: "ok", counts: summary.counts, results: summary.results });
}
```

- [ ] **Step 2: Register the schedule in `vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/snapshot",
      "schedule": "5 0 * * *"
    },
    {
      "path": "/api/cron/billing",
      "schedule": "0 3 * * *"
    }
  ]
}
```

- [ ] **Step 3: Smoke-test locally**

With `.env` carrying the sandbox key, `BILLING_ENABLED=true` and `CRON_SECRET`, run `npm run dev` in one terminal and in another:

```bash
curl -s -H "Authorization: Bearer $(grep ^CRON_SECRET .env | cut -d= -f2-)" http://localhost:3000/api/cron/billing
```

Expected: `{"status":"ok","counts":{...},"results":[]}` (no client is enabled yet, so nothing is due). Without the header: `{"error":"unauthorized"}` and HTTP 401.

- [ ] **Step 4: Typecheck, lint, commit**

```bash
git add app/api/cron/billing/route.ts vercel.json
git commit -m "feat(billing): daily billing cron endpoint (fail-closed) and schedule

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 14: Public card-setup page (`/billing/setup/[token]`)

**Files:**
- Modify: `lib/supabase/middleware.ts` (`PUBLIC_PATHS`)
- Create: `app/billing/setup/actions.ts`
- Create: `components/billing/SetupCard.tsx`
- Create: `app/billing/setup/[token]/page.tsx`

**Interfaces:**
- Consumes: `getSetupLink`, `createCheckoutSession`, `reconcileCheckoutSession` (Task 10); `loadClientBilling`, `billingFeatureEnabled` (Task 6); `mandateText`, `ordinal` (Task 3); `cardLabel`, `clientDisplayName` (Task 8).
- Produces: server action `startLinkCheckout(formData)`.

- [ ] **Step 1: Make the setup path public**

In `lib/supabase/middleware.ts` change the constant to:

```ts
const PUBLIC_PATHS = ["/login", "/auth", "/invite", "/billing/setup"];
```

- [ ] **Step 2: Create `app/billing/setup/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { billingFeatureEnabled, loadClientBilling } from "@/lib/billing/config";
import { createCheckoutSession, getSetupLink } from "@/lib/billing/setup";
import { getRequestOrigin } from "@/lib/origin";

/**
 * Public, token-gated: start a Checkout session for the link's client. Only this click creates
 * a session — a page view never does, so a crawled link cannot mint sessions. The token is the
 * bearer credential; it must be pending and unexpired, and the workspace must have billing on.
 */
export async function startLinkCheckout(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!token || !billingFeatureEnabled()) redirect("/login");
  const found = await getSetupLink(token);
  if (!found || found.state !== "valid") redirect(`/billing/setup/${token}`);
  const cb = await loadClientBilling(found.link.clientId);
  if (!cb?.enabled) redirect(`/billing/setup/${token}?error=disabled`);
  const origin = await getRequestOrigin();
  const url = await createCheckoutSession({
    clientId: found.link.clientId,
    setupToken: token,
    successUrl: `${origin}/billing/setup/${token}?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}/billing/setup/${token}?setup=cancelled`,
  });
  redirect(url);
}
```

- [ ] **Step 3: Create `components/billing/SetupCard.tsx`**

```tsx
import { startLinkCheckout } from "@/app/billing/setup/actions";
import { LogoWordmark } from "@/components/brand/Logo";
import { SubmitButton } from "@/components/ui/states/SubmitButton";
import { mandateText, ordinal } from "@/lib/billing/copy";
import { centsToMoneyExact } from "@/lib/usage";

/**
 * The public card-setup card. Server component: the form posts to a server action, so no
 * client JS beyond SubmitButton's pending state. The mandate sits under the button so the
 * off-session authorisation is on screen before Checkout opens.
 */
export function SetupCard({
  token,
  clientName,
  feeCents,
  anchorDay,
  cancelled,
  disabled,
}: {
  token: string;
  clientName: string;
  feeCents: number;
  anchorDay: number;
  cancelled: boolean;
  disabled: boolean;
}) {
  return (
    <div>
      <div className="mb-6">
        <LogoWordmark size={32} />
      </div>
      <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-violet">
        Billing setup
      </div>
      <h1 className="text-[22px] font-bold tracking-[-0.01em]">Add a card for {clientName}</h1>
      <p className="mt-2.5 text-[14px] leading-[1.55] text-muted">
        Hey Emma charges this card on the{" "}
        <span className="font-medium text-ink">{ordinal(anchorDay)}</span> of each month for the
        previous month&apos;s Emma usage
        {feeCents > 0 ? (
          <>
            {" "}
            plus a <span className="font-medium text-ink">{centsToMoneyExact(feeCents)}</span>{" "}
            monthly fee
          </>
        ) : null}
        .
      </p>

      {cancelled ? (
        <div className="mt-4 rounded-[10px] border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-[13px] text-ink/80">
          No card was added. You can try again whenever you&apos;re ready.
        </div>
      ) : null}

      {disabled ? (
        <div className="mt-4 rounded-[10px] border border-danger/30 bg-danger/8 px-3.5 py-2.5 text-[13px] text-danger">
          Billing is switched off for this workspace. Ask your Hey Emma administrator for a new
          link once it&apos;s on.
        </div>
      ) : (
        <form action={startLinkCheckout} className="mt-6">
          <input type="hidden" name="token" value={token} />
          <SubmitButton
            pendingLabel="Opening secure checkout…"
            className="bg-gradient-brand w-full rounded-[12px] py-3 font-display text-[14px] font-semibold text-white shadow-[0_4px_14px_rgba(109,74,255,0.35)] transition-transform active:scale-[0.99]"
          >
            Add card with Stripe
          </SubmitButton>
        </form>
      )}

      <p className="mt-4 text-[12px] leading-[1.55] text-muted">{mandateText(anchorDay)}</p>
    </div>
  );
}
```

- [ ] **Step 4: Create `app/billing/setup/[token]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SetupCard } from "@/components/billing/SetupCard";
import { LogoWordmark } from "@/components/brand/Logo";
import { billingFeatureEnabled, loadClientBilling, type CardOnFile } from "@/lib/billing/config";
import { cardLabel, clientDisplayName } from "@/lib/billing/notify";
import { getSetupLink, reconcileCheckoutSession } from "@/lib/billing/setup";
import { getRequestOrigin } from "@/lib/origin";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * Public, token-gated card setup. Three states: a valid link shows the card; a completed link
 * (or a return from Stripe with `session_id`) confirms the card; anything else explains why
 * the link can't be used. Reconciling on return is idempotent, so a refresh is harmless.
 */
export default async function BillingSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: SP;
}) {
  if (!billingFeatureEnabled()) notFound();
  const { token } = await params;
  const sp = await searchParams;
  const found = await getSetupLink(token);

  let body: ReactNode;
  if (!found) {
    body = <Unavailable reason="This billing link isn't valid." />;
  } else {
    const { link, state } = found;
    const clientName = await clientDisplayName(link.clientId);
    const sessionId = one(sp.session_id);
    if (sessionId && (state === "valid" || state === "completed")) {
      const result = await reconcileCheckoutSession(sessionId, link.clientId, await getRequestOrigin());
      body = result.ok ? (
        <Done clientName={clientName} card={result.card} />
      ) : (
        <Unavailable reason="We couldn't confirm the card. Please open the link again and retry." />
      );
    } else if (state === "completed") {
      body = <Done clientName={clientName} card={null} />;
    } else if (state === "expired") {
      body = <Unavailable reason="This billing link has expired. Ask your Hey Emma administrator for a new one." />;
    } else if (state === "revoked") {
      body = <Unavailable reason="This billing link was revoked." />;
    } else if (state !== "valid") {
      body = <Unavailable reason="This billing link isn't valid." />;
    } else {
      const cb = await loadClientBilling(link.clientId);
      body = (
        <SetupCard
          token={token}
          clientName={clientName}
          feeCents={cb?.effective.feeCents ?? 0}
          anchorDay={cb?.effective.anchorDay ?? 3}
          cancelled={one(sp.setup) === "cancelled"}
          disabled={!cb?.enabled || one(sp.error) === "disabled"}
        />
      );
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-warm px-6">
      <div className="pointer-events-none absolute -right-40 -top-44 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.18),transparent_64%)]" />
      <div className="pointer-events-none absolute -bottom-52 -left-36 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(255,61,119,0.12),transparent_64%)]" />
      <div className="relative w-full max-w-[420px] rounded-[20px] border border-ink/10 bg-white p-8 shadow-[0_12px_32px_rgba(26,43,46,0.12)]">
        {body}
      </div>
    </main>
  );
}

function Done({ clientName, card }: { clientName: string; card: CardOnFile | null }) {
  return (
    <div className="text-center">
      <div className="mb-6 flex justify-center">
        <LogoWordmark size={32} />
      </div>
      <div className="bg-gradient-brand mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full shadow-[0_6px_18px_rgba(109,74,255,0.32)]">
        <svg width="26" height="26" viewBox="0 0 20 20" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 10.5l3.2 3.2L15 7" />
        </svg>
      </div>
      <h1 className="text-[20px] font-bold tracking-[-0.01em]">Card added</h1>
      <p className="mt-2 text-[14px] leading-[1.55] text-muted">
        {card ? (
          <>
            <span className="font-medium text-ink">{cardLabel(card)}</span> is now on file for{" "}
            {clientName}.
          </>
        ) : (
          <>A card is on file for {clientName}.</>
        )}{" "}
        Automatic billing will use it from the next charge date. You can close this page.
      </p>
    </div>
  );
}

function Unavailable({ reason }: { reason: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-lavender-deep bg-lavender text-violet">
        <svg width="26" height="26" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
          <rect x="4" y="9" width="12" height="8" rx="2" />
          <path d="M7 9V6a3 3 0 016 0v3" />
        </svg>
      </div>
      <h1 className="text-[20px] font-bold tracking-[-0.01em]">Link unavailable</h1>
      <p className="mt-2 text-[14px] leading-[1.55] text-muted">{reason}</p>
      <Link href="/login" className="mt-6 inline-block font-display text-[13px] font-medium text-violet hover:underline">
        Go to sign in →
      </Link>
    </div>
  );
}
```

- [ ] **Step 5: Verify by hand**

With `npm run dev` running, visit `http://localhost:3000/billing/setup/not-a-token` logged out. Expected: the "Link unavailable" card, no redirect to `/login` (the path is public). A real token is exercised in Task 19 once the console can generate one.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add lib/supabase/middleware.ts app/billing/setup/actions.ts components/billing/SetupCard.tsx "app/billing/setup/[token]/page.tsx"
git commit -m "feat(billing): public token-gated card-setup page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Client Billing page (`/dashboard/billing`) and navigation

**Files:**
- Modify: `lib/design.ts` (NavKey, NavItem group, NAV_ITEMS, NAV_GROUPS, SCREEN_TITLES)
- Modify: `components/dashboard/nav-icons.tsx` (billing icon)
- Modify: `lib/copy.ts` (EMPTY_COPY / ERROR_COPY entries for `billing`)
- Modify: `lib/billing/status.ts` (add `INVOICE_STATUS_LABEL`)
- Modify: `components/dashboard/Sidebar.tsx` (hide Billing unless enabled)
- Modify: `components/dashboard/Header.tsx` (no range/campaign controls on billing)
- Modify: `app/dashboard/layout.tsx` (resolve the flag)
- Create: `app/dashboard/billing/actions.ts`, `app/dashboard/billing/page.tsx`, `app/dashboard/billing/loading.tsx`, `components/dashboard/billing/BillingView.tsx`

**Interfaces:**
- Consumes: Tasks 6, 9, 10, 11, 8 (`cardLabel`), 3 (`mandateText`), `dayLabel`/`monthLabel`/`centsToMoneyExact` (`lib/usage.ts`).
- Produces: server actions `startCardSetup()`, `removeMyCard()`, `saveBillingEmail(formData)`; `INVOICE_STATUS_LABEL`.

- [ ] **Step 1: Navigation types and items (`lib/design.ts`)**

Change the `NavKey` union to include `"billing"`:

```ts
export type NavKey =
  | "overview"
  | "trends"
  | "funnel"
  | "calendar"
  | "outcomes"
  | "agents"
  | "campaigns"
  | "leads"
  | "logs"
  | "billing"
  | "design";
```

Change the `NavItem.group` type to `"Analytics" | "Performance" | "Records" | "Account" | "Reference"`.

Add to `NAV_ITEMS` after the `logs` entry:

```ts
  // Shown only when billing is enabled for the active workspace (Sidebar filters on the flag).
  { key: "billing", label: "Billing", href: "/dashboard/billing", group: "Account" },
```

Change `NAV_GROUPS` to `["Analytics", "Performance", "Records", "Account", "Reference"] as const;` and add `billing: "Billing",` to `SCREEN_TITLES`.

- [ ] **Step 2: Icon (`components/dashboard/nav-icons.tsx`)**

Add a case before `case "design":`:

```tsx
    case "billing":
      return (
        <svg {...common}>
          <rect x="2.5" y="5" width="15" height="10.5" rx="2" />
          <path d="M2.5 8.5h15" />
          <path d="M6 12.5h3" />
        </svg>
      );
```

- [ ] **Step 3: Copy maps (`lib/copy.ts`)**

`CopyKey` is `Exclude<NavKey, "design">`, so both maps need a `billing` entry. Add to `EMPTY_COPY`:

```ts
  billing: {
    title: "No invoices yet",
    body: "Your first invoice appears here after the first charge date. Until then, this page shows the card on file and this month's running estimate.",
  },
```

and to `ERROR_COPY`:

```ts
  billing: {
    title: "We couldn't load billing",
    body: "The billing service didn't respond. Nothing was charged — give it another go.",
  },
```

- [ ] **Step 4: Invoice status labels (`lib/billing/status.ts`)**

Append:

```ts
/** What a client (and an admin) reads for each invoice row. */
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  reserved: "Preparing",
  open: "Processing",
  paid: "Paid",
  failed: "Payment failed",
  action_required: "Needs authentication",
  void: "Voided",
  uncollectible: "Unpaid",
  skipped_zero: "Nothing to bill",
};
```

- [ ] **Step 5: Sidebar, Header, layout**

`components/dashboard/Sidebar.tsx`: add a `billingEnabled` prop and filter the item.

```tsx
export function Sidebar({
  workspace,
  billingEnabled = false,
}: {
  workspace: Pick<Workspace, "name" | "user" | "initials" | "role" | "isAdmin">;
  /** Billing is per-workspace; its nav item exists only where it is switched on. */
  billingEnabled?: boolean;
}) {
```

and change the items line inside the groups loop to:

```tsx
          const items = NAV_ITEMS.filter(
            (n) => n.group === group && !n.hidden && (n.key !== "billing" || billingEnabled),
          );
```

`components/dashboard/Header.tsx`: the billing page has no range or campaign scope, so extend the existing check:

```tsx
  // Views that carry their own scoping controls (board columns, calendar month nav) — or none
  // at all (billing) — don't show the global range/campaign filters.
  const isBoard =
    pathname.startsWith("/dashboard/trends") ||
    pathname.startsWith("/dashboard/calendar") ||
    pathname.startsWith("/dashboard/billing");
```

`app/dashboard/layout.tsx`: add the import

```ts
import { billingFeatureEnabled, getClientBilling } from "@/lib/billing/config";
```

then, after the campaign options block and before `return`, resolve the flag:

```ts
  // The Billing nav item exists only where billing is switched on for this workspace.
  let billingEnabled = false;
  if (billingFeatureEnabled()) {
    try {
      billingEnabled = (await getClientBilling(ws.clientId))?.enabled === true;
    } catch {
      // A billing lookup failure hides the item; it never blocks the dashboard.
    }
  }
```

and render `<Sidebar workspace={ws} billingEnabled={billingEnabled} />`.

- [ ] **Step 6: Create `app/dashboard/billing/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { getSessionClientId, getSessionUser } from "@/lib/auth";
import { billingFeatureEnabled, loadClientBilling, upsertClientBilling, type ClientBilling } from "@/lib/billing/config";
import { removeCard } from "@/lib/billing/customers";
import { createCheckoutSession } from "@/lib/billing/setup";
import { getRequestOrigin } from "@/lib/origin";
import { getStripe } from "@/lib/stripe/client";

/** The active workspace's billing row — every member action is scoped by the session, never by input. */
async function activeBilling(): Promise<ClientBilling> {
  if (!billingFeatureEnabled()) redirect("/dashboard");
  const cb = await loadClientBilling(await getSessionClientId());
  if (!cb?.enabled) redirect("/dashboard/billing");
  return cb;
}

/** "Add card" / "Replace card": open Stripe Checkout in setup mode and come back here. */
export async function startCardSetup() {
  const cb = await activeBilling();
  const origin = await getRequestOrigin();
  const url = await createCheckoutSession({
    clientId: cb.clientId,
    successUrl: `${origin}/dashboard/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}/dashboard/billing?setup=cancelled`,
  });
  redirect(url);
}

export async function removeMyCard() {
  const cb = await activeBilling();
  const removed = await removeCard(cb.clientId, await getRequestOrigin());
  redirect(removed ? "/dashboard/billing?notice=card_removed" : "/dashboard/billing");
}

/** Billing contact: stored locally and on the Stripe customer, so Stripe's receipts go there too. */
export async function saveBillingEmail(formData: FormData) {
  const cb = await activeBilling();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) redirect("/dashboard/billing?error=email");
  const user = await getSessionUser();
  await upsertClientBilling(cb.clientId, { billingEmail: email }, user?.id ?? null);
  if (cb.stripeCustomerId) {
    await getStripe()
      .customers.update(cb.stripeCustomerId, { email })
      .catch((e) => console.warn("[billing] customer email update failed:", e));
  }
  redirect("/dashboard/billing?notice=email_saved");
}
```

- [ ] **Step 7: Create `components/dashboard/billing/BillingView.tsx`**

```tsx
import { removeMyCard, saveBillingEmail, startCardSetup } from "@/app/dashboard/billing/actions";
import { SubmitButton } from "@/components/ui/states/SubmitButton";
import type { CardOnFile } from "@/lib/billing/config";
import { BILLING_DISABLED_COPY, mandateText, ordinal } from "@/lib/billing/copy";
import type { InvoiceRow } from "@/lib/billing/invoices";
import { INVOICE_STATUS_LABEL, type InvoiceStatus } from "@/lib/billing/status";
import { centsToMoneyExact, dayLabel, monthLabel } from "@/lib/usage";

export interface BillingEstimate {
  label: string;
  usageCents: number | null;
  feeCents: number;
  totalCents: number | null;
  nextChargeDate: string;
}

export interface BillingViewProps {
  clientName: string;
  card: CardOnFile | null;
  billingEmail: string | null;
  anchorDay: number;
  estimate: BillingEstimate;
  invoices: InvoiceRow[];
  notice: string | null;
  error: string | null;
}

const NOTICE: Record<string, string> = {
  card_added: "Your card is on file. Automatic billing will use it from the next charge date.",
  card_removed: "Your card was removed. Nothing will be charged until a new card is added.",
  email_saved: "Billing contact saved.",
};

const ERROR: Record<string, string> = {
  setup: "We couldn't confirm the card. Please try adding it again.",
  email: "Enter a valid email address.",
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

export function BillingDisabled() {
  return (
    <div className="flex min-h-[380px] flex-col items-center justify-center px-5 py-16 text-center">
      <div className="mb-2 text-[22px] font-bold tracking-[-0.01em]">{BILLING_DISABLED_COPY.title}</div>
      <div className="max-w-[420px] text-[15px] leading-[1.55] text-muted">{BILLING_DISABLED_COPY.body}</div>
    </div>
  );
}

export function BillingView(p: BillingViewProps) {
  const noticeText = p.notice ? NOTICE[p.notice] : null;
  const errorText = p.error ? ERROR[p.error] : null;

  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-5 text-[14px] text-muted">
        Automatic monthly billing for {p.clientName} · charged on the {ordinal(p.anchorDay)} of each month
      </div>

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
                Add a card to be billed automatically. Until then nothing is charged.
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
            {mandateText(p.anchorDay)}
          </div>
        </Panel>

        {/* next charge */}
        <Panel title="Next charge" subtitle={`${p.estimate.label} · estimate`}>
          <div className="flex flex-col">
            <Line label="Emma usage so far" value={p.estimate.usageCents == null ? "—" : centsToMoneyExact(p.estimate.usageCents)} />
            <Line label="Monthly fee" value={centsToMoneyExact(p.estimate.feeCents)} />
            <div className="flex items-center justify-between gap-3 bg-lavender px-5 py-3">
              <span className="text-[12.5px] font-semibold">Estimated total</span>
              <span className="font-mono text-[14px] font-bold text-violet tabular-nums">
                {p.estimate.totalCents == null ? "—" : centsToMoneyExact(p.estimate.totalCents)}
              </span>
            </div>
            <div className="px-5 py-3 text-[12px] text-muted">
              Charged on <span className="font-medium text-ink">{dayLabel(p.estimate.nextChargeDate)}</span> for the
              full month. Usage accrues until the month closes, so the final amount can be higher.
              {p.estimate.usageCents == null ? " Usage could not be loaded just now; this is not a zero." : ""}
            </div>
          </div>
        </Panel>
      </div>

      {/* invoices */}
      <Panel title="Invoices" subtitle="one per calendar month">
        {p.invoices.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-muted">
            No invoices yet. Your first one appears after the first charge date.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-surface-tint">
                  {["Period", "Usage", "Fee", "Total", "Status", ""].map((h, i) => (
                    <th
                      key={h || i}
                      className={`px-5 py-[11px] font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted ${i >= 1 && i <= 3 ? "text-right" : "text-left"}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.invoices.map((inv, i) => (
                  <tr key={inv.id} className={i % 2 ? "bg-lavender/40" : "bg-white"}>
                    <td className="border-b border-lavender px-5 py-2.5 font-medium">{monthLabel(inv.periodMonth)}</td>
                    <td className="border-b border-lavender px-5 py-2.5 text-right font-mono tabular-nums">
                      {inv.billedUsageCents == null ? "—" : centsToMoneyExact(inv.billedUsageCents)}
                    </td>
                    <td className="border-b border-lavender px-5 py-2.5 text-right font-mono tabular-nums">
                      {inv.feeCents == null ? "—" : centsToMoneyExact(inv.feeCents)}
                    </td>
                    <td className="border-b border-lavender px-5 py-2.5 text-right font-mono font-semibold tabular-nums">
                      {inv.totalCents == null ? "—" : centsToMoneyExact(inv.totalCents)}
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
```

- [ ] **Step 8: Create the page and its loading state**

`app/dashboard/billing/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/states/Skeleton";

export default function Loading() {
  return <Skeleton variant="cards" />;
}
```

`app/dashboard/billing/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { BillingDisabled, BillingView } from "@/components/dashboard/billing/BillingView";
import { getWorkspace } from "@/lib/auth";
import { billingFeatureEnabled, getClientBilling } from "@/lib/billing/config";
import { estimateCurrentMonth, listInvoices, tzOf } from "@/lib/billing/invoices";
import { reconcileCheckoutSession } from "@/lib/billing/setup";
import { getRequestOrigin } from "@/lib/origin";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * The client's Billing page. Reachable only through the session's active workspace. Returning
 * from Stripe lands here with `session_id`; the card is confirmed server-side and the browser is
 * sent to a clean URL so a refresh doesn't re-run the reconcile.
 */
export default async function BillingPage({ searchParams }: { searchParams: SP }) {
  if (!billingFeatureEnabled()) notFound();
  const sp = await searchParams;
  const ws = await getWorkspace();
  const cb = await getClientBilling(ws.clientId);
  if (!cb?.enabled) return <BillingDisabled />;

  const sessionId = one(sp.session_id);
  if (sessionId) {
    const result = await reconcileCheckoutSession(sessionId, ws.clientId, await getRequestOrigin());
    redirect(result.ok ? "/dashboard/billing?notice=card_added" : "/dashboard/billing?error=setup");
  }

  const tz = tzOf(ws.timezone);
  const [invoices, figure] = await Promise.all([listInvoices(ws.clientId), estimateCurrentMonth(cb, tz)]);

  return (
    <BillingView
      clientName={ws.name}
      card={cb.card}
      billingEmail={cb.billingEmail}
      anchorDay={cb.effective.anchorDay}
      estimate={{
        label: figure.label,
        usageCents: figure.lines?.billedUsageCents ?? null,
        feeCents: cb.effective.feeCents,
        totalCents: figure.lines?.totalCents ?? null,
        nextChargeDate: figure.nextChargeDate,
      }}
      invoices={invoices}
      notice={one(sp.notice) ?? null}
      error={one(sp.error) ?? null}
    />
  );
}
```

- [ ] **Step 9: Verify by hand**

Run `npm run dev`, sign in as the member `demo@heyemma.io` (see `.seed-credentials.txt`). Expected: no "Billing" item in the sidebar (billing is not enabled for any workspace yet) and `http://localhost:3000/dashboard/billing` shows "Billing isn't set up for this workspace". The overview spend KPI is unchanged (no markup while billing is off). The full flow is exercised in Task 19.

- [ ] **Step 10: Typecheck, lint, selftests, commit**

Run: `npx tsc --noEmit && npm run lint && npm run test:billing`

```bash
git add lib/design.ts components/dashboard/nav-icons.tsx lib/copy.ts lib/billing/status.ts components/dashboard/Sidebar.tsx components/dashboard/Header.tsx app/dashboard/layout.tsx app/dashboard/billing components/dashboard/billing/BillingView.tsx
git commit -m "feat(billing): client Billing page — card on file, next-charge estimate, invoices

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Console billing overview (`/console/billing`)

**Files:**
- Modify: `components/console/ConsoleSidebar.tsx`
- Create: `app/console/billing/actions.ts` (defaults + run-now actions; Task 17 appends the per-client ones)
- Create: `app/console/billing/page.tsx`, `app/console/billing/loading.tsx`
- Create: `components/console/BillingOverview.tsx`

**Interfaces:**
- Consumes: `getBillingSettings`, `listClientBilling`, `saveBillingSettings` (Task 6); `listAgencyClients` (`lib/olivia/agency.ts`); `latestInvoiceByClient`, `lastBillingRun`, `runBilling`, `tzOf` (Task 11); `deriveStatus`, `STATUS_LABEL` (Task 4); `localDate`, `nextChargeDate` (Task 3); parsers + `bpsToPercent`/`centsToDollarsInput` (Task 2); `cardLabel` (Task 8); `stripeLivemode` (Task 1).
- Produces: server actions `saveBillingDefaults(formData)`, `runBillingNow()`; component `BillingOverview`.

- [ ] **Step 1: Nav entries (`components/console/ConsoleSidebar.tsx`)**

Replace the `NAV` constant:

```tsx
const NAV = [
  { href: "/console", label: "Overview", key: "overview", group: "Agency" },
  { href: "/console/clients", label: "Clients", key: "clients", group: "Agency" },
  { href: "/console/billing", label: "Billing", key: "billing", group: "Agency" },
  { href: "/console/usage", label: "Usage report", key: "usage", group: "Agency" },
  { href: "/console/invites", label: "Invites & members", key: "invites", group: "Agency" },
  { href: "/console/team", label: "Agency team", key: "team", group: "Organisation" },
] as const;
```

("Usage & billing" becomes "Usage report" so the two pages are not confused; the route is unchanged.)

- [ ] **Step 2: Create `app/console/billing/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { saveBillingSettings } from "@/lib/billing/config";
import { runBilling } from "@/lib/billing/invoices";
import { parseAnchorDay, parseDollarsToCents, parsePercentToBps } from "@/lib/billing/money";
import { getRequestOrigin } from "@/lib/origin";

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

/** Platform-admin only: the defaults every client inherits unless overridden. */
export async function saveBillingDefaults(formData: FormData) {
  const ctx = await requireAdmin();
  const markupBps = parsePercentToBps(str(formData, "markup"));
  const feeCents = parseDollarsToCents(str(formData, "fee"));
  const anchorDay = parseAnchorDay(str(formData, "anchorDay"));
  const alertEmail = str(formData, "alertEmail").toLowerCase();
  if (markupBps == null || feeCents == null || anchorDay == null) redirect("/console/billing?error=invalid");
  if (alertEmail && !alertEmail.includes("@")) redirect("/console/billing?error=invalid");
  await saveBillingSettings({ markupBps, feeCents, anchorDay, alertEmail: alertEmail || null }, ctx.userId);
  redirect("/console/billing?notice=saved");
}

/** Platform-admin only: the daily job, on demand. Only months that are due are touched. */
export async function runBillingNow() {
  await requireAdmin();
  const summary = await runBilling("manual", { origin: await getRequestOrigin() });
  redirect(`/console/billing?notice=run&invoiced=${summary.counts.invoiced}&errors=${summary.counts.error}`);
}
```

- [ ] **Step 3: Create `components/console/BillingOverview.tsx`**

```tsx
import Link from "next/link";
import { runBillingNow, saveBillingDefaults } from "@/app/console/billing/actions";
import { SubmitButton } from "@/components/ui/states/SubmitButton";
import type { BillingSettings, ClientBilling } from "@/lib/billing/config";
import type { BillingRunInfo, InvoiceRow } from "@/lib/billing/invoices";
import { bpsToPercent, centsToDollarsInput } from "@/lib/billing/money";
import { cardLabel } from "@/lib/billing/notify";
import { INVOICE_STATUS_LABEL, STATUS_LABEL, type ClientBillingStatus } from "@/lib/billing/status";
import { relTime } from "@/lib/format";
import { centsToMoneyExact, dayLabel, monthLabel } from "@/lib/usage";

export interface BillingOverviewRow {
  client: { id: string; name: string; timezone: string | null };
  cb: ClientBilling | null;
  status: ClientBillingStatus;
  nextCharge: string | null;
  lastInvoice: InvoiceRow | null;
}

export interface BillingOverviewProps {
  settings: BillingSettings;
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
};

const COLS = "grid-cols-[1.8fr_1fr_1.3fr_0.8fr_0.7fr_0.6fr_1fr_1.3fr_0.9fr]";

export function BillingOverview(p: BillingOverviewProps) {
  const counts = {
    active: p.rows.filter((r) => r.status === "active").length,
    noCard: p.rows.filter((r) => r.status === "no_card").length,
    failed: p.rows.filter((r) => r.status === "payment_failed" || r.status === "action_required").length,
  };
  const notice =
    p.notice === "saved"
      ? "Defaults saved."
      : p.notice === "run"
        ? `Billing run finished: ${p.runInfo.invoiced ?? 0} invoiced, ${p.runInfo.errors ?? 0} errors.`
        : null;
  const error = p.error === "invalid" ? "Check the values: markup 0–300%, fee in dollars, anchor day 1–28." : null;

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
        <form action={runBillingNow}>
          <SubmitButton
            pendingLabel="Running…"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-ink/10 bg-white px-3 py-[7px] font-display text-[12.5px] font-medium text-ink transition-colors hover:bg-lavender"
          >
            Run billing now
          </SubmitButton>
        </form>
      </div>
      <div className="mb-6 text-[14px] text-muted">
        Automatic monthly charging · each client is billed for the previous calendar month on their anchor day
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
        <div className="w-full font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">Platform defaults</div>
        <Field label="Markup %" name="markup" defaultValue={bpsToPercent(p.settings.markupBps)} placeholder="0" />
        <Field label="Monthly fee (USD)" name="fee" defaultValue={centsToDollarsInput(p.settings.feeCents)} placeholder="0" />
        <Field label="Anchor day" name="anchorDay" defaultValue={String(p.settings.anchorDay)} placeholder="3" type="number" />
        <Field label="Alerts email (optional)" name="alertEmail" defaultValue={p.settings.alertEmail ?? ""} placeholder="billing@agency.com" type="email" wide />
        <SubmitButton
          pendingLabel="Saving…"
          className="bg-gradient-brand rounded-[10px] px-4 py-2 font-display text-[13px] font-semibold text-white transition-transform active:scale-95"
        >
          Save defaults
        </SubmitButton>
      </form>

      {/* status strip */}
      <div className="mb-6 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <Kpi label="Active" value={String(counts.active)} accent />
        <Kpi label="No card" value={String(counts.noCard)} />
        <Kpi label="Payment issues" value={String(counts.failed)} />
        <Kpi
          label="Last run"
          value={p.lastRun ? relTime(p.lastRun.startedAt) : "never"}
          hint={p.lastRun ? `${p.lastRun.trigger} · ${p.lastRun.counts.invoiced ?? 0} invoiced` : "runs daily at 03:00 UTC"}
        />
      </div>

      {/* clients */}
      <div className="overflow-hidden rounded-[16px] border border-ink/10 bg-white shadow-sm">
        <div className={`grid ${COLS} gap-3 border-b border-ink/10 bg-surface-tint px-[22px] py-[13px]`}>
          {["Client", "Status", "Card", "Fee", "Markup", "Anchor", "Next charge", "Last invoice", ""].map((h, i) => (
            <div key={h || i} className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
              {h}
            </div>
          ))}
        </div>
        {p.rows.map((r, i) => (
          <div
            key={r.client.id}
            className={`grid ${COLS} items-center gap-3 border-b border-lavender px-[22px] py-3 text-[13px] ${i % 2 ? "bg-lavender/40" : "bg-white"}`}
          >
            <div className="min-w-0 truncate font-medium">{r.client.name}</div>
            <div>
              <span className={`inline-flex rounded-full border px-2 py-[2px] font-mono text-[10.5px] ${STATUS_CLASS[r.status]}`}>
                {STATUS_LABEL[r.status]}
              </span>
            </div>
            <div className="truncate font-mono text-[12px] text-muted">{r.cb?.card ? cardLabel(r.cb.card) : "—"}</div>
            <div className="font-mono text-[12.5px] tabular-nums">{r.cb ? centsToMoneyExact(r.cb.effective.feeCents) : "—"}</div>
            <div className="font-mono text-[12.5px] tabular-nums">{r.cb ? `${bpsToPercent(r.cb.effective.markupBps)}%` : "—"}</div>
            <div className="font-mono text-[12.5px] tabular-nums">{r.cb ? r.cb.effective.anchorDay : "—"}</div>
            <div className="font-mono text-[12px] text-muted">{r.nextCharge ? dayLabel(r.nextCharge) : "—"}</div>
            <div className="min-w-0 truncate font-mono text-[12px]">
              {r.lastInvoice ? (
                <>
                  {monthLabel(r.lastInvoice.periodMonth)} ·{" "}
                  {r.lastInvoice.totalCents == null ? "—" : centsToMoneyExact(r.lastInvoice.totalCents)} ·{" "}
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

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="rounded-[13px] border border-ink/10 bg-white px-4 py-3.5 shadow-sm">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-muted">{label}</div>
      <div className={`font-display text-[22px] font-bold tracking-[-0.01em] ${accent ? "text-violet" : "text-ink"}`}>{value}</div>
      {hint ? <div className="mt-0.5 font-mono text-[10.5px] text-muted">{hint}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Create the page and loading state**

`app/console/billing/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/states/Skeleton";

export default function Loading() {
  return <Skeleton variant="console-table" />;
}
```

`app/console/billing/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { BillingOverview, type BillingOverviewRow } from "@/components/console/BillingOverview";
import { billingFeatureEnabled, getBillingSettings, listClientBilling } from "@/lib/billing/config";
import { lastBillingRun, latestInvoiceByClient, tzOf } from "@/lib/billing/invoices";
import { localDate, nextChargeDate } from "@/lib/billing/schedule";
import { deriveStatus } from "@/lib/billing/status";
import { listAgencyClients, refreshAgencyClients } from "@/lib/olivia/agency";
import { stripeLivemode } from "@/lib/stripe/client";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function ConsoleBillingPage({ searchParams }: { searchParams: SP }) {
  if (!billingFeatureEnabled()) notFound();
  const sp = await searchParams;
  await refreshAgencyClients().catch(() => {});
  const [settings, configs, clients, latest, lastRun] = await Promise.all([
    getBillingSettings(),
    listClientBilling(),
    listAgencyClients(),
    latestInvoiceByClient(),
    lastBillingRun(),
  ]);
  const byId = new Map(configs.map((c) => [c.clientId, c]));
  const now = new Date();
  const rows: BillingOverviewRow[] = clients.map((client) => {
    const cb = byId.get(client.id) ?? null;
    const lastInvoice = latest.get(client.id) ?? null;
    const today = localDate(now, tzOf(client.timezone));
    return {
      client: { id: client.id, name: client.name, timezone: client.timezone },
      cb,
      status: deriveStatus({
        enabled: cb?.enabled ?? false,
        hasCard: Boolean(cb?.card),
        lastInvoiceStatus: lastInvoice?.status ?? null,
      }),
      nextCharge: cb?.enabled ? nextChargeDate(today, cb.effective.anchorDay) : null,
      lastInvoice,
    };
  });
  return (
    <BillingOverview
      settings={settings}
      rows={rows}
      lastRun={lastRun}
      livemode={stripeLivemode()}
      notice={one(sp.notice) ?? null}
      error={one(sp.error) ?? null}
      runInfo={{ invoiced: one(sp.invoiced), errors: one(sp.errors) }}
    />
  );
}
```

- [ ] **Step 5: Verify by hand**

Sign in as a platform admin (`carlos@lunargrowth.io`, see `.seed-credentials.txt`). Expected: "Billing" in the console nav; `/console/billing` lists every client as `Off`; saving defaults (e.g. markup `20`, fee `300`, anchor `3`) round-trips; entering anchor `31` shows the validation notice and saves nothing.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add components/console/ConsoleSidebar.tsx app/console/billing/actions.ts app/console/billing/page.tsx app/console/billing/loading.tsx components/console/BillingOverview.tsx
git commit -m "feat(billing): console billing overview with platform defaults and run-now

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Console per-client billing page (`/console/billing/[id]`) and the client-detail card

**Files:**
- Modify: `app/console/billing/actions.ts` (append per-client actions)
- Create: `app/console/billing/[id]/page.tsx`, `app/console/billing/[id]/loading.tsx`
- Create: `components/console/BillingClientView.tsx`
- Modify: `components/console/ClientDetailView.tsx`, `app/console/clients/[id]/page.tsx`

**Interfaces:**
- Consumes: Tasks 2, 3, 4, 6, 8, 9, 10, 11; `CopyButton` (`components/ui/CopyButton.tsx`); `listAgencyClients`, `getClientDetail` (`lib/olivia/agency.ts`); `getRequestOrigin`.
- Produces: server actions `saveClientBilling`, `generateSetupLink`, `emailSetupLink`, `revokeLink`, `adminRemoveCard`, `chargeNow`, `retryCharge`.

- [ ] **Step 1: Append the per-client actions to `app/console/billing/actions.ts`**

Add these imports at the top of the file (merge with the existing ones):

```ts
import { loadClientBilling, upsertClientBilling } from "@/lib/billing/config";
import { removeCard } from "@/lib/billing/customers";
import { invoiceMonth, retryInvoice, tzOf } from "@/lib/billing/invoices";
import { parseMonthKey } from "@/lib/billing/money";
import { sendSetupLinkEmail } from "@/lib/billing/notify";
import { localDate, monthOf, prevMonth } from "@/lib/billing/schedule";
import {
  SETUP_LINK_TTL_DAYS,
  createSetupLink,
  markSetupLinkSent,
  revokeSetupLink,
  setupLinkUrl,
} from "@/lib/billing/setup";
import { createAdminClient } from "@/lib/supabase/admin";
```

and append:

```ts
/** The client must be one of ours; a client id is never trusted from the form alone. */
async function knownClient(clientId: string): Promise<{ id: string; name: string; timezone: string | null } | null> {
  if (!clientId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("olivia_clients")
    .select("olivia_client_id, name, timezone")
    .eq("olivia_client_id", clientId)
    .maybeSingle();
  return data
    ? { id: data.olivia_client_id as string, name: (data.name as string | null) ?? clientId, timezone: (data.timezone as string | null) ?? null }
    : null;
}

/** Earliest-mapped member's email, for the first billing contact. */
async function defaultBillingEmail(clientId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: member } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("olivia_client_id", clientId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!member) return null;
  const { data } = await admin.auth.admin.getUserById(member.user_id as string);
  return data.user?.email?.toLowerCase() ?? null;
}

/** Platform-admin only: enable/disable and the per-client overrides. Blank override = default. */
export async function saveClientBilling(formData: FormData) {
  const ctx = await requireAdmin();
  const client = await knownClient(str(formData, "clientId"));
  if (!client) redirect("/console/billing?error=client");
  const back = `/console/billing/${client.id}`;

  const enabled = formData.get("enabled") === "on";
  const emailRaw = str(formData, "billingEmail").toLowerCase();
  if (emailRaw && !emailRaw.includes("@")) redirect(`${back}?error=email`);
  const billFromRaw = str(formData, "billFromMonth");
  const billFromMonth = billFromRaw ? parseMonthKey(billFromRaw) : null;
  if (billFromRaw && !billFromMonth) redirect(`${back}?error=invalid`);
  const markupRaw = str(formData, "markup");
  const markupBps = markupRaw ? parsePercentToBps(markupRaw) : null;
  if (markupRaw && markupBps == null) redirect(`${back}?error=invalid`);
  const feeRaw = str(formData, "fee");
  const feeCents = feeRaw ? parseDollarsToCents(feeRaw) : null;
  if (feeRaw && feeCents == null) redirect(`${back}?error=invalid`);
  const anchorRaw = str(formData, "anchorDay");
  const anchorDay = anchorRaw ? parseAnchorDay(anchorRaw) : null;
  if (anchorRaw && anchorDay == null) redirect(`${back}?error=invalid`);

  const existing = await loadClientBilling(client.id);
  // First configure: bill from the current month in the client's timezone, and default the
  // billing contact to the earliest member, so switching billing on never bills the past by
  // accident and always has somewhere to send receipts.
  const billFrom = billFromMonth ?? existing?.billFromMonth ?? monthOf(localDate(new Date(), tzOf(client.timezone)));
  const billingEmail = emailRaw || existing?.billingEmail || (await defaultBillingEmail(client.id));

  await upsertClientBilling(
    client.id,
    { enabled, billingEmail, billFromMonth: billFrom, markupBps, feeCents, anchorDay },
    ctx.userId,
  );
  redirect(`${back}?notice=saved`);
}

/** Platform-admin only: a fresh card-setup link (7 days, reusable until completed). */
export async function generateSetupLink(formData: FormData) {
  const ctx = await requireAdmin();
  const client = await knownClient(str(formData, "clientId"));
  if (!client) redirect("/console/billing?error=client");
  const cb = await loadClientBilling(client.id);
  if (!cb?.enabled) redirect(`/console/billing/${client.id}?error=disabled`);
  await createSetupLink(client.id, ctx.userId);
  redirect(`/console/billing/${client.id}?notice=link`);
}

/** Platform-admin only: email an existing link. Fail-soft — the copy-link UI remains the fallback. */
export async function emailSetupLink(formData: FormData) {
  await requireAdmin();
  const client = await knownClient(str(formData, "clientId"));
  if (!client) redirect("/console/billing?error=client");
  const back = `/console/billing/${client.id}`;
  const linkId = str(formData, "linkId");
  const token = str(formData, "token");
  const to = str(formData, "email").toLowerCase();
  if (!linkId || !token || !to.includes("@")) redirect(`${back}?error=email`);
  const cb = await loadClientBilling(client.id);
  const origin = await getRequestOrigin();
  const { error } = await sendSetupLinkEmail({
    clientId: client.id,
    clientName: client.name,
    to,
    setupUrl: setupLinkUrl(origin, token),
    feeCents: cb?.effective.feeCents ?? 0,
    anchorDay: cb?.effective.anchorDay ?? 3,
    expiresInDays: SETUP_LINK_TTL_DAYS,
  });
  if (error) {
    console.error("[billing] setup link email failed:", error);
    redirect(`${back}?error=send`);
  }
  await markSetupLinkSent(linkId, to);
  redirect(`${back}?notice=sent`);
}

export async function revokeLink(formData: FormData) {
  await requireAdmin();
  const client = await knownClient(str(formData, "clientId"));
  if (!client) redirect("/console/billing?error=client");
  await revokeSetupLink(str(formData, "linkId"));
  redirect(`/console/billing/${client.id}?notice=revoked`);
}

export async function adminRemoveCard(formData: FormData) {
  await requireAdmin();
  const client = await knownClient(str(formData, "clientId"));
  if (!client) redirect("/console/billing?error=client");
  await removeCard(client.id, await getRequestOrigin());
  redirect(`/console/billing/${client.id}?notice=card_removed`);
}

/** Platform-admin only: invoice one closed month now, ignoring the anchor day. Never the current month. */
export async function chargeNow(formData: FormData) {
  const ctx = await requireAdmin();
  const client = await knownClient(str(formData, "clientId"));
  if (!client) redirect("/console/billing?error=client");
  const back = `/console/billing/${client.id}`;
  const month = parseMonthKey(str(formData, "month"));
  const lastClosed = prevMonth(monthOf(localDate(new Date(), tzOf(client.timezone))));
  if (!month || month > lastClosed) redirect(`${back}?error=month`);
  const r = await invoiceMonth(client.id, month, "manual", { createdBy: ctx.userId, origin: await getRequestOrigin() });
  redirect(`${back}?notice=charged&outcome=${r.outcome}&status=${r.status ?? ""}`);
}

export async function retryCharge(formData: FormData) {
  await requireAdmin();
  const client = await knownClient(str(formData, "clientId"));
  if (!client) redirect("/console/billing?error=client");
  const r = await retryInvoice(str(formData, "invoiceId"));
  redirect(`/console/billing/${client.id}?notice=retried&ok=${r.ok ? 1 : 0}&status=${r.status ?? ""}`);
}
```

- [ ] **Step 2: Create `components/console/BillingClientView.tsx`**

```tsx
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
import { INVOICE_STATUS_LABEL, STATUS_LABEL, type ClientBillingStatus } from "@/lib/billing/status";
import { initials as toInitials, relTime } from "@/lib/format";
import { centsToMoneyExact, dayLabel, monthLabel } from "@/lib/usage";

export interface BillingClientViewProps {
  client: { id: string; name: string; timezone: string | null };
  cb: ClientBilling | null;
  settings: BillingSettings;
  status: ClientBillingStatus;
  links: SetupLink[];
  baseUrl: string;
  invoices: InvoiceRow[];
  /** Last closed month, raw → billed. null when billing is off. */
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
    case "charged": {
      const o = p.extra.outcome;
      const s = p.extra.status;
      if (o === "invoiced") return `Invoice created — ${s === "paid" ? "paid" : s === "failed" ? "payment failed (see below)" : s}.`;
      if (o === "skipped_zero") return "Nothing to bill for that month.";
      if (o === "skipped_no_card") return "Not charged: no card on file.";
      if (o === "usage_unavailable") return "Not charged: usage could not be loaded. Try again later.";
      if (o === "already_invoiced") return "That month already has an invoice.";
      return `Charge did not complete (${o ?? "error"}).`;
    }
    case "retried":
      return p.extra.ok === "1" ? "Payment succeeded." : `Retry did not succeed (${p.extra.status ?? "failed"}).`;
    default:
      return null;
  }
}

function errorText(code: string | null): string | null {
  switch (code) {
    case "invalid":
      return "Check the values: markup 0–300%, fee in dollars, anchor day 1–28, month as YYYY-MM.";
    case "email":
      return "Enter a valid email address.";
    case "disabled":
      return "Switch billing on for this client first.";
    case "send":
      return "The email could not be sent — copy the link instead.";
    case "month":
      return "Choose a closed month (never the current one).";
    default:
      return null;
  }
}

export function BillingClientView(p: BillingClientViewProps) {
  const { client, cb, settings } = p;
  const notice = noticeText(p);
  const error = errorText(p.error);
  const pending = p.links.filter((l) => l.status === "pending");

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
            <div className="grid grid-cols-3 gap-3">
              <Field label="Markup %" name="markup" defaultValue={cb?.overrides.markupBps == null ? "" : bpsToPercent(cb.overrides.markupBps)} placeholder={`Default ${bpsToPercent(settings.markupBps)}`} />
              <Field label="Monthly fee (USD)" name="fee" defaultValue={cb?.overrides.feeCents == null ? "" : centsToDollarsInput(cb.overrides.feeCents)} placeholder={`Default ${centsToDollarsInput(settings.feeCents)}`} />
              <Field label="Anchor day" name="anchorDay" defaultValue={cb?.overrides.anchorDay == null ? "" : String(cb.overrides.anchorDay)} placeholder={`Default ${settings.anchorDay}`} />
            </div>
            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="font-mono text-[11px] text-muted">
                Effective: {cb ? `${bpsToPercent(cb.effective.markupBps)}% · ${centsToMoneyExact(cb.effective.feeCents)} · day ${cb.effective.anchorDay}` : "—"}
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
                <Line label="Usage (raw)" value={p.preview.lines ? centsToMoneyExact(p.preview.lines.rawUsageCents) : "—"} />
                <Line label={`Billed usage (+${p.preview.lines ? bpsToPercent(p.preview.lines.markupBps) : "0"}%)`} value={p.preview.lines ? centsToMoneyExact(p.preview.lines.billedUsageCents) : "—"} />
                <Line label="Monthly fee" value={p.preview.lines ? centsToMoneyExact(p.preview.lines.feeCents) : "—"} />
                <div className="flex items-center justify-between gap-3 bg-lavender px-5 py-3">
                  <span className="text-[12.5px] font-semibold">Total</span>
                  <span className="font-mono text-[14px] font-bold text-violet tabular-nums">{p.preview.lines ? centsToMoneyExact(p.preview.lines.totalCents) : "—"}</span>
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
          {pending.length === 0 ? (
            <div className="px-5 py-6 text-center text-[13px] text-muted">No pending links.</div>
          ) : (
            pending.map((l) => {
              const url = `${p.baseUrl}/billing/setup/${l.token}`;
              return (
                <div key={l.id} className="border-b border-lavender px-5 py-4 last:border-0">
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-[8px] border border-lavender-deep bg-lavender px-2.5 py-1.5 font-mono text-[11.5px] text-ink">{url}</code>
                    <CopyButton value={url} />
                    <form action={revokeLink}>
                      <input type="hidden" name="clientId" value={client.id} />
                      <input type="hidden" name="linkId" value={l.id} />
                      <SubmitButton pendingLabel="Revoking…" className="rounded-[8px] border border-ink/10 bg-white px-2.5 py-1.5 font-display text-[12px] font-medium text-danger transition-colors hover:bg-danger/8">
                        Revoke
                      </SubmitButton>
                    </form>
                  </div>
                  <form action={emailSetupLink} className="mt-2.5 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="clientId" value={client.id} />
                    <input type="hidden" name="linkId" value={l.id} />
                    <input type="hidden" name="token" value={l.token} />
                    <input type="email" name="email" required defaultValue={l.sentTo ?? cb?.billingEmail ?? ""} placeholder="billing@client.com" className="min-w-[220px] flex-1 rounded-[9px] border border-ink/10 bg-white px-3 py-1.5 font-display text-[12.5px] text-ink placeholder:text-muted/60" />
                    <SubmitButton pendingLabel="Sending…" className="rounded-[9px] border border-ink/10 bg-white px-3 py-1.5 font-display text-[12.5px] font-medium text-ink transition-colors hover:bg-lavender">
                      {l.sentTo ? "Email again" : "Email link"}
                    </SubmitButton>
                    <span className="font-mono text-[11px] text-muted">expires {relTime(l.expiresAt)}{l.sentTo ? ` · sent to ${l.sentTo}` : ""}</span>
                  </form>
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
```

- [ ] **Step 3: Create the page and loading state**

`app/console/billing/[id]/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/states/Skeleton";

export default function Loading() {
  return <Skeleton variant="console-detail" />;
}
```

`app/console/billing/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { BillingClientView } from "@/components/console/BillingClientView";
import { billingFeatureEnabled, getBillingSettings, getClientBilling } from "@/lib/billing/config";
import { listInvoices, previewLastClosedMonth, tzOf } from "@/lib/billing/invoices";
import { closedMonthsWithoutInvoice, localDate, nextChargeDate } from "@/lib/billing/schedule";
import { listSetupLinks } from "@/lib/billing/setup";
import { deriveStatus } from "@/lib/billing/status";
import { listAgencyClients } from "@/lib/olivia/agency";
import { getRequestOrigin } from "@/lib/origin";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function ConsoleBillingClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SP;
}) {
  if (!billingFeatureEnabled()) notFound();
  const { id } = await params;
  const sp = await searchParams;
  const clients = await listAgencyClients(); // requireAdmin() inside — the client id must be one of ours
  const client = clients.find((c) => c.id === id);
  if (!client) notFound();

  const [settings, cb, links, baseUrl, invoices] = await Promise.all([
    getBillingSettings(),
    getClientBilling(id),
    listSetupLinks(id),
    getRequestOrigin(),
    listInvoices(id),
  ]);
  const tz = tzOf(client.timezone);
  const today = localDate(new Date(), tz);
  const preview = cb?.enabled ? await previewLastClosedMonth(cb, tz) : null;
  const status = deriveStatus({
    enabled: cb?.enabled ?? false,
    hasCard: Boolean(cb?.card),
    lastInvoiceStatus: invoices[0]?.status ?? null,
  });

  return (
    <BillingClientView
      client={{ id: client.id, name: client.name, timezone: client.timezone }}
      cb={cb}
      settings={settings}
      status={status}
      links={links}
      baseUrl={baseUrl}
      invoices={invoices}
      preview={preview}
      chargeableMonths={
        cb?.enabled && cb.billFromMonth
          ? closedMonthsWithoutInvoice(today, cb.billFromMonth, invoices.map((i) => i.periodMonth))
          : []
      }
      nextCharge={cb?.enabled ? nextChargeDate(today, cb.effective.anchorDay) : null}
      notice={one(sp.notice) ?? null}
      error={one(sp.error) ?? null}
      extra={{ outcome: one(sp.outcome), status: one(sp.status), ok: one(sp.ok) }}
    />
  );
}
```

- [ ] **Step 4: Billing summary on the client detail page**

In `components/console/ClientDetailView.tsx`, add the import `import Link from "next/link";` (already present) and extend the props:

```tsx
export interface ClientBillingSummary {
  statusLabel: string;
  cardLabel: string;
  nextCharge: string | null;
}

export function ClientDetailView({
  detail,
  billing = null,
}: {
  detail: ClientDetail;
  /** null when the billing feature is off. */
  billing?: ClientBillingSummary | null;
}) {
```

and, inside the right-hand column `<div className="overflow-hidden rounded-[16px] …">` for "Workspace details", after its closing `</div>` (still inside the grid's second column — wrap the column in a `<div className="flex flex-col gap-5">` so two cards stack), add:

```tsx
          {billing ? (
            <div className="overflow-hidden rounded-[16px] border border-ink/10 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-ink/10 bg-surface-tint px-5 py-3.5">
                <div className="font-display text-[14px] font-semibold">Billing</div>
                <Link href={`/console/billing/${client.id}`} className="font-display text-[12.5px] font-medium text-violet hover:underline">
                  Configure →
                </Link>
              </div>
              <div className="flex flex-col">
                <Detail label="Status" value={billing.statusLabel} />
                <Detail label="Card" value={billing.cardLabel} mono />
                <Detail label="Next charge" value={billing.nextCharge ?? "—"} mono />
              </div>
            </div>
          ) : null}
```

In `app/console/clients/[id]/page.tsx` compute it:

```tsx
import { notFound } from "next/navigation";
import { ClientDetailView, type ClientBillingSummary } from "@/components/console/ClientDetailView";
import { billingFeatureEnabled, getClientBilling } from "@/lib/billing/config";
import { listInvoices, tzOf } from "@/lib/billing/invoices";
import { cardLabel } from "@/lib/billing/notify";
import { localDate, nextChargeDate } from "@/lib/billing/schedule";
import { deriveStatus, STATUS_LABEL } from "@/lib/billing/status";
import { DEFAULT_TZ, parseRange, rangeToPeriod } from "@/lib/filters";
import { getClientDetail } from "@/lib/olivia/agency";
import { dayLabel } from "@/lib/usage";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const period = rangeToPeriod(parseRange("30d"), DEFAULT_TZ);
  const detail = await getClientDetail(id, period);
  if (!detail) notFound();

  let billing: ClientBillingSummary | null = null;
  if (billingFeatureEnabled()) {
    const [cb, invoices] = await Promise.all([getClientBilling(id), listInvoices(id)]);
    const status = deriveStatus({
      enabled: cb?.enabled ?? false,
      hasCard: Boolean(cb?.card),
      lastInvoiceStatus: invoices[0]?.status ?? null,
    });
    billing = {
      statusLabel: STATUS_LABEL[status],
      cardLabel: cardLabel(cb?.card ?? null),
      nextCharge: cb?.enabled
        ? dayLabel(nextChargeDate(localDate(new Date(), tzOf(detail.client.timezone)), cb.effective.anchorDay))
        : null,
    };
  }
  return <ClientDetailView detail={detail} billing={billing} />;
}
```

- [ ] **Step 5: Verify by hand**

As the admin: open `/console/billing/<id>` for "000. Emma Test Funnel", tick "Automatic billing on", save → status `No card`, bill-from month defaults to the current month, preview shows last month's raw → billed figures. Generate a link → it appears with a copy button. The client detail page shows the Billing card. Everything else (card capture, charging) is Task 19.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add app/console/billing "app/console/billing/[id]" components/console/BillingClientView.tsx components/console/ClientDetailView.tsx "app/console/clients/[id]/page.tsx"
git commit -m "feat(billing): console per-client billing — config, links, charge now, retry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 18: Sandbox livecheck script

**Files:**
- Create: `scripts/billing-livecheck.ts`

**Interfaces:**
- Consumes: `invoiceMonth` (Task 11), `ensureCustomer`, `setDefaultCard` (Task 9), `upsertClientBilling`, `loadClientBilling` (Task 6), `getStripe`, `stripeLivemode` (Task 1).

- [ ] **Step 1: Create `scripts/billing-livecheck.ts`**

```ts
/* Sandbox live check — NOT part of `npm run test:*` (needs network + credentials).
 *
 * Needs `.env` with STRIPE_SECRET_KEY=sk_test_… (the sandbox), the Supabase variables and
 * BILLING_ENABLED=true. Run:
 *
 *   RESEND_API_KEY= npm run billing:livecheck
 *
 * (a blank Resend key keeps the admin alert emails from going out; sends fail soft.)
 *
 * Exercises the REAL invoiceMonth path end to end against the Stripe sandbox: a throwaway
 * workspace row, Stripe's test cards, an injected usage figure. Asserts the money, the
 * never-twice rule, the never-$0 rule, and a decline. Cleans up every local row and the Stripe
 * customer; the sandbox invoices stay as history. Refuses to run against a live key.
 */
import assert from "node:assert/strict";
import { loadClientBilling, upsertClientBilling } from "../lib/billing/config";
import { ensureCustomer, setDefaultCard } from "../lib/billing/customers";
import { invoiceMonth } from "../lib/billing/invoices";
import { getStripe, stripeLivemode } from "../lib/stripe/client";
import { createAdminClient } from "../lib/supabase/admin";

(async () => {
  assert.equal(stripeLivemode(), false, "refusing to run the livecheck against a LIVE key");
  assert.equal(process.env.BILLING_ENABLED, "true", "BILLING_ENABLED=true is required");
  const admin = createAdminClient();
  const stripe = getStripe();
  const clientId = `livecheck-${Date.now()}`;
  let customerId: string | null = null;
  const openInvoices: string[] = [];

  try {
    // 1. A throwaway workspace row (the FK target) + billing config: 20% markup, $300 fee.
    const { error: insErr } = await admin
      .from("olivia_clients")
      .insert({ olivia_client_id: clientId, name: "Livecheck workspace", timezone: "UTC" });
    assert.equal(insErr, null, insErr?.message);
    await upsertClientBilling(
      clientId,
      { enabled: true, billFromMonth: "2026-01", markupBps: 2000, feeCents: 30000, anchorDay: 3 },
      null,
    );

    // 2. Customer + a working test card.
    customerId = await ensureCustomer(clientId);
    const visa = await stripe.paymentMethods.attach("pm_card_visa", { customer: customerId });
    const card = await setDefaultCard(clientId, visa.id);
    assert.equal(card.last4, "4242");
    assert.equal((await loadClientBilling(clientId))?.card?.paymentMethodId, visa.id);

    // 3. A month with usage: 67791 raw × 1.2 = 81349, + 30000 fee = 111349, paid synchronously.
    const jan = await invoiceMonth(clientId, "2026-01", "manual", { usage: async () => 67791 });
    console.log("jan:", jan.outcome, jan.status, jan.totalCents, jan.error ?? "");
    assert.equal(jan.outcome, "invoiced");
    assert.equal(jan.status, "paid");
    assert.equal(jan.totalCents, 111349);
    assert.ok(jan.hostedInvoiceUrl, "hosted invoice url recorded");
    const stripeJan = await stripe.invoices.retrieve(jan.stripeInvoiceId!);
    assert.equal(stripeJan.total, 111349, "Stripe's total equals ours");
    assert.equal(stripeJan.metadata?.emma_period, "2026-01");

    // 4. The same month again is refused — never billed twice.
    const again = await invoiceMonth(clientId, "2026-01", "manual", { usage: async () => 67791 });
    assert.equal(again.outcome, "already_invoiced");

    // 5. Usage unavailable: no row left behind, nothing charged.
    const feb = await invoiceMonth(clientId, "2026-02", "manual", { usage: async () => null });
    assert.equal(feb.outcome, "usage_unavailable");
    const { data: febRows } = await admin
      .from("billing_invoices")
      .select("id")
      .eq("olivia_client_id", clientId)
      .eq("period_month", "2026-02");
    assert.equal(febRows?.length ?? 0, 0, "an unavailable month must leave no row");

    // 6. Zero total: recorded as skipped, no Stripe invoice.
    await upsertClientBilling(clientId, { feeCents: 0 }, null);
    const mar = await invoiceMonth(clientId, "2026-03", "manual", { usage: async () => 0 });
    assert.equal(mar.outcome, "skipped_zero");
    assert.equal(mar.stripeInvoiceId, null);
    await upsertClientBilling(clientId, { feeCents: 30000 }, null);

    // 7. A declining card: invoiced, status failed with a decline code recorded.
    const declined = await stripe.paymentMethods.attach("pm_card_chargeDeclined", { customer: customerId });
    await setDefaultCard(clientId, declined.id);
    const apr = await invoiceMonth(clientId, "2026-04", "manual", { usage: async () => 1000 });
    console.log("apr:", apr.outcome, apr.status, apr.error ?? "");
    assert.equal(apr.outcome, "invoiced");
    assert.equal(apr.status, "failed");
    if (apr.stripeInvoiceId) openInvoices.push(apr.stripeInvoiceId);
    const { data: aprRow } = await admin
      .from("billing_invoices")
      .select("failure_code, failure_message")
      .eq("olivia_client_id", clientId)
      .eq("period_month", "2026-04")
      .maybeSingle();
    assert.ok(aprRow?.failure_code, "decline code recorded");
    console.log("decline:", aprRow?.failure_code, "—", aprRow?.failure_message);

    console.log("billing-livecheck: OK");
  } finally {
    for (const id of openInvoices) await stripe.invoices.voidInvoice(id).catch(() => undefined);
    await admin.from("billing_invoices").delete().eq("olivia_client_id", clientId);
    await admin.from("billing_setup_links").delete().eq("olivia_client_id", clientId);
    await admin.from("client_billing").delete().eq("olivia_client_id", clientId);
    await admin.from("olivia_clients").delete().eq("olivia_client_id", clientId);
    if (customerId) await stripe.customers.del(customerId).catch(() => undefined);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against the sandbox**

Run: `RESEND_API_KEY= npm run billing:livecheck`
Expected: the `jan:` line shows `invoiced paid 111349`, the `apr:` line shows `invoiced failed`, then `billing-livecheck: OK`. In the Stripe sandbox dashboard the Jan invoice shows two lines ("Emma usage · Jan 2026" $813.49, "Monthly fee · Jan 2026" $300.00) and status Paid.

If step 3 fails with a Stripe error about `pay`, read the message: the most likely causes are the sandbox having card payments disabled (enable in the sandbox's Settings → Payment methods) or a currency mismatch (the sandbox must accept USD charges — it does by default for an AU account).

- [ ] **Step 3: Commit**

```bash
git add scripts/billing-livecheck.ts
git commit -m "test(billing): sandbox livecheck for the invoice path

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 19: Manual end-to-end pass (sandbox) and documentation

**Files:**
- Modify: `DECISIONS.md` (new section), `README.md` (env list), `docs/superpowers/specs/2026-10-11-stripe-billing-design.md` (record the two deviations and the eighth template)

- [ ] **Step 1: Wire local webhooks**

Terminal A: `npm run dev`.
Terminal B:

```bash
stripe listen --api-key "$(grep ^STRIPE_SECRET_KEY .env | cut -d= -f2-)" --forward-to localhost:3000/api/stripe/webhook
```

Copy the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET` in `.env` and restart terminal A. (The Stripe CLI is installed, v1.53.1; `--api-key` targets the sandbox regardless of which account the CLI is logged into.)

- [ ] **Step 2: Walk the flow and tick each line**

Use the admin login and the member login from `.seed-credentials.txt`; use "000. Emma Test Funnel" as the client.

1. Admin: `/console/billing` → defaults markup `20`, fee `300`, anchor `3` → saved.
2. Admin: `/console/billing/<id>` → tick "Automatic billing on", bill-from = last month → saved; status `No card`; preview shows last month raw → +20% → +$300.
3. Admin: "Generate link" → copy the URL. Open it in a private window (logged out) → the setup card renders with the fee and the 3rd → "Add card with Stripe" → Stripe Checkout (sandbox) → card `4242 4242 4242 4242`, any future expiry, any CVC → return → "Card added · Visa ····4242".
4. Terminal B shows `checkout.session.completed` → 200. Admin page now shows the card; console emails "Card added" went to the admins (check the inbox if `RESEND_API_KEY` is set locally, otherwise the dev log shows the fail-soft error).
5. Member (`demo@heyemma.io`): the sidebar now shows "Billing"; `/dashboard/billing` shows the card, "Next charge" with this month's estimate and "Charged on 3 Nov …"; the Overview spend KPI is now 20% higher than the raw figure in the console's Usage report for the same window (open both to compare).
6. Admin: "Charge now" for last month → notice "Invoice created — paid"; the row shows usage/fee/total/Paid with a "View" link to the hosted invoice; the Stripe sandbox dashboard shows the two-line invoice.
7. Member: the invoice appears under Invoices with "Receipt". Click "Remove card" → notice; Terminal B shows `payment_method.detached` → 200 and the dev log shows no second "card removed" email (the in-app path emailed once).
8. Member: "Add card" → `4000 0000 0000 0341` (attaches, then declines) → card on file. Admin: "Charge now" for the month before last (set bill-from back one month first) → notice "payment failed"; the row shows `Payment failed` with the decline message; Terminal B shows `invoice.payment_failed` → 200 and the dev log shows ONE failed-payment email pair, not two (Review Focus 5).
9. Review Focus 5 again: `stripe events resend <evt_id of that invoice.payment_failed> --api-key …` → 200, no new email, status unchanged.
10. Admin: replace the card via the public link with `4242…` again, then "Retry" on the failed invoice → "Payment succeeded", status `Paid`.
11. Admin: `/console/billing` → "Run billing now" → notice; with every closed month already invoiced the counts are all zero.
12. `curl` the cron endpoint as in Task 13 Step 3 → `status: ok`.

- [ ] **Step 3: Record the decisions**

Append to `DECISIONS.md`:

```markdown
## Stripe billing (automatic monthly charging)

Design: `docs/superpowers/specs/2026-10-11-stripe-billing-design.md`; plan:
`docs/superpowers/plans/2026-10-11-stripe-billing.md`.

- **Own scheduler + Stripe Invoices + Checkout setup mode.** A daily cron (`/api/cron/billing`,
  03:00 UTC) computes due client-months (calendar month in the client's timezone, charged on the
  anchor day), reads usage through `getUsageSeries` (null is never $0) and creates an itemised
  Stripe Invoice charged to the card on file. Stripe Subscriptions were rejected (UTC-anchored
  cycles, 35-day meter backdating limit); bare PaymentIntents were rejected (no hosted invoice,
  receipts or retries).
- **USD only**; the Stripe account settles in AUD. **No tax line** in v1.
- **Markup applied once in the service layer** (`fetchOverview`, `fetchTimeseries`,
  `fetchLeadDetail`) after the cache, so every client-visible spend figure equals what is
  billed; console figures stay raw.
- **Billing-safety rules:** the (client, month) row is reserved before Stripe is called and is
  unique; every Stripe create carries an idempotency key built from the reservation id; the
  current month is never billed; a failed usage read skips, alerts and retries tomorrow.
- **Card removal notifies exactly once:** in-app removal emails directly (mirror cleared before
  the detach, so the webhook is silent); removal inside Stripe emails via the webhook.
- **`livemode` columns** tag every Stripe-linked row; a customer created under the other key
  mode is treated as absent, so sandbox state never leaks into live billing.
- **Env:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BILLING_ENABLED`, `CRON_SECRET`.
  Local + Preview run on the sandbox (`acct_1TZzk5GwOpbR9yqS`); Production on the live account
  (`acct_1TZzjsGqvtgNWUUX`, "Skilled Coaching").
- **Tests:** `npm run test:billing` (pure: money, schedule, status, templates);
  `npm run billing:livecheck` (sandbox, end-to-end invoice path).
```

In `README.md`, under "Required environment variables are documented in …", add one sentence: "Billing additionally needs `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BILLING_ENABLED` and `CRON_SECRET` (see `.env.example`)."

In the spec, under "Add / replace card" → "Remove card", replace the sentence beginning "The `payment_method.detached` webhook — which also fires…" with: "In-app removal clears the mirror before the detach and emails the admins itself, so the resulting webhook is silent; a removal made inside the Stripe dashboard still has the mirror set, so the webhook clears it and emails. Each removal notifies exactly once." Under "Data model", add to the `client_billing`, `billing_invoices` and `billing_setup_links` rows: "`livemode boolean` — the key mode the row was written under." Under "Emails", add the `billingNoCard` row: "`billingNoCard` | admins | A due month skipped for no card (once per month)."

- [ ] **Step 4: Full verification and commit**

Run: `npx tsc --noEmit && npm run lint && npm run test:billing && npm run test:usage && npm run build`
Expected: all clean; the build lists the new routes (`/billing/setup/[token]`, `/dashboard/billing`, `/console/billing`, `/console/billing/[id]`, `/api/stripe/webhook`, `/api/cron/billing`).

```bash
git add DECISIONS.md README.md docs/superpowers/specs/2026-10-11-stripe-billing-design.md
git commit -m "docs(billing): record decisions, env and the two spec deviations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Then merge per the repo's shipping workflow (`git checkout master && git merge --no-ff feat/stripe-billing && git push origin master`) **only when the user says to ship**: pushing master auto-deploys production. Production keeps `BILLING_ENABLED` unset, so the deploy is inert until Task 20.

---

### Task 20: Go-live runbook (execute only on the user's explicit go)

Nothing here runs during implementation. It is the ordered checklist for the day billing goes live, kept with the plan so it is not reinvented.

- [ ] **Step 0: Reset sandbox state in the shared database**

Preview/local (sandbox key) and Production share one Supabase project, so everything the sandbox walkthrough and the livecheck wrote is still there. Before switching Production to the live key, run this once in the Supabase SQL editor (one transaction; it only touches sandbox-tagged rows and the livecheck fixtures):

```sql
begin;

-- 1. Sandbox-only history: invoices, setup links, webhook idempotency rows, run summaries.
delete from public.billing_invoices    where livemode = false;
delete from public.billing_setup_links where livemode = false;
delete from public.billing_events      where livemode = false;
delete from public.billing_runs        where livemode = false;

-- 2. Unlink every sandbox Stripe customer/card and switch those clients off. They are re-enabled
--    deliberately (with a chosen bill-from month) once live, and get a fresh live customer then.
update public.client_billing
set stripe_customer_id        = null,
    stripe_livemode           = null,
    default_payment_method_id = null,
    card_brand                = null,
    card_last4                = null,
    card_exp_month            = null,
    card_exp_year             = null,
    card_added_at             = null,
    no_card_alerted_month     = null,
    enabled                   = false,
    updated_at                = now()
where stripe_livemode = false;

-- 3. Livecheck fixtures (billing rows first: client_billing references olivia_clients).
delete from public.billing_invoices    where olivia_client_id like 'livecheck-%';
delete from public.billing_setup_links where olivia_client_id like 'livecheck-%';
delete from public.client_billing      where olivia_client_id like 'livecheck-%';
delete from public.olivia_clients      where olivia_client_id like 'livecheck-%';

-- 4. Platform defaults: confirm these are the intended LIVE defaults (the walkthrough left
--    20% markup / $300 fee / day 3). Change them in /console/billing if not.
select markup_bps, fee_cents, anchor_day, currency, alert_email from public.billing_settings where id = 1;

-- 5. Verify nothing sandbox-tagged is left (all zeros), then commit.
select
  (select count(*) from public.billing_invoices    where livemode = false) as invoices,
  (select count(*) from public.billing_setup_links where livemode = false) as links,
  (select count(*) from public.billing_events      where livemode = false) as events,
  (select count(*) from public.billing_runs        where livemode = false) as runs,
  (select count(*) from public.client_billing      where stripe_livemode = false) as clients,
  (select count(*) from public.olivia_clients      where olivia_client_id like 'livecheck-%') as livecheck;

commit;
```

**Note — Preview after go-live:** Preview (sandbox key) and Production share this Supabase project. After go-live, Preview must either keep `BILLING_ENABLED` off, or point at its own database. Otherwise a sandbox card setup on Preview can collide with live client rows (the code refuses to replace a card held under the other mode, and listings filter by mode, but sandbox runs would still write rows and send emails against real clients).

- [ ] **Step 1: Vercel environment**

Production: `STRIPE_SECRET_KEY` = the LIVE secret key (`sk_live_…`, from the live account's Developers → API keys), `BILLING_ENABLED=true`, `CRON_SECRET` = a fresh random value (`openssl rand -base64 24`). Preview: `STRIPE_SECRET_KEY` = the sandbox key, its own `CRON_SECRET`, and `BILLING_ENABLED` left unset unless Preview has its own database (see the note in Step 0). Set them in the Vercel dashboard (Project → Settings → Environment Variables) or with `vercel env add <NAME> production`.

- [ ] **Step 2: Live webhook endpoint**

Create it on the LIVE account pointing at `https://app.heyemma.io/api/stripe/webhook` with exactly these events: `checkout.session.completed`, `payment_method.detached`, `payment_method.automatically_updated`, `customer.updated`, `customer.deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `invoice.finalization_failed`, `invoice.voided`, `invoice.marked_uncollectible`. Either in the Stripe dashboard (Developers → Webhooks → Add destination) or, after re-authorising the live account in the Stripe MCP (`/mcp`), with `stripe_api_write` → `PostWebhookEndpoints` (`livemode: true`, `url`, `enabled_events`). Copy its signing secret into Production `STRIPE_WEBHOOK_SECRET`. Repeat for Preview on the sandbox with the preview URL.

- [ ] **Step 3: Stripe dashboard settings (live account)**

Revenue recovery → Smart Retries on. Settings → Emails → "Successful payments" receipts on, and "Send emails when card payments fail" on. Confirm the public business name and statement descriptor are what clients should see ("Skilled Coaching", `SKILLEDCOACHING.COM` plus our `HEY EMMA` suffix).

- [ ] **Step 4: Deploy and smoke**

Push master (or redeploy) so the variables apply. `curl -H "Authorization: Bearer <prod CRON_SECRET>" https://app.heyemma.io/api/cron/billing` → `status: ok` with empty results. `/console/billing` shows no "Stripe sandbox" badge.

- [ ] **Step 5: First real client**

Enable the internal test workspace with a $1 fee and a real card for one cycle (or "Charge now" for last month). Confirm the invoice, the receipt email and the Stripe payout line. Then enable real clients one at a time, bill-from the current month, and compare each first invoice against the Usage report (usage line = report figure × multiplier, to the cent).

- [ ] **Step 6: Memory**

Update the memory note `stripe-billing-feature.md` with the go-live date, the live webhook endpoint id and anything that surprised you.
