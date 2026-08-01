# Paste-ready prompt for Olivia's Claude Code

Everything below the line is the message. It is written for a coding agent working inside the
Olivia codebase — it states where to look, what to change, and how to verify.

---

We're Impero Agency, an agency on the Olivia platform. We consume the external analytics API
(`/api/external/v1`) for our client dashboard and our own invoicing. Three things need attention
on the Olivia side. **Task 1 is a correctness bug that silently under-reports billed spend**, so
please start there.

---

## Task 1 — Bug: `from`/`to` are filtered on UTC days, but `/timeseries` buckets are labelled in `tz`

The integration guide states this outright (§8): *"`from`/`to` are inclusive UTC days; day-buckets
in `/timeseries` use `tz`."* Those two definitions disagree at the window edges.

For a client **ahead of** UTC, the first `tz`-local day of a requested window comes back
**truncated**: spend that falls inside that local day but before UTC midnight is filtered out,
while the bucket still carries the full local date. For a client **behind** UTC the same defect
appears at the `to` end instead.

### Reproduction (production, read-only key)

Client **001. SOLVI** — `9c6d445a-4d4a-465b-aca7-b8108083e529`, timezone `Australia/Brisbane`
(UTC+10, no DST). Brisbane's 1 July begins at **30 June 14:00 UTC**.

```bash
KEY="oa_live_..."
BASE="https://www.lunarolivia.com"
CID="9c6d445a-4d4a-465b-aca7-b8108083e529"
TZ="Australia%2FBrisbane"

# A — window starts on the 1st
curl -s -H "x-api-key: $KEY" \
  "$BASE/api/external/v1/clients/$CID/timeseries?from=2026-07-01&to=2026-07-31&tz=$TZ"

# B — identical, except the window starts one day earlier
curl -s -H "x-api-key: $KEY" \
  "$BASE/api/external/v1/clients/$CID/timeseries?from=2026-06-30&to=2026-08-01&tz=$TZ"
```

### Observed

| Request | `2026-07-01` bucket | Sum of all July buckets |
|---|---|---|
| **A** (`from=2026-07-01`) | `1684` cents | `66652` cents |
| **B** (`from=2026-06-30`) | `2823` cents | `67791` cents |

The same calendar day reports two different amounts, differing only by where the request window
starts. **`1139` cents of real spend is invisible in A.** One client, one month.

`GET /clients/{clientId}/overview?from=2026-07-01&to=2026-07-31&tz=Australia/Brisbane` returns
`kpis.spend.total_cents = 66652` — the truncated figure. So this lives in the **shared window-filter
layer**, not in `/timeseries` specifically.

### Expected

When `tz` is supplied, resolve `from`/`to` to that timezone's local day boundaries *before*
filtering — `from` at 00:00:00.000 in `tz` through `to` at 23:59:59.999 in `tz`, converted to UTC
instants for the query — so the filter and the bucket labels describe the same set of days.

### Where to look

The code that turns the `from`/`to`/`tz` query params into the timestamp range used by the
analytics queries. It is shared by at least `/overview`, `/timeseries`, `/outcomes`, `/funnel` and
`/agents`, since they all accept the same parameters and `/overview` shows the identical defect.
Fixing it in that shared layer should fix all of them at once — please verify it does rather than
patching `/timeseries` alone.

### Compatibility — please decide deliberately

**This changes the numbers returned to every existing consumer.** Two reasonable options:

1. Ship as a bug fix with a changelog entry. Our preference — the current behaviour cannot produce
   a correct calendar month for any client not on UTC, so anyone relying on it is already wrong.
2. Gate behind a parameter (e.g. `window_tz=local`) and migrate callers.

Either is workable for us. Silently changing it with no note is the one outcome to avoid.

### Acceptance criteria

- For a UTC+10 client, `from=2026-07-01&to=2026-07-31&tz=Australia/Brisbane` returns the same July
  total as requesting a wider window and summing only the July-labelled buckets.
- `/overview` and `/timeseries` agree for the same window and `tz`.
- Regression tests covering a timezone **ahead of** UTC (e.g. `Australia/Brisbane`) and one
  **behind** it (e.g. `America/New_York`), since they truncate at opposite ends of the window.
- Include a DST-observing timezone (e.g. `Australia/Sydney`) so the offset isn't assumed constant.

---

## Task 2 — Feature: usage cost for an arbitrary date range, with maintenance kept separate

`GET /api/external/v1/agencies/{agencyId}/clients` returns per client:

```
spend_cents, maintenance_cents, total_cost_cents
```

That split is exactly what we need — we pass usage through to our clients but bill the flat
monthly fee under our own agreement, so a combined `total_cost_cents` is not usable for invoicing.
The problem is the window: the documented parameter is `range`, and we invoice on **calendar
months (1st → end of month)**, which no fixed range expresses.

### Ask

Accept `from`, `to` and `tz` on this endpoint, with the same `tz`-local semantics as Task 1:

```
GET /api/external/v1/agencies/{agencyId}/clients?from=2026-07-01&to=2026-07-31&tz=Australia/Brisbane
```

### Please also answer

1. **Does it already accept `from`/`to`/`tz`?** We could not confirm from the guide, which
   documents only `range`. If it does, please just document it and we'll use it immediately.
2. **Is `maintenance_cents` prorated to a partial window, or always the full monthly flat amount?**
   We need to know which. Ideally return it explicitly, e.g.
   `maintenance_basis: "monthly_flat" | "prorated"`, so no caller has to guess.
3. **Is there a per-client variant?** Pulling the entire agency roster to read one client is
   wasteful when we're reconciling a single invoice.

A per-category usage breakdown (voice / SMS / LLM) would be welcome if it's feasible — the guide
says it isn't currently available and that TTS is bundled into voice. **Not blocking.** One
accurate usage number per window is what we actually need.

### Acceptance criteria

- `?from=2026-07-01&to=2026-07-31&tz=Australia/Brisbane` returns SOLVI's July usage matching the
  `tz`-correct `/timeseries` sum for the same window (once Task 1 lands).
- `spend_cents` and `maintenance_cents` remain separate fields.
- The maintenance basis is unambiguous from the response alone.

---

## Task 3 — Data fix: remove the $300 maintenance fee from a reporting-only workspace

`GET /api/external/v1/agencies/{agencyId}/clients` returns `maintenance_cents: 30000` for:

- **000. Emma Test Funnel** — `01b1fb8e-2b65-4330-8f0d-ed631afa03bf`

This workspace exists **solely for reporting purposes**. It is not a client account, has never
been one, and there is no maintenance being performed on it to bill for. It should carry **no
maintenance fee**.

Its usage spend is genuine (~`1085` cents for July 2026) and should keep reporting normally — only
the flat `30000` is wrong.

**Preferred fix:** if Olivia has a workspace type or flag for non-billable / internal-reporting
accounts, apply that rather than editing the rate. A one-off rate change can silently reappear when
a plan is recalculated, and a flag would cover any future reporting workspace we create.

**Please also confirm:** has this $300 actually been billed to us, and for how many months? If so
we'll need it credited.

**Do not change** `9c6d445a-…` (001. SOLVI) or `0e01011c-…` (002. Freedom Boat Club) — their $300
maintenance is expected and correct.

---

## Priority

| # | Change | Why it matters |
|---|---|---|
| 1 | `tz`-local window boundaries | Under-reports billed spend today, for every non-UTC client |
| 2 | `from`/`to`/`tz` on the agency cost endpoint | Unblocks calendar-month invoicing |
| 3 | Zero the maintenance on `01b1fb8e-…` | We're being charged for a non-account |

Tasks 1 and 2 compose: 2 is only trustworthy once 1 is fixed, since a calendar-month window on a
non-UTC client is exactly the case that currently truncates.
