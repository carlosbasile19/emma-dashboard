# Usage & billing report — Design

**Date:** 2026-08-01
**Status:** Approved design → ready for implementation plan
**Route:** `/console/usage` ("Usage & billing", Agency nav — admin only)

## Summary

The agency invoices its clients on **calendar months (1st → end of month)**. The upstream
vendor dashboard reports usage on a **15th → 14th** cycle, so every month is reconciled by hand
across two different windows.

This adds a Console page that reports **per-client billed usage for any date range** (with
calendar-month quick-picks), **exports to CSV**, and shows **every month back to when each
workspace opened** so already-billed periods can be trued up.

Nothing about the upstream billing cycle changes. We re-slice the same underlying daily spend
onto whatever window the agency actually invoices on.

## Why this shape (the binding constraints)

Each of these was verified against the live API on 2026-08-01, not inferred from the guide.

- **Daily spend is available and internally consistent.** `/timeseries` returns one row per
  tz-local day with `spend_cents` (`docs/olivia-external-api.md` §6.2). Summing July's 31 daily
  rows for Freedom Boat Club gives **3,928 cents**, exactly matching
  `/overview?from=2026-07-01&to=2026-07-31` → `kpis.spend.total_cents = 3928` (§6.1). Daily data
  is therefore a faithful, finer-grained basis for the same number — one call per client can
  serve every month, every custom range, and the CSV.
- **Any window works, including future-dated and historical.** `from`/`to` accept arbitrary
  `YYYY-MM-DD`. A `to` beyond today returns the partial period rather than an error (verified:
  `2026-08-01..2026-08-31` → 200, `81` cents on 2026-08-01), so month-to-date needs no special
  casing.
- **366 days is a hard cap.** `2025-01-01..2026-08-01` → `400 date_range_too_large`. History
  spanning more than a year must be fetched as multiple stitched windows.
- **Only one spend figure is reachable today.** Per-client endpoints report
  `spend: { basis: "billed_voice" }` — billed voice/call spend (§8). The richer
  usage-plus-maintenance figure lives behind `GET /agencies/{agencyId}/clients`, which requires
  `OLIVIA_AGENCY_ID`. That variable is unset, and the agency id is **not discoverable**: `self`,
  `me`, `current` and a null UUID all return `404 agency_not_found`; there is no `/me` or
  `/agency` route. It has to be issued by a vendor operator.
- **No dedicated usage or billing endpoint exists.** `/clients/{id}/usage`, `/billing`,
  `/costs`, `/cost`, `/spend`, `/invoices` all 404.
- **Timezone materially changes the invoiced amount.** Day-buckets follow `tz` (§5), so the
  same calendar month totals differently per timezone:

  | Client | Own tz | July on own tz | July on UTC | Gap |
  |---|---|---|---|---|
  | 001. SOLVI | Australia/Brisbane | $666.52 | $687.82 | $21.30 |
  | 002. Freedom Boat Club | Australia/Sydney | $39.28 | $43.33 | $4.05 |

  The API's own default is the **agency's** timezone (observed: `Australia/Sydney` even for the
  Brisbane client), which coincidentally agrees with Brisbane in July but will diverge across
  Sydney's DST months (Oct–Apr) — precisely the months being trued up. Timezone must be
  explicit, never defaulted.
- **History is currently shallow.** Oldest workspace opened 2026-06-04 (59 days). Whole-history
  totals today: SOLVI $925.07, Emma Test Funnel $97.29, Freedom Boat Club $44.14. Chunking is
  built now anyway so nothing silently truncates in June 2027.

## Decisions

### Spend basis: billed voice, behind a swappable seam

Build on `/timeseries` `spend_cents` (`basis: "billed_voice"`) because it is available today
with no new credentials. A single function `getUsageSeries()` is the **only** code that knows
where spend comes from. When `OLIVIA_AGENCY_ID` is issued, that function grows a branch for
`GET /agencies/{agencyId}/clients` (which accepts `from`/`to`/`tz`/`client_id`) and no caller
changes.

The `basis` string travels with the data and is rendered **on screen and in every CSV row**, so
a file can never be read as a figure it isn't. Before invoicing from this report, one cycle
should be reconciled against the vendor dashboard to confirm the vendor's headline usage figure
is voice-only; if it also carries SMS/AI, billed voice undercounts and the agency endpoint
becomes a prerequisite rather than an enhancement.

### Month boundaries: each client's own timezone

A Brisbane client's July runs on Brisbane days; a Sydney client's on Sydney days. This matches
what each client already sees in their own workspace dashboard (`app/dashboard/*/page.tsx` all
resolve `ws.timezone ?? DEFAULT_TZ`), so an invoice and the client's own screen agree.

Months still tile perfectly **per client** — no gaps, no double-counting, and a client's months
sum to their lifetime total regardless of which timezone was chosen. Two clients' "July" close
at different instants, which is invisible on a per-client invoice.

The Console's existing pages pass `DEFAULT_TZ` (`America/New_York`) for every client — a
shortcut appropriate to a rollup dashboard, but wrong for billing. This page does not inherit it.

### Billing-safety rules

This report is upstream of money leaving a client's account, so three failure modes are
designed out rather than tolerated:

1. **A failed fetch renders `—` and a named warning, never `$0.00`.** `getAgencyOverview()`
   currently swallows per-client errors into `0` (`lib/olivia/agency.ts:242`), which is correct
   for a KPI rollup and dangerous here: a silent zero means under-invoicing with no signal.
   Usage is `number | null`; `null` renders as `—` and names the affected clients above the
   table.
2. **Months before a workspace opened render blank, not `$0.00`.** A zero implies "billed
   nothing"; blank says "did not exist". Requires `opened_at` on the client mirror.
3. **The current month is labelled "month to date".** A partial month must never be mistaken
   for a closed one at a glance.

### CSV: data rows only

No total rows. A totals row breaks `SUM()` over a selected column and corrupts pivot tables,
which is what this file is for. Totals are shown on screen instead.

Both blocks export the **same column set**, so the two files stack in one sheet:
`client_name, client_id, period, from, to, timezone, currency, basis, spend_usd`.

`period` is the only field that differs by block — the range label (`2026-07-01..2026-07-31`)
for "This period", and the month key (`2026-07`) for each row of "All history". A client whose
spend could not be loaded exports `spend_usd` empty, never `0.00`; months before a client opened
produce no row at all.

`spend_usd` is formatted from integer cents (never float arithmetic). Values are RFC 4180
escaped, and any field whose first character is `= + - @` (or a tab/CR) is prefixed with a
single quote so a client name can never execute as a formula in Excel or Google Sheets.

### History depth: year-aligned chunking

A requested span is split into windows on **calendar-year boundaries** (`2026-01-01..2026-12-31`),
each ≤366 days, fetched separately and concatenated. Year-aligned keys are date-stable, so a
closed year's cache entry is reused across every request and every report range, rather than a
rolling window minting a fresh key each day. The current year's chunk ends at the range end and
uses the same short freshness tier as the rest of the app.

## Layout

The page carries a period picker and two tables.

**Period picker** — calendar-month quick-picks back to the earliest workspace opening, plus a
custom `from`/`to`. Defaults to the **last complete calendar month**, which is what is being
invoiced on the 1st. The selection lives in the URL (`?from=&to=`), matching how every other
filter in this app is stored, so a period is shareable and survives refresh.

**Block A — "This period"** — one row per client: name, timezone, spend for the selected range;
agency total beneath. This is the invoice run.

**Block B — "All history"** — a matrix: rows are clients, columns are every calendar month since
the agency opened, cells are that client's spend for that month in that client's own timezone.
Row totals give client lifetime; column totals give the agency's month. Cells before a client's
`opened_at` are blank. This is the true-up.

Each block has its own **Export CSV** control carrying the same period.

## Components

| File | Role |
|---|---|
| `lib/usage.ts` | Pure. Month enumeration, daily→month bucketing, range summing, year-boundary chunking, CSV encoding. No I/O, no `server-only`. |
| `lib/olivia/usage.ts` | Server-only. Chunked `/timeseries` fetch through `cachedFetch` (new `usage` tier), per-client timezone, `null` on failure. Holds `getUsageSeries()`, the source seam. |
| `app/console/usage/page.tsx` | Server component. Resolves period from search params, renders both blocks. |
| `app/console/usage/export/route.ts` | `requireAdmin()`-guarded `text/csv` download. |
| `components/console/UsageView.tsx` | Presentation for both tables + the period picker. |
| `components/console/ConsoleSidebar.tsx` | Adds the "Usage & billing" nav entry. |
| `scripts/usage-selftest.ts` | `npm run test:usage`, matching the repo's existing selftest pattern. |
| `supabase/migrations/*_usage_opened_at.sql` | Additive `opened_at` column on `olivia_clients`. |

## Testing

`lib/usage.ts` is pure, so it is covered directly by `scripts/usage-selftest.ts` (`node:assert`,
the pattern used by `test:crawl`, `test:leadsearch`, `test:threads`). Cases:

- Month enumeration across a year boundary and for a single partial month.
- Bucketing: daily rows sum to the month total; the month totals sum to the lifetime total.
- Range summing is inclusive of both endpoints.
- Year chunking: a sub-year span is one chunk; a multi-year span splits on 1 Jan; every chunk is
  ≤366 days; chunks are contiguous with no gap or overlap.
- CSV: comma, quote, and newline escaping; formula-injection neutralisation; cents→dollars
  formatting has no float drift (e.g. `66652` → `666.52`).
- `null` (fetch failure) is preserved through bucketing and never coerced to `0`.

Live verification after implementation: the rendered July figures must equal the probe values —
SOLVI **$666.52**, Freedom Boat Club **$39.28**, Emma Test Funnel **$10.85**.

## Out of scope

- **Daily line-item drill-down.** The data is already held per day; this is a rendering
  addition whenever an invoice is disputed.
- **The maintenance / retainer split.** Blocked on `OLIVIA_AGENCY_ID`.
- **A client-facing view of their own usage.** This is an agency invoicing tool.

## Naming

User-facing copy says **Emma** throughout and never names the upstream vendor, consistent with
the rest of the product. Internal identifiers (`olivia_clients`, `lib/olivia/*`) are unchanged.
