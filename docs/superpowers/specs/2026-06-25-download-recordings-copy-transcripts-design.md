# Download call recordings & copy transcripts/summaries

**Date:** 2026-06-25
**Status:** Approved (design) — ready for implementation planning

## Goal

Let users get Emma's call content out of the dashboard:

1. **Download** a call's audio recording as a real file.
2. **Copy** a call's transcript as clean plain text.
3. **Copy** a chat conversation's summary text.

All three follow the existing design system (Tailwind v4 tokens, custom components, inline-SVG icons, the established button idiom and copied-state feedback). No new dependencies.

## Where the data lives

- `Call` (`lib/types.ts:233`) carries `recording_url?: string | null` and `transcript?: string | null`. These surface in `CallDrawer` (`components/dashboard/log/CallDrawer.tsx`): recording player at lines 105–209, transcript at 212–251.
- `Conversation` (`lib/types.ts:255`) carries only `summary?: string | null` (no recording, no transcript). Chat conversations render as cards in `LogView` (`components/dashboard/log/LogView.tsx:156`), with no detail drawer.

So recordings + transcripts are call-only; summaries are the copyable text for chat conversations.

## Feature 1 — Download recording (server-proxied true download)

### Why a proxy is required

The audio is served **cross-origin with no CORS headers** (documented at `CallDrawer.tsx:17`). Consequently:

- A plain `<a download href={recording_url}>` is **ignored** cross-origin — the browser navigates to / streams the file instead of saving it.
- A client `fetch(recording_url)` is **CORS-blocked**.

A true "Save file" therefore needs a **same-origin route** that fetches the bytes server-side and returns them as an attachment.

### Route

`GET /app/api/calls/[id]/recording/route.ts`

Request shape: `GET /api/calls/<callId>/recording?src=<encodeURIComponent(recording_url)>`

Behavior, in order:

1. **Auth.** Call `getSessionClientId()` (`lib/auth.ts:141`). It throws `AuthError(401)` when unauthenticated; catch and return **401**. (Any thrown `AuthError` maps to its status; everything else → 500.)
2. **Validate `src`.** Parse with `new URL(src)`. Reject (**400**) if it is missing, unparseable, not `https:`, or its `host` is not in the **allowlist** (see below). This is the SSRF / open-proxy guard: the route can only ever fetch the known recording host.
3. **Fetch upstream.** `fetch(src)` server-side. On non-OK or thrown error → **502**.
4. **Stream back.** Pipe `upstream.body` through to the client with:
   - `Content-Type`: passthrough from upstream, fallback `audio/mpeg`.
   - `Content-Length`: passthrough when present.
   - `Content-Disposition: attachment; filename="call-<shortId(id)>.mp3"` (use `shortId` from `lib/format.ts`).
   - `Cache-Control: private, no-store`.
5. Route config: `export const dynamic = "force-dynamic"` and `export const maxDuration = 60`.

`[id]` is used only for the download filename and logging — never to look up data (no by-id endpoint exists; see below).

### Host allowlist

No "fetch one call by id" endpoint exists — `getCalls` (`lib/olivia/api.ts:135`) supports only `DateParams & PageParams` (date range + pagination), no `id` filter. Resolving a call by id server-side would require an unbounded page-scan, which is fragile. Instead we validate the client-supplied `src` against a fixed host allowlist.

**Mechanism:** env var `RECORDING_HOST_ALLOWLIST` — a comma-separated list of allowed hostnames. The route reads it, trims/splits, and checks `url.host` (exact match, case-insensitive) against it. If the env var is unset, fall back to a built-in default list of known Retell recording hosts.

**Verification step (implementation):** the exact CDN host is not in the repo (no fixture; the URL is produced by the Retell-backed Olivia backend). Before this ships, confirm the real host from a production `recording_url` (inspect one real call, or read the host the route logs when it rejects) and set `RECORDING_HOST_ALLOWLIST` accordingly. The route **logs the rejected host** on a 400 so the correct value is easy to capture.

### Why this is safe

- The `recording_url` is **already in the client payload** (it is the `<audio src>` at `CallDrawer.tsx:151`) — the proxy exposes nothing new.
- Recording URLs are unguessable signed URLs scoped to the session's own calls; a user cannot enumerate another tenant's URLs.
- Auth-gate + host allowlist mean the route is **not** a general-purpose proxy: it can only fetch the recording host, and only for logged-in users.

### Accepted trade-off

The signed URL rides in a same-origin query string, so it may appear in access logs. Acceptable because the URL is already non-secret to this authenticated user and is short-lived. Documented here so it is a conscious choice, not an oversight.

### UI

A native `<a href={`/api/calls/${call.id}/recording?src=${encodeURIComponent(call.recording_url)}`} download>` styled as a button (no JS, no blob — native download with browser-managed progress/cancel). Placed **right-aligned on the "Recording" label row** in `CallDrawer`, rendered only when `hasRecording` is true. A small inline download SVG + "Download" label, using the drawer button idiom: `rounded-[8px] border border-ink/10 bg-white px-2.5 py-1.5 font-display text-[12px] font-medium text-ink hover:bg-lavender`.

## Feature 2 — Copy transcript

### Helper

Add `formatTranscript(call)` to `lib/format.ts`:

- Signature: `formatTranscript(call: Pick<Call, "transcript" | "agent" | "lead">): string`.
- Reuses `parseTranscript`. Maps each turn to a line `"<name>: <text>"` where the name is `call.agent ?? "Emma"` for agent turns and `call.lead ?? "Lead"` for lead turns. Joins with `"\n"`.
- Returns `""` when there is no transcript / no turns.

### UI

Reuse the existing `CopyButton` (`components/ui/CopyButton.tsx`) with `value={formatTranscript(call)}`, placed in the **Transcript header row** beside the existing "N turns" count (`CallDrawer.tsx:234`). Rendered only when `turns.length > 0`.

## Feature 3 — Copy conversation summary

### UI

Reuse `CopyButton` in a **compact icon** form on each conversation card in `LogView` (`LogView.tsx:156`), rendered only when `m.summary` is present. Positioned at the right of the card (near the timestamp).

### CopyButton extension (minimal, back-compatible)

Extend `CopyButton` with optional props, preserving all current behavior and call sites:

- `label?: string` (idle text, default `"Copy"`).
- `copiedLabel?: string` (default `"Copied"`).
- `compact?: boolean` — renders an icon-only button (inline copy SVG + a check SVG for the copied state) with an accessible `title` / `aria-label` (e.g. `"Copy summary"`). Non-compact behavior is unchanged.

The existing default-className path stays the default for the text variant.

## Files touched

| File | Change |
| --- | --- |
| `app/api/calls/[id]/recording/route.ts` | **New** — auth + host-allowlist proxy that streams the recording as an attachment |
| `lib/format.ts` | Add `formatTranscript(call)` |
| `components/ui/CopyButton.tsx` | Add optional `label` / `copiedLabel` / `compact` props (back-compatible) |
| `components/dashboard/log/CallDrawer.tsx` | Download button on Recording row; copy button on Transcript row |
| `components/dashboard/log/LogView.tsx` | Compact copy button on conversation cards |

No changes to data fetching, types, or the Olivia service are required (all needed fields already flow through).

## Error / empty states

- No recording (`!hasRecording`) → no download button; existing "No recording" card stays (`CallDrawer.tsx:82`).
- No transcript (`turns.length === 0`) → no copy button; existing empty state stays (`CallDrawer.tsx:218`).
- No summary → no copy button on that card.
- Route: **401** unauthenticated, **400** missing/disallowed `src`, **502** upstream fetch failure.
- Clipboard blocked → existing `CopyButton` no-ops silently (unchanged).

## Testing (manual)

1. Open a call that has a recording → click Download → a `call-<id>.mp3` file saves locally and plays.
2. Open a call with a transcript → Copy → pasted text is clean `Name: line` form matching the turns.
3. Conversations tab → Copy on a card → the summary text is on the clipboard.
4. Open a call with **no** recording / **no** transcript → the respective buttons are absent.
5. Hit `/api/calls/<id>/recording?src=https://evil.example.com/x` → **400** (host not allowlisted); host is logged.
6. Hit the route while logged out → **401**.

## Out of scope (YAGNI)

- Downloading the transcript as a file (request was *copy*).
- Bulk / multi-call export.
- A detail drawer for chat conversations.
- Decoding real audio amplitude for the waveform (still the deterministic progress visualization).
