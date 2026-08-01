# Request to Olivia: date-ranged usage spend (excluding maintenance) + one billing bug

**From:** Impero Agency (Hey Emma dashboard)
**Date:** 2026-08-01
**Affects:** billing / client invoicing

> ## STATUS — sent, and mostly resolved the same day
>
> | Ask | Status |
> |---|---|
> | §2 `from`/`to` filtered on UTC while buckets label in `tz` | ✅ **Fixed.** `from`/`to` now resolve on `tz`-local boundaries. Re-verified: `/overview` and `/timeseries` both return $677.91 for Brisbane's July, and five different request windows agree. Our figures did not change — the padding workaround had us on the correct number already. |
> | §3 $300 maintenance on Emma Test Funnel | ✅ **Fixed.** Now reports `no maint.`; SOLVI and Freedom Boat Club correctly retain theirs. **Still outstanding:** whether that $300 was actually billed in past months and needs crediting. |
> | §1 `from`/`to`/`tz` on the agency cost endpoint | ❓ **Unverified.** Needs a direct call with `OLIVIA_AGENCY_ID`, which lives only in Vercel as a sensitive var. Not blocking — our report excludes maintenance by design, so this would only confirm our usage figure against Olivia's. |
>
> Kept as the record of what was asked and why. The reproduction in §2 no longer reproduces.

---

## Context

We invoice our clients on **calendar months, 1st to end of month**. Olivia's dashboard reports
AI Power usage on a **15th → 14th** cycle, so every month we reconcile two different windows by
hand. We've built a report on the external API that re-slices spend onto calendar months, and in
doing so hit three things we need your help with.

Two are API requests, one is a data bug on our account.

---

## 1. We need usage spend for an arbitrary date range, with maintenance excluded

Today the only place that separates usage from the flat monthly fee is:

```
GET /api/external/v1/agencies/{agencyId}/clients?range=30d
→ clients[]: { spend_cents, maintenance_cents, total_cost_cents }
```

That split is exactly what we want — but it appears to be driven by a fixed `range` parameter.

**Ask:** let that endpoint (or a per-client equivalent) take `from`, `to` and `tz`, so we can
request any window:

```
GET /api/external/v1/agencies/{agencyId}/clients?from=2026-07-01&to=2026-07-31&tz=Australia/Brisbane
```

**Questions:**

1. Does `/agencies/{agencyId}/clients` already honour `from`/`to`/`tz`? We could not confirm it
   from the integration guide, which documents only `range`. If it does, we'll use it immediately
   — please just confirm the parameter names and whether `maintenance_cents` is **prorated** to a
   partial window or returned as the full flat monthly amount.
2. If it does not, can it be added? A calendar-month window is the specific need.
3. Is there a per-client equivalent, so we can request one client at a time rather than the whole
   agency roster?

**Why `maintenance_cents` must stay separate:** we pass usage through to clients but bill the
flat fee under our own agreement. A combined `total_cost_cents` is not usable for pass-through
invoicing.

**On the per-category split:** the guide states a voice / SMS / LLM breakdown is not available and
that TTS is bundled into voice. If a `usage_breakdown` by category is feasible we'd take it, but
it is **not** blocking — a single accurate usage number per window is what we need.

---

## 2. Bug: the `from`/`to` filter is applied on UTC days, but `/timeseries` buckets are labelled in `tz`

This one silently under-reports money, so it matters most.

Your guide states it explicitly (§8): *"`from`/`to` are inclusive UTC days; day-buckets in
`/timeseries` use `tz`."* Those two don't agree at the window edges. For a client ahead of UTC,
the first local day of any requested window comes back **truncated** — the portion of that local
day that falls before UTC midnight is filtered out, but the bucket is still labelled with the
full local date.

### Reproduction

Client **001. SOLVI** — `9c6d445a-4d4a-465b-aca7-b8108083e529`, timezone `Australia/Brisbane`
(UTC+10, no DST). Brisbane's 1 July begins at **30 June 14:00 UTC**.

```bash
KEY="oa_live_..."
BASE="https://www.lunarolivia.com"
CID="9c6d445a-4d4a-465b-aca7-b8108083e529"
TZ="Australia/Brisbane"

# A — window starts on the 1st
curl -s -H "x-api-key: $KEY" \
  "$BASE/api/external/v1/clients/$CID/timeseries?from=2026-07-01&to=2026-07-31&tz=$TZ"

# B — identical, except the window starts one day earlier
curl -s -H "x-api-key: $KEY" \
  "$BASE/api/external/v1/clients/$CID/timeseries?from=2026-06-30&to=2026-08-01&tz=$TZ"
```

### Observed

| | `2026-07-01` bucket | July total |
|---|---|---|
| **A** — `from=2026-07-01` | **$16.84** | **$666.52** |
| **B** — `from=2026-06-30` | **$28.23** | **$677.91** |

The same calendar day reports two different amounts depending only on where the request window
starts. **$11.39 of real spend is invisible in A**, on one client in one month.

`GET /clients/{clientId}/overview?from=2026-07-01&to=2026-07-31&tz=Australia/Brisbane` returns
`spend.total_cents` matching the **truncated** $666.52 — so `/overview` is affected identically
and cannot be used as a reference either.

### Expected

When `tz` is supplied, `from`/`to` should be interpreted as **`tz`-local days**, so that a
requested window and the buckets it returns describe the same set of days. A caller asking for
`2026-07-01..2026-07-31` in `Australia/Brisbane` should get that client's July as they experience
it, independent of how the request window is framed.

### Our current workaround

We request one extra day at each end and bucket on the returned local labels, then verify the
total stops moving as the window widens. It works, but every consumer of this API has to know to
do it, and any that don't will quietly under-report. Anyone reading a month straight off
`/overview` is under-reporting today.

**Question:** is the value Olivia's own dashboard shows as "AI Power usage" computed on UTC days
or on the client's local days? That determines whether your figure and ours can ever agree.

---

## 3. Data bug: "000. Emma Test Funnel" is being charged a $300 maintenance fee

`GET /api/external/v1/agencies/{agencyId}/clients` returns `maintenance_cents: 30000` for:

- **000. Emma Test Funnel** — `01b1fb8e-2b65-4330-8f0d-ed631afa03bf`

This workspace exists **solely for reporting purposes** — it is not a client account and never
has been, and there is no maintenance being performed on it to bill for. It should carry **no
maintenance fee**.

Its usage spend (~$10.85 for July 2026) is genuine and fine to keep reporting — it's only the
flat $300 that's wrong.

Currently it reports as roughly:

```
spend_cents:       1085     ($10.85)   ← correct
maintenance_cents: 30000    ($300.00)  ← should be 0
total_cost_cents:  31085    ($310.85)
```

Please set this workspace's maintenance rate to zero. If Olivia has a workspace type or flag for
non-billable / internal-reporting accounts, that's the better fix — it would stop the same charge
reappearing if the plan is ever recalculated, and would apply to any future reporting workspace
we create.

**Please also confirm** whether this $300 has been included in what we've actually been billed to
date, and for how many months — if so we'll need it credited.

The other two workspaces (**001. SOLVI**, **002. Freedom Boat Club**) also show $300 maintenance,
and for those it is expected. Only Emma Test Funnel is wrong.

---

## Summary of what we're asking for

| # | Ask | Priority |
|---|---|---|
| 1 | `from`/`to`/`tz` on the agency clients cost endpoint (or a per-client equivalent), keeping `spend_cents` and `maintenance_cents` separate — plus confirmation of whether maintenance is prorated | High — unblocks calendar-month invoicing |
| 2 | Interpret `from`/`to` as `tz`-local days so month totals aren't truncated | High — currently under-reports spend |
| 3 | Remove the $300 maintenance fee from `01b1fb8e-…` (Emma Test Funnel), and confirm whether it has been billed | High — we're being charged for it |

Happy to jump on a call if any of this is easier to work through live. The reproduction in §2
runs against production with a read-only key and takes about ten seconds.
