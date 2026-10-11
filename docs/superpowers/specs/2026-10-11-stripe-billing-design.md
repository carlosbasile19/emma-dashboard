# Stripe billing — Design

**Date:** 2026-10-11
**Status:** Design approved in conversation → spec for review → implementation plan
**Routes:** `/console/billing`, `/console/billing/[id]` (admin) · `/dashboard/billing` (client) ·
`/billing/setup/[token]` (public, token-gated) · `/api/stripe/webhook` · `/api/cron/billing`

## Summary

The agency invoices each client by hand from the console's Usage report. This adds automatic
monthly charging: a client saves a card with Stripe, and every month Stripe charges it for the
previous calendar month's Emma usage (optionally marked up) plus a flat monthly fee. The money
lands in the agency's Stripe account.

Platform admins configure it per client in the console (enable, fee, markup, anchor day, billing
email), can generate a link that lets a client add a card without logging in, and are emailed
when a card is added or removed and when a payment fails. Clients see a Billing page in their
dashboard with the card on file, this month's estimate, and invoice history. Every spend figure a
client sees in the dashboard carries the markup, so the dashboard and the invoice always agree.

## Decisions made with the user (do not re-litigate)

| Question | Decision |
|---|---|
| Currency | **USD.** Matches Emma's usage figures 1:1; Stripe converts to AUD at payout. No exchange rate to maintain. |
| What the anchor date means | **Calendar month, charged on the anchor day.** Each invoice covers the previous full calendar month in the client's own timezone (the same figure as the Usage report). The anchor day (1–28, default 3) is only the local date the card is charged. |
| Where the markup applies | **Everywhere a client sees spend.** One multiplier on the overview spend KPI (and its sparkline/delta), the nutshell sentence and lead-detail total spend. Never itemised to the client. The console keeps raw cost and shows billed beside it. |
| Tax | **No tax line in v1.** Amounts are charged exactly as configured. |
| Charging mechanism | **Stripe Invoices** (itemised usage + fee), `charge_automatically`, paid immediately on finalisation, Stripe's automatic collection retries afterwards. |
| Card capture | **Stripe Checkout in setup mode.** No card data and no Stripe.js in this app; no publishable key needed. |

## Why this shape (binding constraints)

- **The Stripe account is Australian and settles in AUD.** Live account `acct_1TZzjsGqvtgNWUUX`
  ("Boomalex Pty Ltd ATF the Skilled Coaching Trust", public name "Skilled Coaching", country AU,
  default currency AUD, charges + payouts enabled, Emma brand colours and logo already set,
  statement descriptor `SKILLEDCOACHING.COM`). As of 2026-10-11 it has **zero customers and zero
  webhook endpoints** — nothing to migrate or collide with. Hosted Stripe pages show "Skilled
  Coaching", which matches the "Powered by Skilled Coaching" brand tagline.
- **A sandbox exists for development.** `acct_1TZzk5GwOpbR9yqS` ("Skilled Coaching sandbox",
  `livemode: false`). Everything is built and verified against the sandbox; live keys are set in
  Vercel Production only when the user says go.
- **Usage already has one correct source.** `getUsageSeries()` (`lib/olivia/usage.ts`) returns a
  client's daily billed spend (`basis: "billed_voice"`, USD) bucketed on the client's own
  timezone, padded, chunked, clipped, and **`null` on any failure — never a zero-filled stand-in**.
  Billing reads through this seam, so the invoice equals the Usage report by construction.
- **Stripe does not model "calendar month in the client's timezone".** Subscriptions anchor to a
  UTC timestamp and meter events cannot be backdated beyond 35 days, so Stripe Subscriptions with
  usage meters were rejected. We own the schedule; Stripe owns the invoice, the payment, the
  receipt and the retries.
- **Off-session charging needs a mandate.** Card-network rules require the customer's agreement
  to be charged while not present (frequency, how the amount is determined, how to cancel). The
  mandate text is shown on our page before Checkout and inside Checkout, and the Checkout
  SetupIntent is created with `usage: off_session` (Checkout setup mode's default).
- **Patterns already in the repo cover the plumbing:** token-gated public page (`/invite`),
  branded Resend emails (`lib/email/*`), admin server actions (`app/console/actions.ts`), a
  fail-closed Vercel cron (`app/api/cron/snapshot`), service-role-only tables with RLS deny-all
  (`invites`), and `cachedFetch` with `force` for a fresh upstream read.

## Money model

All amounts are **integer cents**. No float arithmetic anywhere on the money path.

- `markup_bps` is an integer in basis points (`2000` = 20%). Allowed range 0–30000.
- `billedUsageCents = Math.round(rawUsageCents * (10000 + markup_bps) / 10000)`, computed **once
  on the month's raw total** (the sum of that month's daily `spend_cents`).
- `fee_cents` is a flat integer ≥ 0, charged in full every invoiced month, **never prorated**.
- `totalCents = billedUsageCents + fee_cents`. Currency `usd`.
- A month whose total is 0 is recorded as `skipped_zero` and no Stripe invoice is created.
- **Dashboard markup** uses the same function per figure: overview `kpis.spend.total_cents`
  (current and previous period), each `timeseries.series[].spend_cents`, and lead-detail
  `summary.total_spend_cents`. It is applied in `lib/olivia/service.ts` **after `cachedFetch`
  returns**, so `response_cache` rows stay raw and a markup change takes effect immediately.
- **Surface rule, not role rule:** the client dashboard (`/dashboard/*`) shows marked-up spend to
  everyone who opens it, admins included ("open workspace" shows what the client sees). The
  console shows raw figures, with billed figures beside them on the billing pages.
- The markup applies only while billing is **enabled** for that client. Disabled → multiplier 1.
- **Reconciliation invariant:** for any closed month, the Usage report's figure for a client,
  multiplied by that client's multiplier and rounded, equals the usage line on that month's
  invoice. The per-client console page shows this computation explicitly.

## Billing period and due logic (pure, timezone-aware)

- `tz = billingTz(client)` (the client's own timezone; `UTC` only when upstream has none).
- `d` = today's date in `tz`. `prev` = the calendar month before `d`'s month.
- Candidate months = every `YYYY-MM` from the client's `bill_from_month` through `prev`.
- A candidate month `M` is **due** when it has no `billing_invoices` row and either
  `M < prev` (catch-up months are always due — their settle window has passed) or
  `M == prev` and `d.day >= anchor_day`.
- The current month is never invoiced. A manual "Charge now" may target any closed month with no
  row, ignoring the anchor day.
- Due months are processed **oldest first**, one invoice each.
- **Next charge date** (console and dashboard) = the first local date on or after today whose
  day-of-month equals the anchor day.
- **Dashboard estimate** = this month's usage so far (`getUsageSeries` from the 1st of the current
  local month through today, normal cache, not forced) with the markup applied, plus the fee.
- **Defaults on first configure:** `bill_from_month` = the current month in the client's timezone
  (so the first invoice covers the month billing was switched on in); `billing_email` = the
  workspace's earliest-mapped member email, if any. Admins enter the markup as a percentage with
  up to two decimals (stored as basis points) and the fee in dollars (stored as cents).
- The cron runs once a day at 03:00 UTC. With one run per day, "charged on the anchor day" holds
  for every timezone (a US client is charged on the evening of its anchor day; an Australian client
  in the afternoon). `bill_from_month` is how an admin controls when charging starts and whether
  earlier months are swept up.

## Data model

New migration `supabase/migrations/20261011000007_emma_billing.sql`. All tables: RLS enabled, **no
policies** (service-role only), matching `invites`.

| Table | Columns (type) | Notes |
|---|---|---|
| `billing_settings` | `id int pk check (id = 1)`, `markup_bps int not null default 0`, `fee_cents int not null default 0`, `anchor_day int not null default 3 check 1..28`, `currency text not null default 'usd'`, `alert_email text`, `updated_at`, `updated_by uuid` | Single row of platform defaults. Seeded by the migration. |
| `client_billing` | `olivia_client_id text pk`, `enabled bool not null default false`, `stripe_customer_id text unique`, `billing_email text`, `bill_from_month text` (`YYYY-MM`), `markup_bps int`, `fee_cents int`, `anchor_day int` (each null = use default), `default_payment_method_id text`, `card_brand text`, `card_last4 text`, `card_exp_month int`, `card_exp_year int`, `card_added_at`, `card_removed_at`, `no_card_alerted_month text`, `created_at`, `updated_at`, `updated_by uuid`, `livemode boolean` — the key mode the row was written under. | One row per workspace, created on first configure. Card columns are a **mirror** of Stripe kept current by the return page and webhooks; Stripe stays the source of truth. |
| `billing_invoices` | `id uuid pk`, `olivia_client_id text not null`, `period_month text not null`, `period_from date`, `period_to date`, `tz text`, `raw_usage_cents int`, `markup_bps int`, `billed_usage_cents int`, `fee_cents int`, `total_cents int`, `currency text`, `stripe_invoice_id text unique`, `hosted_invoice_url text`, `invoice_pdf_url text`, `status text not null`, `failure_code text`, `failure_message text`, `trigger text` (`cron`/`manual`), `created_by uuid`, `created_at`, `finalized_at`, `paid_at`, `updated_at`, `livemode boolean` — the key mode the row was written under.; **unique (`olivia_client_id`, `period_month`)** | The unique pair is the idempotency guard: a month can never be invoiced twice. Statuses: `reserved`, `open`, `paid`, `failed`, `action_required`, `void`, `uncollectible`, `skipped_zero`. |
| `billing_setup_links` | `id uuid pk`, `token text unique`, `olivia_client_id text not null`, `created_by uuid`, `sent_to text`, `created_at`, `expires_at`, `status text` (`pending`/`completed`/`revoked`), `completed_at`, `livemode boolean` — the key mode the row was written under. | Same shape as `invites`. 32 random bytes, base64url. 7-day TTL. Reusable until completed, so a cancelled Checkout can be retried from the same link. |
| `billing_events` | `stripe_event_id text pk`, `type text`, `received_at`, `processed_at`, `error text` | Webhook idempotency. A row with `processed_at` set is a no-op on redelivery; a row without it is reprocessed. |
| `billing_runs` | `id uuid pk`, `trigger text`, `started_at`, `finished_at`, `summary jsonb` | One row per cron/manual run: invoiced, skipped, failed, per client. Drives "Last run" in the console. |

`client_billing.olivia_client_id` references `olivia_clients` (the mirror is upserted, never
deleted, so the FK is safe).

## Stripe objects and flows

SDK: `stripe` (npm, v23), server-only singleton in `lib/stripe/client.ts`, API version pinned to
the SDK's bundled version. Every create call carries an idempotency key.

**Customer.** One Stripe Customer per workspace, created the first time an admin enables billing
or generates a setup link, or a member clicks "Add card": `name` = client name, `email` =
billing email, `metadata.emma_client_id`. Idempotency key `emma:cus:<clientId>`. The id is stored
in `client_billing.stripe_customer_id`. If Stripe reports the customer deleted, the id and card
mirror are cleared and the next enable recreates it.

**Add / replace card.** Server action creates a Checkout Session: `mode: "setup"`, `customer`,
`currency: "usd"`, `payment_method_types: ["card"]`, `custom_text.submit.message` = mandate,
`metadata` = `{ emma_client_id, emma_setup_token?, emma_origin: "dashboard" | "link" }`,
`success_url` carrying `{CHECKOUT_SESSION_ID}`, `cancel_url` back to the originating page. The
browser is redirected to Stripe. On return, the page **reconciles synchronously**: retrieve the
session, require `status === "complete"` and `session.customer === the client's customer id`
(tenant guard), read `setup_intent.payment_method`, set it as
`customer.invoice_settings.default_payment_method`, **detach every other card** on the customer
(one card on file, so "remove" always means "no card"), mirror brand/last4/expiry locally, and
mark the setup link completed when one was used. `checkout.session.completed` runs the same
reconcile asynchronously, so a closed browser tab is still handled. Both paths are idempotent.

**Remove card.** Member (dashboard) or admin (console) → `paymentMethods.detach`, mirror
cleared, `card_removed_at` set. In-app removal clears the mirror before the detach and emails the admins itself, so the resulting webhook is silent; a removal made inside the Stripe dashboard still has the mirror set, so the webhook clears it and emails. Each removal notifies exactly once.

**Setup link.** Admin generates it from `/console/billing/[id]`: inserts a `billing_setup_links`
row, shows the URL with a copy button, and optionally emails it (branded template, fail-soft like
invites). The public page `/billing/setup/[token]` validates the token (pending, unexpired), shows
the client name, the monthly fee and the charge day (the markup is never shown), the mandate, and
a single "Add card" button. Only the button creates a Checkout Session (a page view never does, so
crawlers cannot mint sessions). Return lands on the same page with `session_id`, which reconciles
and shows "Card added". `/billing/setup` joins `PUBLIC_PATHS` in `lib/supabase/middleware.ts`.

**Monthly run** (`lib/billing/invoices.ts`, `invoiceMonth(clientId, month, trigger)`):

1. Load config; require `enabled` and a default payment method, else record `skipped` in the run
   summary (no row — it will be re-evaluated next run). A "no card" skip emails the admins **once
   per due month** (`client_billing.no_card_alerted_month` records which month was alerted), not
   every day.
2. **Reserve** the row: insert `billing_invoices` with `status: "reserved"`. A unique-violation
   means the month is already handled → stop. A stale `reserved` row (older than one hour, from a
   crashed run) is reconciled first by searching Stripe invoices for
   `metadata.emma_client_id` + `metadata.emma_period`; an existing invoice is adopted, otherwise
   the reservation is deleted and recreated.
3. Fetch usage: `getUsageSeries(clientId, tz, monthFrom, monthTo, { fresh: true })` — a forced
   upstream read through `cachedFetch` (stale same-window rows remain acceptable on error; a
   different window is rejected by `seriesMatchesWindow`). `null` → delete the reservation, log
   `usage_unavailable`, email admins, retry next run. **Never $0.**
4. Compute the lines. Total 0 → row becomes `skipped_zero`, done.
5. Stripe: `invoices.create` (`collection_method: "charge_automatically"`, `auto_advance: true`,
   `currency: "usd"`, `pending_invoice_items_behavior: "exclude"`, `description: "Emma · <Month YYYY>"`,
   `statement_descriptor: "HEY EMMA"`, `metadata: { emma_client_id, emma_period }`); then one
   `invoiceItems.create` per non-zero line with `invoice: <id>` ("Emma usage · Sep 2026",
   "Monthly fee · Sep 2026"); then `invoices.finalizeInvoice`; then `invoices.pay` for a
   synchronous outcome. Idempotency keys `emma:inv:<clientId>:<month>[:usage|:fee|:finalize|:pay]`.
6. Record ids, hosted URL, PDF URL and status: `paid` on success; `failed` with the decline
   code/message on a card error (Stripe's automatic collection keeps retrying under
   `auto_advance`); `action_required` when the issuer demands authentication.

The run itself (`runBilling(trigger, scope?)`) iterates enabled clients sequentially, computes due
months, invoices each oldest-first, writes a `billing_runs` row, and emails admins a summary on
any day that invoiced or failed (no-card skips are listed in that summary and on the console, and
alerted once per due month as above).

**Retry / Charge now (console).** "Retry charge" calls `invoices.pay` on a `failed` invoice (a
new card must be on file first; the button says so). "Charge now" runs `invoiceMonth` for a chosen
closed month with no row, trigger `manual`. "Run billing now" runs the whole daily job on demand.

## Webhooks

`POST /api/stripe/webhook` (route handler; `api` is already outside the middleware matcher).
Raw body via `req.text()`, signature verified with `stripe.webhooks.constructEvent` and
`STRIPE_WEBHOOK_SECRET`. Insert into `billing_events` first; already-processed → `200` no-op.
Handler failure → `500` so Stripe redelivers. Only objects carrying `metadata.emma_client_id`
(or an invoice with `metadata.emma_period`) are acted on; anything else is acknowledged.

| Event | Action |
|---|---|
| `checkout.session.completed` (mode `setup`) | Reconcile the card (same function as the return page); mark the setup link completed; email admins "card added". |
| `payment_method.detached` | If it was the mirrored default: clear the mirror, set `card_removed_at`, email admins "card removed". |
| `payment_method.automatically_updated` | Refresh the mirrored expiry/last4. |
| `customer.updated` | If `invoice_settings.default_payment_method` changed: re-mirror from Stripe (null clears the mirror). Never emails — removal emails come only from `payment_method.detached` and `customer.deleted`, so a removal notifies exactly once. |
| `customer.deleted` | Clear customer id and mirror; email admins. |
| `invoice.paid` | Row → `paid`, `paid_at`, URLs. |
| `invoice.payment_failed` | Row → `failed` with code/message; email admins; email the client with a fresh setup link. |
| `invoice.payment_action_required` | Row → `action_required`; email the client the hosted invoice URL (where they can authenticate); email admins. |
| `invoice.finalization_failed` | Row → `failed` with the finalization error; email admins. |
| `invoice.voided` / `invoice.marked_uncollectible` | Row → `void` / `uncollectible` (done from the Stripe dashboard; status syncs back). |

Webhook endpoints: one on the sandbox (local Stripe CLI forwarding during development, then the
preview URL) and one on the live account pointing at `https://app.heyemma.io/api/stripe/webhook`,
created at go-live. Each has its own signing secret.

## Surfaces

### Console (admin, `requireAdmin()` on every page, action and route)

- **`/console/billing`** — nav "Billing" in the Agency group. The existing "Usage & billing" entry
  is renamed **"Usage report"** so the two are not confused. Contents: the platform defaults form
  (markup %, monthly fee, anchor day, alert email), a status strip (last run and outcome, next
  run, counts of active / no card / payment failed), and a clients table: client, status badge
  (`Off` · `No card` · `Active` · `Payment failed` · `Action required`), card (brand ···last4,
  expiry), fee, markup, anchor, next charge date, last invoice (month, total, status, link),
  "Configure". "Run billing now" with a confirm.
- **`/console/billing/[id]`** — per-client: enable toggle, billing email, bill-from month, fee /
  markup / anchor overrides (blank = default, the effective value is shown beside each), card on
  file with "Remove card", setup links (generate, copy, email, revoke; pending list), the
  last-closed-month preview ("Sep 2026: $677.91 usage → $813.49 billed + $300.00 fee =
  $1,113.49"), invoice history for this client with "View invoice", "Retry charge" on failed rows,
  and "Charge now" with a picker of closed months that have no row.
- **`/console/clients/[id]`** gains a Billing summary card (status, card, next charge, link to
  configure).

### Dashboard (client)

- **`/dashboard/billing`** — new nav group **Account** with one item, "Billing", added to
  `NAV_ITEMS` / `NAV_GROUPS` / `SCREEN_TITLES` in `lib/design.ts`. The sidebar shows it only when
  billing is enabled for the active workspace (`app/dashboard/layout.tsx` resolves the flag and
  passes it to `Sidebar`). The header hides the range/campaign controls on this route, as it does
  for the board routes. The page is reachable only via the session's active client; a disabled
  workspace renders "Billing isn't set up for this workspace".
- Contents: **Payment method** (brand ···last4, expiry, "Replace card" / "Remove card", or "No
  card on file" + "Add card", with the mandate beneath); **Next charge** (this month's usage so far
  with markup applied, plus the fee, labelled an estimate, and "charged on the <anchor> of <next
  month>"); **Invoices** (period, usage, fee, total, status, "View invoice" → hosted invoice,
  "Receipt" when paid); **Billing contact** (editable email; also updates the Stripe customer so
  Stripe's receipts go there).
- Any member of the workspace may manage the card and the billing email. There is one client
  role today; no new role is introduced.

### Public

- **`/billing/setup/[token]`** — described under Setup link above. Branded like `/invite/[token]`.

### Emails (Resend, `renderShell`, fail-soft)

| Template | To | When |
|---|---|---|
| `billingSetupLink` | client billing email | Admin clicks "Email link". |
| `billingCardAdded` | admins | Card reconciled (first add or replacement). |
| `billingCardRemoved` | admins | `payment_method.detached` of the default card, or customer deleted. |
| `billingPaymentFailedAdmin` | admins | `invoice.payment_failed` / `payment_action_required` / finalization failed. |
| `billingPaymentFailedClient` | client billing email | Same events; carries a fresh setup link (or the hosted invoice URL for action required). |
| `billingNoCard` | admins | A due month skipped for no card (once per month). |
| `billingUsageUnavailable` | admins | A due month could not be computed; will retry tomorrow. |
| `billingRunSummary` | admins | Any run that invoiced or failed. |

"Admins" = every `platform_admin` email (`listAgencyTeam`) plus `billing_settings.alert_email`
when set. Receipts for successful payments come from Stripe's own customer emails.

## Security and safety rules

- Tenant identity never comes from the browser: console actions take a client id and re-verify it
  against `olivia_clients` under `requireAdmin()`; member actions use `getSessionClientId()`; the
  Checkout return page checks `session.customer` against the client's stored customer id.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are server-only. No `NEXT_PUBLIC_` Stripe
  variable exists. No card data is ever posted to this app.
- Feature flag `BILLING_ENABLED` (default off): the cron no-ops, the billing routes 404, the
  markup is not applied. When on, `CRON_SECRET` is mandatory and the cron fails closed (the
  `snapshot` pattern).
- Money: integer cents; markup applied once; a failed usage read is `null` and skips, never
  bills $0; the current month is never billed; a month is unique per client; every Stripe create
  carries an idempotency key; the local row is reserved before Stripe is called.
- Webhooks: signature-verified, idempotent by event id, metadata-scoped, `500` on failure so
  Stripe retries.
- Tokens: 32 random bytes, single purpose, expiring, revocable; a page view creates nothing.
- Branding: user-facing copy says Emma / Hey Emma, never the upstream vendor.

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | local + Preview: sandbox `sk_test_…`; Production: live `sk_live_…` | SDK auth. |
| `STRIPE_WEBHOOK_SECRET` | per endpoint (CLI/preview secret locally and on Preview; live secret on Production) | Signature verification. |
| `BILLING_ENABLED` | `true` to turn the feature on | Feature flag. |
| `CRON_SECRET` | already documented; required when billing is on | Cron auth. |

`vercel.json` gains `{ "path": "/api/cron/billing", "schedule": "0 3 * * *" }`.

Stripe dashboard settings at go-live (not code): Smart Retries on (Revenue recovery), email
customers on successful payments (receipts), send emails when card payments fail. Branding is
already configured on the live account.

## Components

| File | Role |
|---|---|
| `supabase/migrations/20261011000007_emma_billing.sql` | The six tables above, RLS deny-all, defaults row. |
| `lib/billing/money.ts` | Pure. `applyMarkup`, `composeInvoice`, validation of bps / cents / anchor / month. |
| `lib/billing/schedule.ts` | Pure. Local date in a timezone, previous month, candidate months, `dueMonths`. |
| `lib/billing/status.ts` | Pure. Client status badge derivation; webhook event → row/mirror transitions as data. |
| `lib/billing/copy.ts` | Mandate text and user-facing billing copy. |
| `lib/billing/config.ts` | Server. Settings + per-client config with effective values; per-request `cache()`; multiplier for the active client. |
| `lib/billing/customers.ts` | Server. `ensureCustomer`, card reconcile, replace/remove, mirror refresh. |
| `lib/billing/setup.ts` | Server. Setup links, Checkout session creation, return reconcile. |
| `lib/billing/invoices.ts` | Server. `invoiceMonth`, `runBilling`, retry, reservation reconcile. |
| `lib/billing/webhooks.ts` | Server. Event dispatch using `status.ts` transitions. |
| `lib/billing/notify.ts` | Server. Recipient resolution + the seven sends. |
| `lib/stripe/client.ts` | Server-only SDK singleton. |
| `app/api/stripe/webhook/route.ts` | Endpoint. |
| `app/api/cron/billing/route.ts` | Daily job entrypoint (flag + secret, then `runBilling("cron")`). |
| `app/console/billing/page.tsx`, `app/console/billing/[id]/page.tsx`, `app/console/billing/actions.ts`, `loading.tsx` ×2 | Console pages + actions (save defaults, save client, generate/email/revoke link, remove card, charge now, retry, run now). |
| `components/console/BillingOverview.tsx`, `components/console/BillingClientView.tsx` | Console presentation. |
| `app/dashboard/billing/page.tsx`, `app/dashboard/billing/actions.ts`, `loading.tsx`, `components/dashboard/billing/BillingView.tsx` | Client page + actions (start Checkout, remove card, save billing email). |
| `app/billing/setup/[token]/page.tsx`, `app/billing/setup/actions.ts`, `components/billing/SetupCard.tsx` | Public setup page. |
| `lib/email/templates.ts` | + seven templates. |
| `lib/olivia/service.ts` | Markup applied in `fetchOverview`, `fetchTimeseries`, `fetchLeadDetail`. |
| `lib/olivia/usage.ts` | `getUsageSeries` gains `{ fresh }` → `cachedFetch` `force`. |
| `lib/design.ts`, `components/dashboard/Sidebar.tsx`, `components/dashboard/Header.tsx`, `app/dashboard/layout.tsx` | Nav item, conditional visibility, title, hidden filters. |
| `components/console/ConsoleSidebar.tsx`, `components/console/ClientDetailView.tsx` | Nav entries + billing summary card. |
| `lib/supabase/middleware.ts` | `/billing/setup` public. |
| `vercel.json`, `.env.example`, `package.json` | Cron, variables, `stripe` dependency and test scripts. |
| `scripts/billing-selftest.ts`, `scripts/billing-livecheck.ts` | Tests (below). |

## Testing

**Pure (`npm run test:billing`, `node:assert`, offline):**

- Markup: `0 bps` is identity; `2000 bps` on `67791` → `81349`; rounding is half-up on the sum,
  never per day; `-1` bps and `30001` bps are rejected.
- Invoice composition: usage-only, fee-only, both, and zero → `skipped_zero`; integer outputs.
- Due logic: a Brisbane client on the 3rd of the month with anchor 3 owes last month; on the 2nd
  owes nothing; with `bill_from` three months back owes three months oldest-first regardless of
  anchor; an existing row removes a month; the current month is never due; the local date is
  taken in the client's timezone (a UTC date that is already tomorrow in Sydney).
- Status derivation for every combination of enabled / card / last invoice state.
- Webhook transitions: fixture events for each handled type produce the expected row/mirror
  change; a non-Emma object produces none; a repeated event id is a no-op.
- Setup links: pending + unexpired is valid; expired, revoked and completed are not.

**Sandbox livecheck (`scripts/billing-livecheck.ts`, needs `STRIPE_SECRET_KEY` test key, not part
of `npm run test:*`):** create a customer, attach the `pm_card_visa` test payment method and set
it default, run `invoiceMonth` with an injected usage provider (raw 67791, 2000 bps, fee 30000 →
total 111349) and assert `paid`; repeat with `pm_card_chargeDeclined` and assert `failed` with a
decline code; delete the customer.

**Manual pass before go-live (sandbox keys on a preview deploy, Stripe CLI forwarding locally):**
admin enables a client → generates a link → opens it logged-out → adds `4242…` → console shows
the card → "Charge now" for last month → invoice paid in the sandbox dashboard → client Billing
page shows the invoice → remove the card → admin email arrives → replace with `4000 0000 0000
0341` (attaches, declines) → "Charge now" → failed email to admin and client.

## Rollout

1. Build and verify entirely against the sandbox (`BILLING_ENABLED=true` locally and on Preview
   with `sk_test_…`). Production keeps the flag off until go-live.
2. Go-live: set `STRIPE_SECRET_KEY` (live) and `STRIPE_WEBHOOK_SECRET` (live endpoint) on
   Production, create the live webhook endpoint, flip `BILLING_ENABLED`, confirm the dashboard
   settings above.
3. Enable the internal test workspace first with a small fee and a real card for one cycle, then
   real clients one at a time, checking each first invoice against the Usage report.

## Out of scope (v1)

GST or any tax line; AUD or per-client currency; fee proration; refunds and credit notes (done in
Stripe; status syncs back); pausing Emma for non-payment; more than one card on file; Stripe's
customer portal; a usage breakdown beyond the single billed-voice line.

## Known gaps carried forward

- The upstream voice briefing/reporting bridges, when they go live, speak figures from the vendor
  backend and may quote raw spend. The local previews use the dashboard's marked-up data.
- Whether billed voice is the vendor's whole "AI Power" charge is still unconfirmed (see the Usage
  report spec); if it is not, the agency endpoint becomes the usage basis and nothing above the
  `getUsageSeries` seam changes.

## Naming

User-facing copy says **Emma** / **Hey Emma** and never the upstream vendor. Internal identifiers
(`lib/olivia/*`, `olivia_clients`) are unchanged. Stripe-hosted pages carry the Stripe account's
public name, "Skilled Coaching".
