# Build prompt — Olivia "Briefing bridge" (voice catch-up for the Hey Emma dashboard)

> Hand this to the Olivia backend team (or paste into your backend AI coding assistant). It
> specifies a **new server-to-server API** that lets the Hey Emma dashboard start a **live voice
> "briefing"** — where Emma web-calls the signed-in user and narrates their catch-up (bookings to
> confirm, new leads to work, leads to chase, conversions, campaign results) for one client and a
> chosen date window. The dashboard already ships the full UI for this (form → connecting → live);
> today it's a simulation. This bridge makes it real.

---

## 1. Context

- **Hey Emma** is a read-only analytics dashboard over Olivia's external API
  (`docs/olivia-external-api.md`). It already renders overview / trends / funnel / outcomes /
  agents / campaigns / leads / calls + conversations per client.
- The dashboard has a **"Brief Emma"** button on the overview. It opens a modal:
  1. **form** — pick a window (date range) + a focus (Everything / Bookings / Leads / Campaigns)
     and shows the agenda items it would cover;
  2. **connecting** — "Starting your briefing…";
  3. **live** — "Emma is briefing you" with the agenda and call controls (mute / re-brief / end).
- Right now steps 2–3 are a UI simulation and the agenda is derived from the existing read-only
  analytics. **We want Emma to actually voice-brief the user over a browser (web) call.**

## 2. What to build

A small **action API** (server-to-server, same auth model as the existing external API) plus a
**realtime voice session** the browser can join:

1. **Start a briefing** → returns the prioritized agenda **and** the credentials to join a live
   voice session where Emma narrates it.
2. **Poll / stream status** → `queued → connecting → live → ended`, plus a running transcript.
3. **End a briefing.**

Emma's voice should use Olivia's existing voice stack (the same one that powers outbound calls) but
in a **web-call / inbound-to-user mode** instead of dialing a phone number — the "customer" on the
call is the agency user, and the script is the analytics narration, not a sales call.

## 3. Conventions (match the existing external API)

- **Base:** `https://www.lunarolivia.com/api/external/v1` (same analytics tree).
- **Auth:** `x-api-key: oa_live_...` header — agency-scoped, server-only (the dashboard never
  exposes it to the browser).
- **Tenant scoping:** every endpoint takes `{clientId}` in the path and **must** enforce that the
  client belongs to the key's agency (`404 client_not_found` otherwise). The dashboard always
  derives `clientId` from the authenticated session — never from the browser.
- **Scope:** add a new scope **`dashboard:brief`** (or reuse `dashboard:read` if you prefer). A key
  lacking it → `403 { "code": "forbidden_scope" }`.
- **Errors:** same envelope `{ "error", "code" }` + HTTP status as the analytics API. **This is the
  one place the API is not read-only** — starting/ending a briefing is an action, but it must never
  mutate the client's leads/calls/analytics; it only creates an ephemeral voice session.
- **Rate limits:** brief sessions are heavy; suggest a low per-key concurrency cap (e.g. ≤ 3
  concurrent live briefings) returning `429` with `Retry-After`.

## 4. Endpoints

### 4.1 Start a briefing
`POST /api/external/v1/clients/{clientId}/briefings`

Body (all optional except where noted):
```json
{
  "from": "2026-05-22",          // YYYY-MM-DD, same rules as analytics (≤366d). default last 30d
  "to": "2026-06-20",
  "tz": "Europe/London",         // IANA tz; defaults to the client's tz
  "focus": "all",                // "all" | "bookings" | "leads" | "campaigns"
  "voice": true                  // false → return the agenda only (no voice session)
}
```

Response `200`:
```json
{
  "briefing_id": "brf_8f3b...",
  "client_id": "8f3b...",
  "status": "connecting",        // queued | connecting | live | ended | failed
  "period": { "from": "2026-05-22", "to": "2026-06-20", "tz": "Europe/London" },
  "agenda": [
    {
      "id": "bookings",
      "category": "bookings",    // bookings | leads | campaigns
      "title": "12 appointments to confirm",
      "detail": "Booked leads awaiting their visit.",
      "priority": 1
    },
    { "id": "new", "category": "leads", "title": "1,000 new leads to work", "detail": "Awaiting first contact.", "priority": 2 }
  ],
  "realtime": {
    "provider": "livekit",       // livekit | vapi | retell | twilio | webrtc | ...
    "url": "wss://...",          // realtime endpoint the browser connects to
    "token": "eyJ...",           // short-lived join token, scoped to THIS briefing only
    "room": "brf_8f3b...",       // room/session id if applicable
    "expires_at": "2026-06-20T12:40:00Z"
  }
}
```
- The **`agenda`** is computed server-side from the same analytics the dashboard shows, filtered by
  `focus` and ordered by `priority` (suggested order: bookings to confirm → new leads to work →
  leads to chase (contacted/qualified) → conversions → campaign results). The dashboard already has
  a local version of this (`buildBriefItems`); the canonical agenda should come from you so the
  voice script and the on-screen list match.
- **`realtime`** must be everything the browser needs to open the audio session and hear Emma. The
  token must be **short-lived and bound to this `briefing_id` + `client_id`** so it can't be replayed
  for another client.
- If `voice:false`, omit `realtime` (the dashboard can show the agenda without a call).

### 4.2 Get briefing status / transcript
`GET /api/external/v1/clients/{clientId}/briefings/{briefingId}`
```json
{
  "briefing_id": "brf_8f3b...",
  "status": "live",
  "current_item_id": "new",            // which agenda item Emma is on (drives "Speaking now")
  "started_at": "2026-06-20T12:36:10Z",
  "ended_at": null,
  "transcript": [
    { "role": "emma", "text": "You've got 12 bookings to confirm this period…", "at": "2026-06-20T12:36:12Z" }
  ]
}
```
A streaming variant (SSE/WebSocket) for `status` + `current_item_id` + transcript deltas would let
the dashboard light up "Speaking now" live; polling every ~2s is an acceptable fallback.

### 4.3 End a briefing
`POST /api/external/v1/clients/{clientId}/briefings/{briefingId}/end` → `200 { "status": "ended" }`

### 4.4 (Optional) Events webhook
`briefing.started` / `briefing.item.changed` / `briefing.ended` / `briefing.failed` with the
`briefing_id` + `client_id`, signed, so the dashboard can react without polling.

## 5. Voice behavior

- Emma greets the user, states the window, then walks the agenda **in priority order**, one item at
  a time, in her normal voice/persona. Keep it ~60–90s for a typical period.
- It's **read-only narration** — Emma never books, edits, or contacts leads during a brief.
- The user can interrupt / ask follow-ups (barge-in) if your voice stack supports it; otherwise a
  linear narration is fine for v1.
- `current_item_id` should track what she's currently saying so the UI can highlight it.

## 6. Security requirements (non-negotiable)

- The agency `x-api-key` stays server-side. The dashboard calls these endpoints from its **own
  backend** only; the browser receives just the short-lived `realtime` join token.
- `briefing_id` and the realtime token are **scoped to a single `client_id`** (the session's
  workspace). A user can never start or join a briefing for another client.
- Tokens expire quickly and are single-session. Ending a briefing (or token expiry) tears down the
  voice session.
- No PII beyond what the analytics API already exposes for that client + scope.

## 7. How the dashboard will integrate (so you know the contract is enough)

Today the dashboard's `BriefEmma` modal does `form → connecting → live` locally. With this bridge it
will, **all server-side via Emma's own backend** (so the agency key is never exposed):
1. On "Start briefing": `POST …/briefings` with `{ from, to, tz, focus }` (clientId from the session).
2. Use the returned `realtime` creds to open the audio session in the browser (your SDK / a thin
   wrapper) → this is the "live" step.
3. Render `agenda` as the on-screen list and use `current_item_id` (poll or stream) to show
   "Speaking now."
4. "End call" → `POST …/briefings/{id}/end`.

## 8. Acceptance

- A request with a valid agency key + a client the key owns returns an `agenda` + working `realtime`
  creds; the browser connects and **hears Emma narrate that client's catch-up**, and only that
  client's.
- A foreign/unknown `clientId` → `404 client_not_found`; a key missing the brief scope → `403`.
- `GET` reflects `queued → connecting → live → ended` and exposes the transcript; `…/end` stops it.
- Starting a brief makes **no writes** to the client's leads/calls/campaigns.

---

*Reference: `docs/olivia-external-api.md` (existing read-only analytics API — same base URL, header,
scopes, client-isolation and error conventions). This briefing bridge is the only action/voice
addition.*
