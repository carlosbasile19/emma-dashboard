# Conversational Brief Emma + Reporting nutshell — design

**Date:** 2026-07-22
**Driver:** user feedback — the brief is too thin (no lead motivations / hesitations), the
reporting walkthrough recites raw metrics, and both read like a dashboard, not like Emma talking.

## Goals

1. **Brief Emma** surfaces per-lead context: who's motivated and why others are hesitating.
2. **Reporting walkthrough** presents the window's metrics "in a nutshell" — a couple of
   conversational sentences, not a metric recital.
3. Both features' generated text sounds like Emma speaking, with numbers woven into sentences.

## Constraints (from the live API)

- `/leads` (list) **never** returns lead-intelligence text, notes or custom fields (guide §6.7),
  so free-text motivations aren't available at brief scale. What the list does carry per lead:
  `status`, `last_disposition`, `total_calls`, `last_call_at`, and — only with `dashboard:pii` —
  the lead's name.
- Motivation/hesitation is therefore **derived from dispositions**, the honest per-lead signal:
  `interested`/`booked` → motivated; `callback_requested` → hesitating on timing;
  `voicemail_left` → unreachable; `not_interested` → an objection to work on. Names are used
  when the key has PII scope, with count-based fallbacks otherwise. `dnc` is never surfaced.
- The live briefing/reporting bridges own their spoken audio — this work shapes the
  **local walkthrough / preview** text and the on-screen brief list only.

## Design

### New module: `lib/narrate.ts` (pure, client-safe)

The one place that turns workspace numbers into Emma-voiced sentences:

- `joinNames(names, max)` — "Maria, Jack and 2 more".
- `spokenShare(rate)` — 0..1 → "about 6 in 10", "about half", "nearly everyone", "no one".
- `pointsTrend(cur, prev)` — rate delta → " — up 2 points on last period" / "holding steady".
- `buildNutshell(kpis, prevKpis?)` — 2–3 sentence metric summary for the reporting preview.
- `describeNew / describeChase / describeBooked / describeConverted(leads)` — per-stage
  conversational detail lines (motivations + hesitations) from disposition buckets.

### `lib/overview.ts`

- `BriefItem` gains `detail?: string[]` — conversational context lines under each row.
- `buildBriefItems(ov, campaigns, leads?)` — optional window-scoped lead list powers the
  detail lines; stage counts from `kpis.leads_by_stage` stay authoritative for titles.
  Sub lines rewritten in Emma's voice; campaign subs become sentences.

### Data flow

- `app/dashboard/page.tsx` and `fetchBriefWindow` additionally fetch
  `fetchLeads({ from, to, tz, limit: 100 })` **best-effort** (`.catch(() => null)`) — the brief
  never fails because the lead list errored; details simply drop off.
- New server action `fetchReportNutshell(window)` — overview for the window + the previous
  equal-length period (`prevOfPeriod`, new in `lib/filters.ts`) → nutshell lines. Called when a
  report starts so the preview speaks the numbers for the *chosen* window, not the dashboard range.

### UI

- `BriefRow` renders `detail` lines (small muted lines) in both the form list and the live
  walkthrough.
- `ReportEmma` takes an initial `nutshell` prop (dashboard range, server-computed), refreshes it
  per-window via the action alongside `beginReport`, and builds the preview script from it.
  Static `COVERS` copy gets the conversational pass.

### Testing

`scripts/narrate-selftest.ts` (node:assert, tsx) + `test:narrate` npm script, matching the
existing selftest pattern.

## Out of scope

- The live bridge's spoken content (backend-owned).
- Fetching per-lead detail (`lead_context`) for the brief — N+1 against a paged, cached API for
  text the list intentionally withholds.
