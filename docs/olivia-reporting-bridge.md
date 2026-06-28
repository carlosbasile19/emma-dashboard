# Olivia "Reporting bridge" — voice reporting walkthrough for the Hey Emma dashboard

> Sibling of the **briefing bridge** (`docs/olivia-briefing-bridge.md`). Same server-to-server auth,
> same Retell realtime join, same SSE/polling transcript. Two differences only: the path word is
> **`reporting`** (not `briefings`) and the agency key must carry the **`dashboard:report`** scope.
>
> **Reporting is read-only.** Emma narrates one client's numbers — headline metrics, today's call
> schedule and outstanding looms, with optional voice drill-down into a specific agent. She never
> books, edits or contacts anyone. Every session is strictly scoped to a single `{clientId}` (the
> dashboard is shown to the client, not the agency); cross-client comparison is disabled server-side.

## Contract (external API)

Base: `https://www.lunarolivia.com/api/external/v1/clients/{clientId}/reporting`
Auth: `x-api-key: oa_live_...` (server-only). Scope `dashboard:report` required → else `403
forbidden_scope`. Optional `dashboard:pii` lets Emma speak lead **names**; without it, counts +
metrics only. `{clientId}` must belong to the key's agency → else `404 client_not_found`.

| # | Method & path | Purpose |
|---|---|---|
| 1 | `POST .../reporting` | Start a session. Body (optional): `{ from, to, tz }` (default last 30d, agency tz). `201` → `{ reporting_id, client_id, status, period, summary: { schedule_count, loom_count }, realtime: { provider, url, token, room, expires_at } }`. Join Retell with `realtime.token` within ~60s. Limit **3** concurrent/agency → `429 reporting_concurrency_limit` + `Retry-After: 30`. |
| 1a | (drill-down) | The dashboard sends an **optional** `agent_id` in the start body only when the user picks one agent in the "Drill into agent" selector — otherwise the body is exactly `{from,to,tz}`. Forward-compat: confirm the backend honors `agent_id` (else the drill-down is voice-only and the field is ignored). |
| 2 | `GET .../reporting/{id}` | Status + transcript (polling fallback, ~2s). `{ status, started_at, ended_at, transcript: [{ role, text, at }] }`. `status ∈ queued\|connecting\|live\|ended\|failed`. |
| 3 | `GET .../reporting/{id}/stream` | SSE (preferred). `event: status` / `event: transcript` / `event: ended`. Closes on terminal status or ~110s. |
| 4 | `POST .../reporting/{id}/end` | Idempotent end → `{ status: "ended" }`. Called on hang-up / unmount. |

Errors: `401 unauthorized` · `403 forbidden_scope` · `404 client_not_found | reporting_not_found` ·
`400 invalid_request | invalid_date_range | date_range_too_large | invalid_timezone` ·
`429 reporting_concurrency_limit` · `500 internal_error`.

## How the dashboard integrates

The agency key never reaches the browser, so the dashboard fronts the action + stream endpoints:

- **`lib/olivia/api.ts`** — `startReporting` / `getReportingStatus` / `endReporting` (via `oliviaFetch`)
  and `streamReporting` (raw SSE `Response` via `oliviaStream`). `startReporting` uses `maxRetries: 0`
  so a concurrency-limit `429` surfaces immediately with its `Retry-After`.
- **`lib/olivia/service.ts`** — session-scoped wrappers. Every call derives `clientId` from
  `getSessionClientId()` (the session, never the browser). Flag-gated by `OLIVIA_REPORTING_ENABLED`;
  off / backend-not-ready degrades to a local preview. `409/403/concurrency` errors are surfaced on
  `ReportSession.error`.
- **`app/auth/actions.ts`** — `beginReport(window)` / `endReport(id)` server actions.
- **`app/api/reporting/[id]/route.ts`** — same-origin status proxy (polling fallback).
- **`app/api/reporting/[id]/stream/route.ts`** — same-origin SSE proxy; pipes upstream events
  verbatim with the key injected server-side; `request.signal` tears down the upstream on close.
- **`components/dashboard/report/ReportEmma.tsx`** + `useReportingTranscript.ts` — the
  "Reporting walkthrough" entry point next to "Brief Emma": form (window + optional agent
  drill-down) → connecting → live, joins the Retell web call and renders the streamed transcript
  (SSE preferred, polling fallback). The transcript keeps streaming even if the audio join fails.
  The agent list is passed from the overview page (`fetchAgents`, session-scoped to this client).

## Activation

1. Confirm the agency key (`OLIVIA_API_KEY`) carries the `dashboard:report` scope (and
   `dashboard:pii` if Emma should speak names).
2. Set `OLIVIA_REPORTING_ENABLED=true`.

Until then the modal runs a local preview walkthrough (no live call), exactly like Brief Emma.
