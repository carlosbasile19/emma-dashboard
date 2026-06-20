# Olivia External Dashboard API — Integration Guide

> **Use this document as the single source of truth for building the dashboard that pulls
> per-client analytics from Olivia.** It is written to be handed directly to a developer or
> pasted into an AI coding assistant as context. Everything below reflects the live production
> API. Read §1–§4 before writing any request.

---

## 1. Mental model (read this first)

- An **agency** owns many **clients**. The dashboard shows each client their own workspace.
- The dashboard holds **one API key, scoped to one agency**. The key *is* the agency — you never
  pass an `agency_id`; it's derived from the key.
- **Every analytics request requires a `client_id`** in the URL path, and the API enforces that the
  client belongs to the key's agency. A request can never return another agency's or an unrelated
  client's data.
- The API is **read-only** (GET only) and **server-to-server**. The key must live on your backend —
  **never ship it to a browser.**

**The flow:** discover the agency's clients once (§4) → for each client, call the dashboard
endpoints with that `client_id` (§6) → render a workspace per client.

---

## 2. Authentication & scopes

Every request sends the key in a header:

```
x-api-key: oa_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

The key is minted by an Olivia operator (Settings → API Keys) with these **scopes**:

| Scope | Needed for | Notes |
|---|---|---|
| `clients:read` | Listing the agency's clients (§4) | Required to discover `client_id`s |
| `dashboard:read` | All analytics endpoints (§6) | Required |
| `dashboard:pii` | Un-redacting PII on list endpoints | **Optional.** Only granted when raw PII export is explicitly approved. Without it, names/phones/emails/transcripts/recordings/message text are omitted. |

A key missing a required scope → `403 { "code": "forbidden_scope" }`.

---

## 3. Base URLs

Production host: **`https://www.lunarolivia.com`** (the apex `lunarolivia.com` 307-redirects to `www`).

Two namespaces are involved:

| Purpose | Base path |
|---|---|
| Discover clients | `https://www.lunarolivia.com/api/v1/external` |
| Per-client analytics (this API) | `https://www.lunarolivia.com/api/external/v1` |

> Note the segment order differs (`v1/external` vs `external/v1`) — they are different trees.

---

## 4. Step 1 — Discover the agency's clients

Before any analytics call you need the list of `client_id`s. Use the clients endpoint
(scope `clients:read`):

```
GET /api/v1/external/clients?page=1&limit=100
x-api-key: oa_live_...
```

Response:

```json
{
  "clients": [
    {
      "id": "8f3b...uuid",
      "name": "Acme Dental",
      "slug": "acme-dental",
      "status": "active",
      "industry": "dental",
      "website": "https://...",
      "timezone": "America/New_York",
      "created_at": "2026-01-12T00:00:00Z"
    }
  ],
  "total": 12,
  "page": 1,
  "limit": 100
}
```

Use each `clients[].id` as the `{clientId}` path segment for every endpoint in §6. Cache this list
and refresh periodically; it changes rarely.

---

## 5. Shared request/response conventions

**These apply to every analytics endpoint in §6.**

### Query parameters

| Param | Where | Default | Rules |
|---|---|---|---|
| `from`, `to` | analytics endpoints | last 30 days | `YYYY-MM-DD`. `from ≤ to`. Window ≤ **366 days**. UTC day bounds; day-buckets use `tz`. |
| `tz` | analytics endpoints | the agency's configured tz, else `America/New_York` | IANA name, e.g. `America/Chicago` |
| `page` | list endpoints (`/leads`, `/calls`, `/conversations`) | `1` | integer ≥ 1 |
| `limit` | list endpoints | `25` | integer 1–100 (clamped) |
| `status`, `source` | `/leads` only | — | optional exact-match filters |

### Response envelopes

- **Detail/aggregate endpoints** return an object directly (see each endpoint).
- **List endpoints** return: `{ "<resource>": [ ... ], "total": N, "page": P, "limit": L }`.

### Errors

Always `{ "error": "<message>", "code": "<machine_code>" }` with an HTTP status:

| Status | `code` | Meaning |
|---|---|---|
| 401 | `unauthorized` | missing/invalid/revoked/expired key |
| 403 | `forbidden_scope` | key lacks the required scope |
| 404 | `client_not_found` | `client_id` doesn't exist or isn't in this agency |
| 400 | `invalid_date_range` / `invalid_timezone` / `date_range_too_large` | bad `from`/`to`/`tz` |
| 429 | — (`{ "error": "Too Many Requests", "retry_after_seconds": N }`) | rate limited; respect `Retry-After` header |
| 500 | `internal_error` | server error (safe to retry with backoff) |

### Rate limits

Shared bucket across the analytics API: **120 requests/min per IP, 600/min per key**. On 429, backoff using the `Retry-After` header.

### PII (very important)

List endpoints (`/leads`, `/calls`, `/conversations`) **omit PII fields entirely** unless the key
carries `dashboard:pii`. Build your UI to work with the redacted shape by default; only the extra PII
fields appear when the scope is present. Olivia's internal/raw cost is **never** returned under any scope.

---

## 6. Endpoints

All are `GET https://www.lunarolivia.com/api/external/v1/clients/{clientId}/...` and require
`dashboard:read`.

### 6.1 `/overview` — headline KPIs

`GET /clients/{clientId}/overview?from&to&tz`

```json
{
  "client_id": "8f3b...",
  "period": { "from": "2026-05-21", "to": "2026-06-20", "tz": "America/New_York" },
  "kpis": {
    "leads_total": 120,
    "calls_total": 64,
    "pickup_rate": 0.52,
    "avg_call_duration_sec": 138,
    "bookings_rate": 0.31,
    "converted_count": 12,
    "spend": { "total_cents": 84210, "currency": "usd", "basis": "billed_voice" },
    "leads_by_stage": { "new": 40, "contacted": 30, "qualified": 18, "booked": 20, "converted": 12, "lost": 0, "dnc": 0 }
  }
}
```

### 6.2 `/timeseries` — daily series

`GET /clients/{clientId}/timeseries?from&to&tz`

```json
{
  "client_id": "8f3b...",
  "period": { "from": "2026-05-21", "to": "2026-06-20", "tz": "America/New_York" },
  "series": [
    { "date": "2026-06-20", "calls": 5, "picked_up": 3, "bookings": 1, "spend_cents": 1240 }
  ]
}
```

`series` has one entry per tz-local calendar day in the window (zero-filled).

### 6.3 `/outcomes` — distributions

`GET /clients/{clientId}/outcomes?from&to&tz`

```json
{
  "client_id": "8f3b...",
  "period": { "...": "..." },
  "outcomes": {
    "call_outcomes":      { "completed": 40, "no_answer": 18, "failed": 4, "busy": 2 },
    "call_dispositions":  { "booked": 12, "interested": 8, "not_interested": 9, "no_disposition": 35 },
    "booking_outcomes":   { "scheduled": 15, "completed": 4, "cancelled": 3, "no_show": 1 }
  }
}
```

Keys are dynamic (only non-zero buckets appear). See §7 for the full enum sets.

### 6.4 `/funnel` — lead stage counts

`GET /clients/{clientId}/funnel?from&to&tz`

```json
{
  "client_id": "8f3b...",
  "period": { "...": "..." },
  "funnel": { "new": 40, "contacted": 30, "qualified": 18, "booked": 20, "converted": 12, "lost": 0, "dnc": 0 }
}
```

### 6.5 `/agents` — per-agent leaderboard

`GET /clients/{clientId}/agents?from&to&tz`

```json
{
  "client_id": "8f3b...",
  "period": { "...": "..." },
  "agents": [
    {
      "agent_id": "a1...",
      "name": "Setter — Acme",
      "client_name": "Acme Dental",
      "total_leads": 120,
      "total_calls": 64,
      "pickup_rate": 0.52,
      "overall_booking_rate": 0.31,
      "call_to_booking_rate": 0.30,
      "avg_call_duration_sec": 138,
      "total_conversion": 0.31
    }
  ]
}
```

One row per active outbound "setting" agent for the client. **Caveat:** the lead-denominated
columns (`total_leads`, `overall_booking_rate`, `total_conversion`) are **client-level**, not strictly
attributed to that agent; the call-denominated columns (`total_calls`, `pickup_rate`,
`call_to_booking_rate`, `avg_call_duration_sec`) are agent-scoped. `total_conversion` equals
`overall_booking_rate` (same number, different name). No cost field is returned.

### 6.6 `/campaigns` — reactivation campaign performance

`GET /clients/{clientId}/campaigns`

```json
{
  "client_id": "8f3b...",
  "campaigns": [
    {
      "id": "c1...",
      "name": "Spring Reactivation",
      "status": "active",
      "created_at": "2026-06-01T00:00:00Z",
      "leads_total": 500,
      "leads_contacted": 480,
      "replies": 120,
      "opt_outs": 15,
      "appointments_booked": 34,
      "reply_rate": 0.25,
      "opt_out_rate": 0.031
    }
  ],
  "total": 1
}
```

Counts are **lifetime-to-date** (not sliced by `from`/`to`). No PII, no cost.

### 6.7 `/leads` — paginated lead list (PII-gated)

`GET /clients/{clientId}/leads?from&to&page&limit&status&source`

Without `dashboard:pii`:

```json
{
  "leads": [
    {
      "id": "l1...",
      "status": "booked",
      "source": "manual",
      "tags": ["vip"],
      "industry": "dental",
      "timezone": "America/New_York",
      "created_at": "2026-06-10T00:00:00Z",
      "updated_at": "2026-06-11T00:00:00Z",
      "last_call_at": "2026-06-11T00:00:00Z",
      "last_disposition": "booked",
      "total_calls": 3,
      "stage_entered_at": "2026-06-10T00:00:00Z"
    }
  ],
  "total": 120, "page": 1, "limit": 25
}
```

With `dashboard:pii`, each lead also includes: `first_name`, `last_name`, `email`, `phone`,
`instagram_handle`. **Never returned:** per-lead cost, internal notes, lead-intelligence text,
custom fields, external/CRM ids. `status`/`source` query params filter the list.

### 6.8 `/calls` — paginated call log (PII-gated)

`GET /clients/{clientId}/calls?from&to&page&limit`

Without `dashboard:pii`:

```json
{
  "calls": [
    {
      "id": "call1...",
      "lead_id": "l1...",
      "direction": "outbound",
      "status": "completed",
      "disposition": "booked",
      "started_at": "2026-06-11T10:00:00Z",
      "ended_at": "2026-06-11T10:05:00Z",
      "duration_seconds": 138,
      "created_at": "2026-06-11T10:00:00Z"
    }
  ],
  "total": 64, "page": 1, "limit": 25
}
```

With `dashboard:pii`, each call also includes: `from_number`, `to_number`, `recording_url`,
`transcript`, `callback_notes`. **Never returned:** per-call cost, provider call id. Only real lead
calls are included (internal/tester calls excluded).

### 6.9 `/conversations` — paginated conversation log (PII-gated)

`GET /clients/{clientId}/conversations?from&to&page&limit`

Without `dashboard:pii`:

```json
{
  "conversations": [
    {
      "id": "conv1...",
      "lead_id": "l1...",
      "channel": "sms",
      "platform": "instagram",
      "started_at": "2026-06-11T10:00:00Z",
      "ended_at": null,
      "sentiment_score": 0.4,
      "opted_out_at": null,
      "created_at": "2026-06-11T10:00:00Z"
    }
  ],
  "total": 30, "page": 1, "limit": 25
}
```

With `dashboard:pii`, each conversation also includes: `summary` (AI recap). Internal reporting/tester
threads are excluded. Message-by-message bodies are **not** in this endpoint.

---

## 7. Enum reference

- **lead status / funnel stages:** `new`, `contacted`, `qualified`, `booked`, `converted`, `lost`, `dnc`
- **lead source:** `csv_import`, `crm_sync`, `manual`, `api`, `webhook`, `sms_unknown`, `direct_booking`, `reactivation_campaign`, `cliniko_sync`, `hubspot_sync`
- **call status (`call_outcomes` keys):** `queued`, `ringing`, `in_progress`, `completed`, `failed`, `no_answer`, `busy` (legacy `voicemail` is folded into `no_answer`)
- **call disposition (`call_dispositions` keys):** `interested`, `not_interested`, `callback_requested`, `wrong_number`, `voicemail_left`, `booked`, `dnc`, `no_disposition`
- **booking status (`booking_outcomes` keys):** `scheduled`, `confirmed`, `completed`, `cancelled`, `no_show`
- **conversation channel:** `voice`, `sms`, `email`, `chat`, `imessage` (DM platforms like `instagram`/`whatsapp` ride on the `platform` field)
- **campaign status:** `draft`, `active`, `paused`, `completed`, `archived`

---

## 8. Metric definitions (don't guess — these are the exact semantics)

- **`bookings_rate`** = the "conversion" KPI = (distinct in-window leads with a non-cancelled booking
  **or** `status='booked'`) ÷ total in-window leads. It **excludes** the manual won-deal `converted` status.
- **`converted_count`** = leads in the `converted` stage (manual "won deal"). Distinct from bookings; shown separately on purpose.
- **`calls_total`** = distinct leads that had a *real conversation* (a completed call > 10s, or one in
  progress) — **not** raw call rows. The raw per-day call count is in `/timeseries.series[].calls` and
  `/outcomes.call_outcomes`.
- **`pickup_rate`** = outbound only, lead-level: leads that ever picked up ÷ leads attempted (inbound excluded).
- **`avg_call_duration_sec`** = mean duration over completed conversations only.
- **`spend.total_cents`** = **billed** (customer-charged) voice/call spend for the window;
  `basis: "billed_voice"`. This is what the agency is charged, **not** Olivia's raw provider cost (never
  exposed). A per-category LLM/transcription/SMS split is **not** available; TTS is bundled into voice.
- **Campaign counts** (`/campaigns`) are lifetime-to-date, not period-sliced.
- **Period semantics:** `from`/`to` are inclusive UTC days; day-buckets in `/timeseries` use `tz`.

---

## 9. Worked examples

### 9.1 curl

```bash
KEY="oa_live_..."
BASE="https://www.lunarolivia.com"

# 1) discover clients
curl -s -H "x-api-key: $KEY" "$BASE/api/v1/external/clients?limit=100"

# 2) overview for one client (last 30 days, client tz)
CID="8f3b...uuid"
curl -s -H "x-api-key: $KEY" \
  "$BASE/api/external/v1/clients/$CID/overview"

# 3) leads, page 2, only booked, with PII (key must have dashboard:pii)
curl -s -H "x-api-key: $KEY" \
  "$BASE/api/external/v1/clients/$CID/leads?status=booked&page=2&limit=50"
```

### 9.2 Minimal TypeScript client (server-side)

```ts
// Runs on YOUR backend only. Never expose OLIVIA_API_KEY to the browser.
const BASE = "https://www.lunarolivia.com";
const KEY = process.env.OLIVIA_API_KEY!; // oa_live_...

async function olivia<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();
  const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`, {
    headers: { "x-api-key": KEY },
    // server-to-server; no credentials/CORS
  });
  if (res.status === 429) {
    const retry = Number(res.headers.get("retry-after") ?? "5");
    await new Promise((r) => setTimeout(r, retry * 1000));
    return olivia<T>(path, params); // simple backoff-retry
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Olivia ${res.status} ${body.code ?? ""}: ${body.error ?? res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// Discover clients, then pull each client's overview.
async function loadWorkspaces(from: string, to: string) {
  const { clients } = await olivia<{ clients: { id: string; name: string }[] }>(
    "/api/v1/external/clients",
    { limit: 100 }
  );
  return Promise.all(
    clients.map(async (c) => ({
      client: c,
      overview: await olivia(`/api/external/v1/clients/${c.id}/overview`, { from, to }),
    }))
  );
}
```

### 9.3 Building a client workspace — endpoint → UI mapping

| Dashboard section | Endpoint |
|---|---|
| Hero KPI cards (leads, connect rate, bookings/conversion, spend) | `/overview` |
| Trend charts over time | `/timeseries` |
| Lead funnel bar/stage view | `/funnel` |
| Call outcome & disposition donut/bars | `/outcomes` |
| Per-agent table | `/agents` |
| Reactivation campaign cards | `/campaigns` |
| Leads table (drill-down) | `/leads` (paginate) |
| Call log / conversation log | `/calls`, `/conversations` (paginate) |

---

## 10. Security checklist

- ✅ Store the key in a backend secret store; **never** send it to the browser or embed it in client code.
- ✅ All Olivia calls happen server-side; proxy any data your frontend needs through your own backend.
- ✅ Request `dashboard:pii` only if your product genuinely needs names/contacts/transcripts; otherwise
  use the redacted shape.
- ✅ Always pass a `client_id` your agency owns — a wrong/foreign id returns `404 client_not_found`, never data.
- ✅ Handle `401` (key rotated/revoked), `403` (missing scope), `429` (back off), `400` (fix params).
