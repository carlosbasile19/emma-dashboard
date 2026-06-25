# Download Recordings & Copy Transcripts/Summaries — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users download a call's audio recording as a real file, copy a call's transcript as clean text, and copy a chat conversation's summary — all in the existing design idiom.

**Architecture:** A same-origin Next.js route handler proxies the cross-origin (no-CORS) recording and streams it back as an attachment, guarded by auth + a host allowlist (the SSRF guard lives in a pure, testable `lib/recording.ts`). Transcript text comes from a pure `formatTranscript` helper. Copy actions reuse the existing `CopyButton`, lightly extended with an icon-only `compact` variant. Spec: `docs/superpowers/specs/2026-06-25-download-recordings-copy-transcripts-design.md`.

**Tech Stack:** Next.js 15.5.9 (App Router, async route params), React 19, TypeScript (strict), Tailwind v4. No test framework in repo — pure logic is verified with `npx tsx -e` assertions; UI with `npx tsc --noEmit`, `npm run lint`, and manual browser checks.

## Global Constraints

- Path alias: `@/*` → repo root (`tsconfig.json`). In standalone `tsx` assertions use **relative** imports (`./lib/...`) to avoid alias resolution.
- `tsx -e` compiles to CJS: **no top-level await**, and a dynamic `import("./lib/x.ts")` exposes the module's named exports under `m.default` — destructure via `m.default ?? m` inside a `.then(...)` callback.
- Dynamic route params are async: `{ params }: { params: Promise<{ id: string }> }` then `const { id } = await params;` (matches `app/invite/[token]/page.tsx`).
- No new dependencies. Icons are inline SVG (no icon library). Custom Tailwind components — **not** shadcn.
- Button idiom: `rounded-[8px] border border-ink/10 bg-white px-2.5 py-1.5 font-display text-[12px] font-medium text-ink transition-colors hover:bg-lavender`.
- `CopyButton` changes must stay **back-compatible** — existing call sites pass only `value` (and sometimes `className`) and must keep working unchanged.
- Recording URLs are signed/non-secret-to-this-user and short-lived; the proxy only ever fetches an allowlisted host. Never look data up "by id" — there is no by-id Olivia endpoint.
- Typecheck command: `npx tsc --noEmit`. Lint: `npm run lint`. Full build (final gate): `npm run build`.

---

### Task 0: Branch + commit design docs

**Files:**
- Commit: `docs/superpowers/specs/2026-06-25-download-recordings-copy-transcripts-design.md` (already written)
- Commit: `docs/superpowers/plans/2026-06-25-download-recordings-copy-transcripts.md` (this file)

- [ ] **Step 1: Create a feature branch off master**

Run:
```bash
git checkout -b feat/recording-download-transcript-copy
```

- [ ] **Step 2: Commit the spec and plan**

```bash
git add "docs/superpowers/specs/2026-06-25-download-recordings-copy-transcripts-design.md" \
        "docs/superpowers/plans/2026-06-25-download-recordings-copy-transcripts.md"
git commit -m "docs(log): spec + plan for recording download & transcript/summary copy

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1: Recording host-allowlist guard (`lib/recording.ts`)

The SSRF-critical logic, isolated as pure functions so it can be asserted without a test framework.

**Files:**
- Create: `lib/recording.ts`

**Interfaces:**
- Produces:
  - `allowedRecordingHosts(env?: { RECORDING_HOST_ALLOWLIST?: string }): string[]`
  - `type RecordingSrcCheck = { ok: true; url: URL } | { ok: false; reason: string }`
  - `validateRecordingSrc(src: string | null | undefined, allowedHosts: string[]): RecordingSrcCheck`

- [ ] **Step 1: Write the failing assertion (run before the file exists)**

Run:
```bash
npx tsx -e 'import("./lib/recording.ts").then((m)=>{ const {validateRecordingSrc,allowedRecordingHosts}=m.default??m; const hosts=["recordings.example.com"]; const good=validateRecordingSrc("https://recordings.example.com/a.mp3",hosts); const badHost=validateRecordingSrc("https://evil.internal/x",hosts); const badProto=validateRecordingSrc("http://recordings.example.com/a.mp3",hosts); const nul=validateRecordingSrc(null,hosts); const env=allowedRecordingHosts({RECORDING_HOST_ALLOWLIST:" A.com , b.com "}); if(good.ok!==true||badHost.ok||badProto.ok||nul.ok||JSON.stringify(env)!==JSON.stringify(["a.com","b.com"])){console.error("FAIL",JSON.stringify({good,badHost,badProto,nul,env}));process.exit(1)} console.log("PASS"); }).catch((e)=>{console.error("ERR",e);process.exit(1)})'
```
Expected: FAIL — `Cannot find module './lib/recording.ts'`.

- [ ] **Step 2: Create `lib/recording.ts`**

```ts
// SSRF guard for the recording-download proxy. The recording audio is fetched server-side
// (it is cross-origin with no CORS headers), so the route must only ever fetch a known recording
// host — never an arbitrary client-supplied URL. The allowlist is env-configured
// (RECORDING_HOST_ALLOWLIST = comma-separated hostnames) with a built-in default.
//
// The default host is Retell's recording CDN (the voice backend runs on Retell). Confirm the real
// host from a production `recording_url` and set RECORDING_HOST_ALLOWLIST accordingly — the route
// logs the rejected host on a 400, so a wrong/missing default is easy to spot and fix without code.
const DEFAULT_RECORDING_HOSTS = ["dxc03zgurdly9.cloudfront.net"];

export function allowedRecordingHosts(
  env: { RECORDING_HOST_ALLOWLIST?: string } = process.env,
): string[] {
  const raw = env.RECORDING_HOST_ALLOWLIST?.trim();
  if (!raw) return DEFAULT_RECORDING_HOSTS;
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export type RecordingSrcCheck = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * Validate a client-supplied recording URL before the proxy fetches it. Requires https and a host
 * on the allowlist. On rejection the reason includes the offending host so it can be logged.
 */
export function validateRecordingSrc(
  src: string | null | undefined,
  allowedHosts: string[],
): RecordingSrcCheck {
  if (!src) return { ok: false, reason: "missing src" };
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return { ok: false, reason: "unparseable src" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: `non-https src: ${url.protocol}` };
  }
  if (!allowedHosts.includes(url.host.toLowerCase())) {
    return { ok: false, reason: `host not allowed: ${url.host}` };
  }
  return { ok: true, url };
}
```

- [ ] **Step 3: Run the assertion to verify it passes**

Run:
```bash
npx tsx -e 'import("./lib/recording.ts").then((m)=>{ const {validateRecordingSrc,allowedRecordingHosts}=m.default??m; const hosts=["recordings.example.com"]; const good=validateRecordingSrc("https://recordings.example.com/a.mp3",hosts); const badHost=validateRecordingSrc("https://evil.internal/x",hosts); const badProto=validateRecordingSrc("http://recordings.example.com/a.mp3",hosts); const nul=validateRecordingSrc(null,hosts); const env=allowedRecordingHosts({RECORDING_HOST_ALLOWLIST:" A.com , b.com "}); if(good.ok!==true||badHost.ok||badProto.ok||nul.ok||JSON.stringify(env)!==JSON.stringify(["a.com","b.com"])){console.error("FAIL",JSON.stringify({good,badHost,badProto,nul,env}));process.exit(1)} console.log("PASS"); }).catch((e)=>{console.error("ERR",e);process.exit(1)})'
```
Expected: `PASS`.

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit && git add lib/recording.ts && git commit -m "feat(log): add recording host-allowlist guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Expected: tsc prints nothing (exit 0), commit succeeds.

---

### Task 2: `formatTranscript` helper (`lib/format.ts`)

**Files:**
- Modify: `lib/format.ts` (append after `parseTranscript`, end of file ~line 125)

**Interfaces:**
- Consumes: `parseTranscript` (same file), `type Call` (`@/lib/types`).
- Produces: `formatTranscript(call: Pick<Call, "transcript" | "agent" | "lead">): string`

- [ ] **Step 1: Write the failing assertion**

Run:
```bash
npx tsx -e 'import("./lib/format.ts").then((m)=>{ const {formatTranscript}=m.default??m; const got=formatTranscript({transcript:"Agent: Hi there\nUser: Hello\nback to you", agent:"Emma", lead:"Sam"}); const want="Emma: Hi there\nSam: Hello back to you"; const empty=formatTranscript({transcript:null, agent:null, lead:null}); if(got!==want||empty!==""){console.error("FAIL\nGOT:",JSON.stringify(got),"\nWANT:",JSON.stringify(want),"\nEMPTY:",JSON.stringify(empty));process.exit(1)} console.log("PASS"); }).catch((e)=>{console.error("ERR",e.message);process.exit(1)})'
```
Expected: FAIL — `formatTranscript is not a function` (or undefined).

Note: `parseTranscript` folds the unprefixed `back to you` line into the previous (`User`) turn, so the lead turn text is `Hello back to you`.

- [ ] **Step 2: Add the import for `Call` if not present, and append the helper**

At the top of `lib/format.ts`, ensure the `Call` type is imported. If there is no existing type import, add this near the top (after the file's opening comment):

```ts
import type { Call } from "@/lib/types";
```

Then append at the end of `lib/format.ts`:

```ts
/**
 * Render a call's transcript as plain text for copy/paste: one `Name: line` per turn, agent turns
 * labelled with the agent name (default "Emma") and lead turns with the lead name (default "Lead").
 * Returns "" when there is no transcript. Reuses parseTranscript so the splitting stays in one place.
 */
export function formatTranscript(
  call: Pick<Call, "transcript" | "agent" | "lead">,
): string {
  if (!call.transcript) return "";
  const agentName = call.agent ?? "Emma";
  const leadName = call.lead ?? "Lead";
  return parseTranscript(call.transcript)
    .map((t) => `${t.speaker === "agent" ? agentName : leadName}: ${t.text}`)
    .join("\n");
}
```

- [ ] **Step 3: Run the assertion to verify it passes**

Run:
```bash
npx tsx -e 'import("./lib/format.ts").then((m)=>{ const {formatTranscript}=m.default??m; const got=formatTranscript({transcript:"Agent: Hi there\nUser: Hello\nback to you", agent:"Emma", lead:"Sam"}); const want="Emma: Hi there\nSam: Hello back to you"; const empty=formatTranscript({transcript:null, agent:null, lead:null}); if(got!==want||empty!==""){console.error("FAIL\nGOT:",JSON.stringify(got),"\nWANT:",JSON.stringify(want),"\nEMPTY:",JSON.stringify(empty));process.exit(1)} console.log("PASS"); }).catch((e)=>{console.error("ERR",e.message);process.exit(1)})'
```
Expected: `PASS`.

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit && git add lib/format.ts && git commit -m "feat(log): add formatTranscript plain-text helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Expected: exit 0; commit succeeds.

---

### Task 3: Recording download proxy route

**Files:**
- Create: `app/api/calls/[id]/recording/route.ts`

**Interfaces:**
- Consumes: `getSessionClientId`, `AuthError` (`@/lib/auth`); `shortId` (`@/lib/format`); `allowedRecordingHosts`, `validateRecordingSrc` (`@/lib/recording`).
- Produces: `GET /api/calls/<id>/recording?src=<encoded recording_url>` → streamed attachment, or 401/400/502 JSON.

- [ ] **Step 1: Create the route**

```ts
import { NextResponse } from "next/server";
import { AuthError, getSessionClientId } from "@/lib/auth";
import { shortId } from "@/lib/format";
import { allowedRecordingHosts, validateRecordingSrc } from "@/lib/recording";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Same-origin proxy that streams a call recording back as a downloadable attachment. The audio is
 * served cross-origin without CORS headers, so a client-side download is impossible; this route
 * fetches it server-side. It is auth-gated and only ever fetches an allowlisted host (the SSRF
 * guard) — it never resolves data by id (no such Olivia endpoint exists) and never proxies an
 * arbitrary URL.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Auth — only logged-in users may use the proxy.
  try {
    await getSessionClientId();
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: "unauthorized" }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const src = new URL(request.url).searchParams.get("src");

  // 2. Validate the source URL against the host allowlist (SSRF guard).
  const check = validateRecordingSrc(src, allowedRecordingHosts());
  if (!check.ok) {
    console.warn("[recording] rejected src reason=%s", check.reason);
    return NextResponse.json({ error: "bad_src", message: check.reason }, { status: 400 });
  }

  // 3. Fetch upstream server-side (no CORS constraints here).
  let upstream: Response;
  try {
    upstream = await fetch(check.url, { redirect: "follow" });
  } catch {
    return NextResponse.json({ error: "upstream_unreachable" }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: "upstream_error", status: upstream.status },
      { status: 502 },
    );
  }

  // 4. Stream back as an attachment with a clean filename.
  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("content-type") ?? "audio/mpeg");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  headers.set("Content-Disposition", `attachment; filename="call-${shortId(id)}.mp3"`);
  headers.set("Cache-Control", "private, no-store");
  return new Response(upstream.body, { status: 200, headers });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors for `app/api/calls/[id]/recording/route.ts`.

- [ ] **Step 4: Manual smoke test (unauth + bad host)**

Start the dev server (`npm run dev`) in a separate terminal, then with **no auth cookie**:
```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/calls/abc/recording?src=https://evil.example.com/x"
```
Expected: `401` (auth runs before src validation). To exercise the 400 path, repeat while logged in (cookie present) — expect `400` and a `[recording] rejected src reason=host not allowed: evil.example.com` line in the dev server logs. (Full happy-path download is verified in Task 5 from the UI.)

- [ ] **Step 5: Commit**

```bash
git add "app/api/calls/[id]/recording/route.ts"
git commit -m "feat(log): add auth-gated recording download proxy route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Extend `CopyButton` with `compact` / `label` props

**Files:**
- Modify: `components/ui/CopyButton.tsx` (full rewrite, back-compatible)

**Interfaces:**
- Produces: `CopyButton({ value, className?, label?, copiedLabel?, compact?, title? })`. Defaults: `label="Copy"`, `copiedLabel="Copied"`, `compact=false`. Non-compact, no-extra-props behavior is identical to today.

- [ ] **Step 1: Find existing call sites (must keep compiling)**

Run:
```bash
grep -rn "CopyButton" components app | grep -v "components/ui/CopyButton.tsx"
```
Expected: a short list. Each existing usage passes only `value` (and maybe `className`) — all remain valid because the new props are optional with matching defaults.

- [ ] **Step 2: Rewrite `components/ui/CopyButton.tsx`**

```tsx
"use client";

import { useState } from "react";

const COPY_ICON = (
  <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
    <rect x="7" y="7" width="9" height="9" rx="2" />
    <path d="M13 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h2" />
  </svg>
);

const CHECK_ICON = (
  <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 10.5l3.2 3.2L15 7" />
  </svg>
);

export function CopyButton({
  value,
  className,
  label = "Copy",
  copiedLabel = "Copied",
  compact = false,
  title,
}: {
  value: string;
  className?: string;
  label?: string;
  copiedLabel?: string;
  compact?: boolean;
  title?: string;
}) {
  const [done, setDone] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={copy}
        title={title ?? label}
        aria-label={done ? copiedLabel : (title ?? label)}
        className={
          className ??
          "flex h-7 w-7 flex-none items-center justify-center rounded-[8px] border border-ink/10 bg-white text-muted transition-colors hover:bg-lavender hover:text-violet"
        }
      >
        {done ? CHECK_ICON : COPY_ICON}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={
        className ??
        "flex-none rounded-[8px] border border-ink/10 bg-white px-2.5 py-1.5 font-display text-[12px] font-medium text-ink transition-colors hover:bg-lavender"
      }
    >
      {done ? copiedLabel : label}
    </button>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0; existing call sites still compile.

- [ ] **Step 4: Commit**

```bash
git add components/ui/CopyButton.tsx
git commit -m "feat(ui): add compact icon + label variants to CopyButton

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Download button + transcript copy in `CallDrawer`

**Files:**
- Modify: `components/dashboard/log/CallDrawer.tsx` (imports ~line 5-15; Recording label ~line 78; Transcript header ~line 234-237)

**Interfaces:**
- Consumes: `CopyButton` (`@/components/ui/CopyButton`); `formatTranscript` (`@/lib/format`); existing `hasRecording`, `call`.

- [ ] **Step 1: Add imports**

In the import block at the top of `components/dashboard/log/CallDrawer.tsx`, add `formatTranscript` to the existing `@/lib/format` import and add a `CopyButton` import. The format import currently reads:

```tsx
import {
  initials,
  parseTranscript,
  relTime,
  secToMMSS,
  shortId,
  type TranscriptTurn,
} from "@/lib/format";
```

Change it to include `formatTranscript`:

```tsx
import {
  formatTranscript,
  initials,
  parseTranscript,
  relTime,
  secToMMSS,
  shortId,
  type TranscriptTurn,
} from "@/lib/format";
```

And add below the `Badge` import line:

```tsx
import { CopyButton } from "@/components/ui/CopyButton";
```

- [ ] **Step 2: Add the Download button to the Recording header**

Replace this line (~line 78):

```tsx
          <Label>Recording</Label>
```

with (mirrors the existing Transcript-header pattern — a `mb-2.5 flex` row wrapping the `Label`):

```tsx
          <div className="mb-2.5 flex items-center justify-between">
            <Label>Recording</Label>
            {hasRecording && call.recording_url ? (
              <a
                href={`/api/calls/${call.id}/recording?src=${encodeURIComponent(call.recording_url)}`}
                download
                className="flex flex-none items-center gap-1.5 rounded-[8px] border border-ink/10 bg-white px-2.5 py-1.5 font-display text-[12px] font-medium text-ink transition-colors hover:bg-lavender"
              >
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M10 3v9" />
                  <path d="M6 9.5l4 4 4-4" />
                  <path d="M4 16.5h12" />
                </svg>
                Download
              </a>
            ) : null}
          </div>
```

- [ ] **Step 3: Add the Copy button to the Transcript header**

In the `Transcript` component, replace this block (~line 234-237):

```tsx
      <div className="mb-2.5 flex items-center justify-between">
        <Label>Transcript</Label>
        <span className="font-mono text-[10.5px] text-muted">{turns.length} turns</span>
      </div>
```

with:

```tsx
      <div className="mb-2.5 flex items-center justify-between">
        <Label>Transcript</Label>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[10.5px] text-muted">{turns.length} turns</span>
          <CopyButton value={formatTranscript(call)} />
        </div>
      </div>
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0.

- [ ] **Step 5: Manual browser test**

With the dev server running and logged in, open `/dashboard/log`, click a call **that has a recording**:
- The "Recording" header shows a **Download** button → clicking it saves `call-<id>.mp3` (the file plays). If it 400s, read the dev-server log line `[recording] rejected src reason=host not allowed: <host>` and set `RECORDING_HOST_ALLOWLIST=<host>` in `.env.local`, restart, retry — then record the confirmed host in the spec.
- The "Transcript" header shows a **Copy** button → clicking shows "Copied" and the clipboard holds clean `Name: line` text.
- Open a call with **no** recording / **no** transcript → the respective button is absent.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/log/CallDrawer.tsx
git commit -m "feat(log): download recording + copy transcript in call drawer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Copy summary on conversation cards (`LogView`)

**Files:**
- Modify: `components/dashboard/log/LogView.tsx` (imports ~line 5-8; conversation card ~line 159-186)

**Interfaces:**
- Consumes: `CopyButton` (`@/components/ui/CopyButton`); existing `m.summary`.

- [ ] **Step 1: Add the import**

Below the existing `import { CallDrawer } ...` line near the top of `components/dashboard/log/LogView.tsx`, add:

```tsx
import { CopyButton } from "@/components/ui/CopyButton";
```

- [ ] **Step 2: Add the compact copy button to each conversation card**

In the conversations branch, insert the copy button just before the timestamp `div`. Replace this block (~line 175-185):

```tsx
                {m.status ? (
                  <div className="flex-none">
                    <Badge kind="call" value={m.status} />
                  </div>
                ) : null}
                <div
                  className="w-[90px] flex-none text-right font-mono text-[11px] text-muted"
                  suppressHydrationWarning
                >
                  {relTime(m.started_at)}
                </div>
```

with:

```tsx
                {m.status ? (
                  <div className="flex-none">
                    <Badge kind="call" value={m.status} />
                  </div>
                ) : null}
                {m.summary ? (
                  <CopyButton compact value={m.summary} title="Copy summary" />
                ) : null}
                <div
                  className="w-[90px] flex-none text-right font-mono text-[11px] text-muted"
                  suppressHydrationWarning
                >
                  {relTime(m.started_at)}
                </div>
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0.

- [ ] **Step 4: Manual browser test**

Logged in, open `/dashboard/log?tab=conversations`:
- Each card with a summary shows a small copy icon → clicking it briefly shows the check icon and the summary text is on the clipboard.
- A card with no summary shows no copy icon.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/log/LogView.tsx
git commit -m "feat(log): copy conversation summary from the log cards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Final verification

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: build succeeds with no type or lint errors.

- [ ] **Step 2: Confirm the recording host is configured**

If the happy-path download in Task 5 required setting `RECORDING_HOST_ALLOWLIST`, make sure that variable is set in the deployment environment (Vercel) as well, and that the confirmed host is recorded in the spec's "Host allowlist" section. If the built-in default (`dxc03zgurdly9.cloudfront.net`) worked as-is, note that in the spec.

- [ ] **Step 3: Run through the spec's manual test checklist**

Walk the six scenarios in the spec's "Testing (manual)" section and confirm each passes.

- [ ] **Step 4: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to choose how to integrate (PR vs merge).

---

## Self-Review

**Spec coverage:**
- Download recording (server proxy, auth, host allowlist, attachment, filename) → Tasks 1 + 3 + 5. ✓
- Copy transcript (`formatTranscript` + CopyButton in drawer) → Tasks 2 + 5. ✓
- Copy summary (compact CopyButton in LogView) → Tasks 4 + 6. ✓
- Env-configured allowlist + verification step → Task 1 (mechanism) + Tasks 5/7 (verify & record host). ✓
- Error/empty states (401/400/502; absent buttons when data missing) → Task 3 (route codes) + Tasks 5/6 (conditional render). ✓
- Design-system idiom (button classes, inline SVG, copied feedback) → Global Constraints + Tasks 4/5/6. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command has expected output. ✓

**Type consistency:** `validateRecordingSrc`/`allowedRecordingHosts`/`RecordingSrcCheck` (Task 1) are consumed with identical names/signatures in Task 3. `formatTranscript(call: Pick<Call,...>)` (Task 2) is called with `call` in Task 5. `CopyButton` prop names `compact`/`title`/`label` (Task 4) match usage in Tasks 5/6. ✓
