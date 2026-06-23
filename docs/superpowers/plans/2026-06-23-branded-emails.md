# Branded Transactional Emails (Resend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send brand-consistent workspace-invitation, agency-team-invitation, and login magic-link emails through Resend, designed in code from the Hey Emma brand kit.

**Architecture:** One in-code brand email system (`lib/email/`: theme → layout → templates → send). Invitations send directly from the existing console server actions via the Resend SDK. The login magic link is delivered by a Supabase "Send Email" auth hook (a Next.js Route Handler) so every GoTrue magic-link email — login *and* the post-accept sign-in link — becomes branded automatically.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Supabase Auth (GoTrue), Resend Node SDK, `standardwebhooks` (hook signature verification), `tsx` (dev script runner).

## Global Constraints

- **Brand hex (verbatim):** warm `#F7F5F2`, ink `#1A2B2E`, muted `#5C6B6D`, violet `#6D4AFF`, pink `#FF3D77`, lavender `#ECEAF7`, white `#FFFFFF`. Gradient `linear-gradient(100deg, #6D4AFF 0%, #FF3D77 100%)`.
- **From:** `Hey Emma <no-reply@heyemma.io>`. **Reply-To:** `process.env.EMAIL_REPLY_TO ?? "carlos@imperoagency.com"`.
- **Every email** ships HTML **and** a plain-text alternative, plus a hidden preheader.
- **Header is image-free:** a gradient band (`background-image` gradient) with a solid-violet `bgcolor="#6D4AFF"` Outlook fallback and the white "Hey Emma" wordmark. No external logo asset.
- **Email modules must NOT import `server-only`** — the `tsx` self-test and live-send scripts import them directly. Secrets are read from `process.env` at call time and never returned.
- **Fail-soft:** an email send failure must never break the invite creation action or throw to the user. The console copy-link UI remains the manual fallback.
- **Interpolated user text** (inviter name, client name, email) is HTML-escaped via `escapeHtml`.
- **No new heavy deps** beyond `resend`, `standardwebhooks` (deps) and `tsx` (dev). No `react-email`, no test framework.
- `app/auth/callback/route.ts` already verifies `?token_hash=&type=` — **do not modify it.**

---

## File Structure

- **New:**
  - `lib/email/theme.ts` — brand color/font/footer constants.
  - `lib/email/layout.ts` — `renderShell(...)` shared chrome + `escapeHtml`.
  - `lib/email/templates.ts` — `workspaceInvite`, `teamInvite`, `magicLink`, `buildVerifyUrl`, `SupabaseEmailData`.
  - `lib/email/send.ts` — `sendEmail(...)` Resend wrapper.
  - `app/api/auth/email-hook/route.ts` — Supabase Send Email Hook handler.
  - `scripts/email-selftest.ts` — offline assertions (no network).
  - `scripts/send-test-emails.ts` — live Resend send of all three.
- **Modified:**
  - `app/console/actions.ts` — send invite emails after row insert.
  - `.env.example`, `package.json`, `DECISIONS.md`.

---

### Task 1: Dependencies, env, and npm scripts

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Produces: deps `resend`, `standardwebhooks`; devDep `tsx`; env vars `RESEND_API_KEY`, `SEND_EMAIL_HOOK_SECRET`, `EMAIL_REPLY_TO`; npm scripts `email:selftest`, `email:test-send`.

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install resend standardwebhooks
npm install -D tsx
```
Expected: installs succeed; `package.json` gains the three packages.

- [ ] **Step 2: Add npm scripts**

In `package.json`, add to `"scripts"`:
```json
    "email:selftest": "tsx scripts/email-selftest.ts",
    "email:test-send": "tsx scripts/send-test-emails.ts"
```

- [ ] **Step 3: Add env vars to `.env.example`**

Append to `.env.example`:
```bash

# --- Email (Resend) ---
# Resend API key (SERVER-ONLY). From a verified heyemma.io sender.
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# Where replies to transactional emails go (monitored inbox).
EMAIL_REPLY_TO=carlos@imperoagency.com
# Supabase "Send Email" auth-hook signing secret (Auth → Hooks). Format: v1,whsec_...
SEND_EMAIL_HOOK_SECRET=v1,whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- [ ] **Step 4: Verify build still passes**

Run: `npm run build`
Expected: PASS (no usage yet; deps resolve).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore(email): add resend + standardwebhooks deps, env, scripts"
```

---

### Task 2: Brand theme + shared layout (`renderShell`)

**Files:**
- Create: `lib/email/theme.ts`
- Create: `lib/email/layout.ts`
- Create: `scripts/email-selftest.ts`

**Interfaces:**
- Produces:
  - `theme.ts`: `C` (color map), `GRADIENT`, `FONT_DISPLAY`, `FONT_MONO`, `FOOTER_SECURITY`, `FOOTER_IGNORE`, `APP_NAME`.
  - `layout.ts`: `escapeHtml(s: string): string`; `renderShell(input: ShellInput): { html: string; text: string }` where `ShellInput = { preheader: string; eyebrow: string; heading: string; bodyParagraphs: string[]; cta: { label: string; url: string }; notes?: string[] }`.

- [ ] **Step 1: Write `lib/email/theme.ts`**

```ts
// Brand tokens for transactional emails. Email-safe: hex colors, web-safe font stacks,
// and an image-free gradient header (solid-violet fallback for Outlook).
export const APP_NAME = "Hey Emma";

export const C = {
  warm: "#F7F5F2",
  ink: "#1A2B2E",
  muted: "#5C6B6D",
  violet: "#6D4AFF",
  pink: "#FF3D77",
  lavender: "#ECEAF7",
  white: "#FFFFFF",
} as const;

export const GRADIENT = "linear-gradient(100deg, #6D4AFF 0%, #FF3D77 100%)";

export const FONT_DISPLAY =
  "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const FONT_MONO =
  "'Space Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";

export const FOOTER_SECURITY = "Secured by Supabase · One workspace, your data only";
export const FOOTER_IGNORE =
  "If you weren't expecting this email, you can safely ignore it — replies reach a real person.";
```

- [ ] **Step 2: Write `lib/email/layout.ts`**

```ts
import {
  C,
  FONT_DISPLAY,
  FONT_MONO,
  GRADIENT,
  FOOTER_SECURITY,
  FOOTER_IGNORE,
} from "./theme";

export interface ShellInput {
  preheader: string;
  eyebrow: string;
  heading: string;
  bodyParagraphs: string[];
  cta: { label: string; url: string };
  notes?: string[];
}

/** Escape for HTML text + double-quoted attributes (also turns & into &amp; in URLs). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderShell(input: ShellInput): { html: string; text: string } {
  const href = escapeHtml(input.cta.url);

  const paras = input.bodyParagraphs
    .map(
      (p) =>
        `<p style="margin:16px 0 0 0;font-family:${FONT_DISPLAY};font-size:15px;line-height:1.6;color:${C.muted};">${escapeHtml(p)}</p>`,
    )
    .join("");

  const notes = (input.notes ?? [])
    .map(
      (n) =>
        `<p style="margin:14px 0 0 0;font-family:${FONT_DISPLAY};font-size:13px;line-height:1.55;color:${C.muted};">${escapeHtml(n)}</p>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${C.warm};">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeHtml(input.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.warm};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="500" cellpadding="0" cellspacing="0" style="width:500px;max-width:500px;background:${C.white};border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(26,43,46,0.08);">
<tr><td bgcolor="${C.violet}" align="center" style="background-color:${C.violet};background-image:${GRADIENT};padding:26px 24px;">
<span style="font-family:${FONT_DISPLAY};font-size:20px;font-weight:500;letter-spacing:-0.01em;color:${C.white};"><span style="opacity:0.82;">Hey</span> <strong style="font-weight:700;">Emma</strong></span>
</td></tr>
<tr><td style="padding:34px 36px 0 36px;">
<div style="font-family:${FONT_MONO};font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:${C.muted};">${escapeHtml(input.eyebrow)}</div>
<h1 style="margin:12px 0 0 0;font-family:${FONT_DISPLAY};font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:${C.ink};">${escapeHtml(input.heading)}</h1>
${paras}
</td></tr>
<tr><td style="padding:26px 36px 0 36px;">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:46px;v-text-anchor:middle;width:260px;" arcsize="26%" strokecolor="${C.violet}" fillcolor="${C.violet}">
<w:anchorlock/>
<center style="color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:bold;">${escapeHtml(input.cta.label)}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-- -->
<a href="${href}" style="display:inline-block;background:${C.violet};color:${C.white};font-family:${FONT_DISPLAY};font-size:15px;font-weight:600;text-decoration:none;padding:13px 28px;border-radius:12px;">${escapeHtml(input.cta.label)}</a>
<!--<![endif]-->
</td></tr>
<tr><td style="padding:4px 36px 0 36px;">${notes}</td></tr>
<tr><td style="padding:26px 36px 30px 36px;">
<div style="height:1px;line-height:1px;font-size:1px;background:${C.lavender};">&nbsp;</div>
<p style="margin:18px 0 0 0;font-family:${FONT_DISPLAY};font-size:12.5px;line-height:1.6;color:${C.muted};">${FOOTER_SECURITY}<br>${FOOTER_IGNORE}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    input.heading,
    "",
    ...input.bodyParagraphs,
    "",
    `${input.cta.label}: ${input.cta.url}`,
    ...(input.notes && input.notes.length ? ["", ...input.notes] : []),
    "",
    "—",
    FOOTER_SECURITY,
    FOOTER_IGNORE,
  ].join("\n");

  return { html, text };
}
```

- [ ] **Step 3: Write the failing self-test `scripts/email-selftest.ts`**

```ts
import assert from "node:assert/strict";
import { renderShell } from "../lib/email/layout";

const shell = renderShell({
  preheader: "PRE",
  eyebrow: "EYE",
  heading: "HEAD",
  bodyParagraphs: ["Para one."],
  cta: { label: "GO", url: "https://x.test/go" },
  notes: ["note one"],
});
assert.match(shell.html, /PRE/);
assert.match(shell.html, /EYE/);
assert.match(shell.html, /HEAD/);
assert.match(shell.html, /https:\/\/x\.test\/go/);
assert.match(shell.html, /Secured by Supabase/);
assert.match(shell.html, /note one/);
assert.match(shell.text, /GO: https:\/\/x\.test\/go/);

console.log("email-selftest: all assertions passed");
```

- [ ] **Step 4: Run the self-test**

Run: `npm run email:selftest`
Expected: prints `email-selftest: all assertions passed` and exits 0. (If you run it before Step 2 exists, it fails to resolve `../lib/email/layout` — that is the red state.)

- [ ] **Step 5: Verify build/typecheck**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/email/theme.ts lib/email/layout.ts scripts/email-selftest.ts
git commit -m "feat(email): brand theme + shared renderShell layout"
```

---

### Task 3: Email templates + magic-link URL builder

**Files:**
- Create: `lib/email/templates.ts`
- Modify: `scripts/email-selftest.ts`

**Interfaces:**
- Consumes: `renderShell` from `./layout`.
- Produces:
  - `workspaceInvite(a: WorkspaceInviteArgs): { subject; html; text }`, `WorkspaceInviteArgs = { inviterName; clientName; email; acceptUrl; expiresInDays }`.
  - `teamInvite(a: TeamInviteArgs): { subject; html; text }`, `TeamInviteArgs = { inviterName; email; acceptUrl; expiresInDays }`.
  - `magicLink(a: MagicLinkArgs): { subject; html; text }`, `MagicLinkArgs = { verifyUrl; code }`.
  - `SupabaseEmailData = { token; token_hash; redirect_to; email_action_type; site_url }`.
  - `buildVerifyUrl(d: SupabaseEmailData): string`.

- [ ] **Step 1: Write `lib/email/templates.ts`**

```ts
import { renderShell } from "./layout";

const MAGIC_HELP =
  "When you accept, we'll email you a one-click magic link to sign in — no password needed.";

export interface WorkspaceInviteArgs {
  inviterName: string;
  clientName: string;
  email: string;
  acceptUrl: string;
  expiresInDays: number;
}

export function workspaceInvite(
  a: WorkspaceInviteArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `${a.inviterName} added you to the ${a.clientName} workspace on Hey Emma.`,
    eyebrow: "Workspace invitation",
    heading: "You've been invited to Hey Emma",
    bodyParagraphs: [
      `${a.inviterName} invited you to the ${a.clientName} workspace on Hey Emma — your read-only view of leads, calls, campaigns and outcomes from Olivia.`,
    ],
    cta: { label: "Accept your invitation", url: a.acceptUrl },
    notes: [`This invite is just for ${a.email} and expires in ${a.expiresInDays} days.`, MAGIC_HELP],
  });
  return { subject: `You're invited to ${a.clientName} on Hey Emma`, html, text };
}

export interface TeamInviteArgs {
  inviterName: string;
  email: string;
  acceptUrl: string;
  expiresInDays: number;
}

export function teamInvite(
  a: TeamInviteArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `${a.inviterName} invited you to the Hey Emma console as an admin.`,
    eyebrow: "Team invitation",
    heading: "You've been invited to the agency team",
    bodyParagraphs: [
      `${a.inviterName} invited you to join the Hey Emma agency team as an admin — full console access: every client workspace, team management and invites.`,
    ],
    cta: { label: "Join the team", url: a.acceptUrl },
    notes: [`This invite is just for ${a.email} and expires in ${a.expiresInDays} days.`, MAGIC_HELP],
  });
  return { subject: "You're invited to the Hey Emma agency team", html, text };
}

export interface MagicLinkArgs {
  verifyUrl: string;
  code: string;
}

export function magicLink(
  a: MagicLinkArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: "Your one-click link to sign in to Hey Emma.",
    eyebrow: "Sign in",
    heading: "Here's your magic link",
    bodyParagraphs: ["Click below to sign in to Hey Emma. This link works once and expires soon."],
    cta: { label: "Sign in to Hey Emma", url: a.verifyUrl },
    notes: [
      `Prefer to type it? Enter this code: ${a.code}`,
      "If you didn't request this, you can safely ignore this email.",
    ],
  });
  return { subject: "Your Hey Emma sign-in link", html, text };
}

export interface SupabaseEmailData {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
}

/**
 * Build the verification link that lands on /auth/callback (which calls verifyOtp with
 * { type, token_hash }). Uses the redirect_to Supabase passes (already our callback URL);
 * falls back to site_url + /auth/callback if redirect_to is empty.
 */
export function buildVerifyUrl(d: SupabaseEmailData): string {
  const base = d.redirect_to && d.redirect_to.length > 0 ? d.redirect_to : `${d.site_url}/auth/callback`;
  const u = new URL(base);
  u.searchParams.set("token_hash", d.token_hash);
  u.searchParams.set("type", d.email_action_type);
  return u.toString();
}
```

- [ ] **Step 2: Add failing assertions to `scripts/email-selftest.ts`**

Add these imports at the top (alongside the existing `renderShell` import):
```ts
import {
  workspaceInvite,
  teamInvite,
  magicLink,
  buildVerifyUrl,
} from "../lib/email/templates";
```

Add before the final `console.log`:
```ts
const w = workspaceInvite({
  inviterName: "Carlos",
  clientName: "SOLVI",
  email: "p@co.com",
  acceptUrl: "https://app.test/invite/tok123",
  expiresInDays: 7,
});
assert.equal(w.subject, "You're invited to SOLVI on Hey Emma");
assert.match(w.html, /SOLVI/);
assert.match(w.html, /Accept your invitation/);
assert.match(w.html, /https:\/\/app\.test\/invite\/tok123/);
assert.match(w.html, /p@co\.com/);

const t = teamInvite({
  inviterName: "Carlos",
  email: "p@co.com",
  acceptUrl: "https://app.test/invite/tokTEAM",
  expiresInDays: 7,
});
assert.equal(t.subject, "You're invited to the Hey Emma agency team");
assert.match(t.html, /agency team/);
assert.match(t.html, /tokTEAM/);

const m = magicLink({
  verifyUrl: "https://app.test/auth/callback?token_hash=abc&type=magiclink",
  code: "305805",
});
assert.equal(m.subject, "Your Hey Emma sign-in link");
assert.match(m.html, /Sign in to Hey Emma/);
assert.match(m.html, /305805/);
// & inside the URL must be HTML-escaped in the href attribute
assert.match(m.html, /token_hash=abc&amp;type=magiclink/);

assert.equal(
  buildVerifyUrl({
    token: "305805",
    token_hash: "HASH",
    redirect_to: "https://app.test/auth/callback",
    email_action_type: "magiclink",
    site_url: "https://app.test",
  }),
  "https://app.test/auth/callback?token_hash=HASH&type=magiclink",
);
assert.equal(
  buildVerifyUrl({
    token: "1",
    token_hash: "H2",
    redirect_to: "",
    email_action_type: "email",
    site_url: "https://app.test",
  }),
  "https://app.test/auth/callback?token_hash=H2&type=email",
);
```

- [ ] **Step 3: Run the self-test**

Run: `npm run email:selftest`
Expected: `email-selftest: all assertions passed`, exit 0.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/email/templates.ts scripts/email-selftest.ts
git commit -m "feat(email): workspace/team invite + magic-link templates"
```

---

### Task 4: Resend send wrapper

**Files:**
- Create: `lib/email/send.ts`
- Modify: `scripts/email-selftest.ts`

**Interfaces:**
- Consumes: `resend` package.
- Produces: `sendEmail(input: SendInput): Promise<{ id: string | null; error: string | null }>` where `SendInput = { to: string; subject: string; html: string; text: string }`. Never throws; returns `error: "RESEND_API_KEY is not set"` when the key is missing.

- [ ] **Step 1: Write `lib/email/send.ts`**

```ts
import { Resend } from "resend";

const FROM = "Hey Emma <no-reply@heyemma.io>";

export interface SendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Send one email via Resend. Never throws — returns an error string instead, so callers can
 * fail soft. Reads RESEND_API_KEY and EMAIL_REPLY_TO from the environment at call time.
 */
export async function sendEmail(
  input: SendInput,
): Promise<{ id: string | null; error: string | null }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { id: null, error: "RESEND_API_KEY is not set" };
  const replyTo = process.env.EMAIL_REPLY_TO ?? "carlos@imperoagency.com";
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: input.to,
      replyTo,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (error) return { id: null, error: error.message };
    return { id: data?.id ?? null, error: null };
  } catch (e) {
    return { id: null, error: e instanceof Error ? e.message : "Unknown send error" };
  }
}
```

- [ ] **Step 2: Add a failing assertion (no-key branch) to `scripts/email-selftest.ts`**

Add to the top imports:
```ts
import { sendEmail } from "../lib/email/send";
```

Wrap the no-key check at the end (before the final `console.log`), using an async IIFE so `await` is valid:
```ts
await (async () => {
  const prev = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const r = await sendEmail({ to: "a@b.com", subject: "s", html: "<p>x</p>", text: "x" });
  assert.equal(r.id, null);
  assert.equal(r.error, "RESEND_API_KEY is not set");
  if (prev !== undefined) process.env.RESEND_API_KEY = prev;
})();
```

- [ ] **Step 3: Run the self-test**

Run: `npm run email:selftest`
Expected: `email-selftest: all assertions passed`, exit 0.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/email/send.ts scripts/email-selftest.ts
git commit -m "feat(email): Resend send wrapper (fail-soft)"
```

---

### Task 5: Supabase Send Email Hook route

**Files:**
- Create: `app/api/auth/email-hook/route.ts`

**Interfaces:**
- Consumes: `Webhook` from `standardwebhooks`; `buildVerifyUrl`, `magicLink`, `SupabaseEmailData` from `@/lib/email/templates`; `sendEmail` from `@/lib/email/send`.
- Produces: `POST` handler at `/api/auth/email-hook`. Verifies the Standard-Webhooks signature with `SEND_EMAIL_HOOK_SECRET` (minus its `v1,whsec_` prefix), renders + sends the branded magic-link email, returns `200 {}`. `401` on bad signature, `502` on send failure, `500` if unconfigured.

- [ ] **Step 1: Write `app/api/auth/email-hook/route.ts`**

```ts
import { Webhook } from "standardwebhooks";
import { sendEmail } from "@/lib/email/send";
import { buildVerifyUrl, magicLink, type SupabaseEmailData } from "@/lib/email/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HookPayload {
  user: { email: string };
  email_data: SupabaseEmailData;
}

/**
 * Supabase "Send Email" auth hook. GoTrue POSTs the auth-email payload here whenever it would
 * send a magic-link / OTP email; we render the branded template and send it via Resend. With this
 * hook registered, both the login link and the post-accept sign-in link become branded.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET;
  if (!secret) {
    return Response.json(
      { error: { http_code: 500, message: "Email hook not configured" } },
      { status: 500 },
    );
  }

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);

  let body: HookPayload;
  try {
    const wh = new Webhook(secret.replace("v1,whsec_", ""));
    body = wh.verify(payload, headers) as HookPayload;
  } catch {
    return Response.json(
      { error: { http_code: 401, message: "Invalid signature" } },
      { status: 401 },
    );
  }

  const { user, email_data } = body;

  // Only link-bearing auth emails carry a token_hash. Notification-type hooks (not enabled in
  // this app) have none — acknowledge without sending rather than mailing a broken link.
  if (!email_data?.token_hash) return Response.json({}, { status: 200 });

  const { subject, html, text } = magicLink({
    verifyUrl: buildVerifyUrl(email_data),
    code: email_data.token,
  });
  const { error } = await sendEmail({ to: user.email, subject, html, text });
  if (error) {
    return Response.json({ error: { http_code: 502, message: error } }, { status: 502 });
  }
  return Response.json({}, { status: 200 });
}
```

- [ ] **Step 2: Verify build/typecheck**

Run: `npm run build`
Expected: PASS; build output lists the `/api/auth/email-hook` route.

- [ ] **Step 3: Smoke-test the unconfigured + bad-signature paths**

Run (in one terminal): `npm run dev`
Run (in another):
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/auth/email-hook \
  -H "content-type: application/json" -d '{}'
```
Expected: `500` if `SEND_EMAIL_HOOK_SECRET` is unset locally, or `401` (invalid signature) if it is set. Either confirms the guard order works. Stop `npm run dev` after.

- [ ] **Step 4: Commit**

```bash
git add app/api/auth/email-hook/route.ts
git commit -m "feat(email): Supabase send-email auth hook -> branded magic link"
```

---

### Task 6: Send invitation emails from the console actions

**Files:**
- Modify: `app/console/actions.ts`

**Interfaces:**
- Consumes: `getRequestOrigin` from `@/lib/origin`; `sendEmail` from `@/lib/email/send`; `workspaceInvite`, `teamInvite` from `@/lib/email/templates`. `ctx.userName` (inviter), `ctx.userId`, `ctx.activeClientId` from `requireAdmin()`.
- Produces: `createInvite` sends a `workspaceInvite` email; `createTeamInvite` sends a `teamInvite` email. Both fail-soft (errors logged, action still redirects).

- [ ] **Step 1: Add imports to `app/console/actions.ts`**

Below the existing imports, add:
```ts
import { getRequestOrigin } from "@/lib/origin";
import { sendEmail } from "@/lib/email/send";
import { teamInvite, workspaceInvite } from "@/lib/email/templates";
```

- [ ] **Step 2: In `createInvite`, include the client name in the lookup**

Replace:
```ts
  const admin = createAdminClient();
  const { data: client } = await admin
    .from("olivia_clients")
    .select("olivia_client_id")
    .eq("olivia_client_id", clientId)
    .maybeSingle();
  if (!client) redirect("/console/invites?error=client");
```
with:
```ts
  const admin = createAdminClient();
  const { data: client } = await admin
    .from("olivia_clients")
    .select("olivia_client_id, name")
    .eq("olivia_client_id", clientId)
    .maybeSingle();
  if (!client) redirect("/console/invites?error=client");
```

- [ ] **Step 3: In `createInvite`, send the email after insert (before the redirect)**

Replace the trailing:
```ts
  await admin.from("invites").insert({
    token,
    olivia_client_id: clientId,
    email,
    role: "member",
    invited_by: ctx.userId,
    expires_at: expiresAt,
  });

  redirect("/console/invites");
```
with:
```ts
  await admin.from("invites").insert({
    token,
    olivia_client_id: clientId,
    email,
    role: "member",
    invited_by: ctx.userId,
    expires_at: expiresAt,
  });

  // Fail-soft: a send error must not block invite creation — the copy-link UI remains the fallback.
  try {
    const origin = await getRequestOrigin();
    const { subject, html, text } = workspaceInvite({
      inviterName: ctx.userName,
      clientName: (client.name as string | null) ?? clientId,
      email,
      acceptUrl: `${origin}/invite/${token}`,
      expiresInDays: INVITE_TTL_DAYS,
    });
    const { error } = await sendEmail({ to: email, subject, html, text });
    if (error) console.error("[invite] workspace email failed:", error);
  } catch (e) {
    console.error("[invite] workspace email threw:", e);
  }

  redirect("/console/invites");
```

- [ ] **Step 4: In `createTeamInvite`, send the email after insert (before the redirect)**

Replace the trailing:
```ts
  await admin.from("invites").insert({
    token,
    olivia_client_id: ctx.activeClientId, // anchor home client; admins switch across all
    email,
    role: "platform_admin",
    invited_by: ctx.userId,
    expires_at: expiresAt,
  });

  redirect("/console/team");
```
with:
```ts
  await admin.from("invites").insert({
    token,
    olivia_client_id: ctx.activeClientId, // anchor home client; admins switch across all
    email,
    role: "platform_admin",
    invited_by: ctx.userId,
    expires_at: expiresAt,
  });

  // Fail-soft: a send error must not block invite creation — the copy-link UI remains the fallback.
  try {
    const origin = await getRequestOrigin();
    const { subject, html, text } = teamInvite({
      inviterName: ctx.userName,
      email,
      acceptUrl: `${origin}/invite/${token}`,
      expiresInDays: INVITE_TTL_DAYS,
    });
    const { error } = await sendEmail({ to: email, subject, html, text });
    if (error) console.error("[invite] team email failed:", error);
  } catch (e) {
    console.error("[invite] team email threw:", e);
  }

  redirect("/console/team");
```

- [ ] **Step 5: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/console/actions.ts
git commit -m "feat(console): email workspace + team invites via Resend (fail-soft)"
```

---

### Task 7: Live test-send script

**Files:**
- Create: `scripts/send-test-emails.ts`

**Interfaces:**
- Consumes: `workspaceInvite`, `teamInvite`, `magicLink` from `../lib/email/templates`; `sendEmail` from `../lib/email/send`. Env: `RESEND_API_KEY` (required), `TEST_EMAIL_TO` (optional), `TEST_ORIGIN` (optional).

- [ ] **Step 1: Write `scripts/send-test-emails.ts`**

```ts
import { sendEmail } from "../lib/email/send";
import { magicLink, teamInvite, workspaceInvite } from "../lib/email/templates";

const TO = process.env.TEST_EMAIL_TO ?? "carlos@imperoagency.com";
const ORIGIN = process.env.TEST_ORIGIN ?? "https://emma-dashboard-blue.vercel.app";

async function main(): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.error("Set RESEND_API_KEY before running (RESEND_API_KEY=... npm run email:test-send).");
    process.exit(1);
  }

  const samples = [
    workspaceInvite({
      inviterName: "Carlos",
      clientName: "SOLVI Dental",
      email: TO,
      acceptUrl: `${ORIGIN}/invite/sample-token-workspace`,
      expiresInDays: 7,
    }),
    teamInvite({
      inviterName: "Carlos",
      email: TO,
      acceptUrl: `${ORIGIN}/invite/sample-token-team`,
      expiresInDays: 7,
    }),
    magicLink({
      verifyUrl: `${ORIGIN}/auth/callback?token_hash=sample-demo-hash&type=magiclink`,
      code: "305805",
    }),
  ];

  for (const s of samples) {
    const { id, error } = await sendEmail({ to: TO, subject: s.subject, html: s.html, text: s.text });
    console.log(error ? `FAILED  ${s.subject}: ${error}` : `sent ${id}  ${s.subject}`);
  }
}

main();
```

- [ ] **Step 2: Verify it typechecks via the offline self-test + build**

Run: `npm run email:selftest && npm run build`
Expected: PASS (self-test still green; build unaffected — scripts/ is outside the Next build).

- [ ] **Step 3: Send the three real emails**

Run (substitute the real key, and optionally your own inbox):
```bash
RESEND_API_KEY="re_..." TEST_EMAIL_TO="carlos@imperoagency.com" npm run email:test-send
```
Expected: three `sent <id> ...` lines (no `FAILED`). Then open the inbox and eyeball all three: gradient header, violet CTA, correct copy/links, and the plain-text version (view source / "show original"). Check on at least one mobile client if possible.

- [ ] **Step 4: Commit**

```bash
git add scripts/send-test-emails.ts package.json
git commit -m "feat(email): live test-send script for the three templates"
```

---

### Task 8: Docs + one-time hook config + end-to-end verification

**Files:**
- Modify: `DECISIONS.md`

**Interfaces:**
- Consumes: a deployed build of this branch (preview or production) reachable by Supabase.
- Produces: documented email system + the one-time Supabase hook config; verified end-to-end magic-link login.

- [ ] **Step 1: Document the email system in `DECISIONS.md`**

Add a new section near the magic-link login notes:
```markdown
### Branded transactional emails (Resend)
- One in-code brand email system in `lib/email/` (theme → layout → templates → send). Image-free
  gradient header + violet CTA; HTML + plain-text + preheader; fail-soft sends.
- **Invitations** (`app/console/actions.ts`): `createInvite` / `createTeamInvite` send a branded
  email via Resend after inserting the row. If the send fails, the invite still exists and the
  console copy-link UI is the manual fallback.
- **Login magic link**: a Supabase "Send Email" auth hook (`app/api/auth/email-hook/route.ts`)
  renders the branded magic link and sends it via Resend. Covers both the login link and the
  post-accept sign-in link. The callback (`/auth/callback`) is unchanged.
- **Env:** `RESEND_API_KEY`, `EMAIL_REPLY_TO`, `SEND_EMAIL_HOOK_SECRET`. From `Hey Emma
  <no-reply@heyemma.io>`, reply-to `carlos@imperoagency.com`.
- **⚠ REQUIRED one-time Supabase config (dashboard):** Authentication → Hooks → **Send Email** →
  enable, type **HTTPS**, URL `https://<app-domain>/api/auth/email-hook`, secret =
  `SEND_EMAIL_HOOK_SECRET`. (Not reachable via MCP/CLI — same class as the redirect-URL config.)
- Test: `npm run email:test-send` (live send of all three); end-to-end magic-link login after the
  hook is configured.
```

- [ ] **Step 2: Set the production env vars**

Ensure `RESEND_API_KEY`, `EMAIL_REPLY_TO`, and `SEND_EMAIL_HOOK_SECRET` are set in Vercel (Project → Settings → Environment Variables) for the target environment. The `SEND_EMAIL_HOOK_SECRET` value must match the secret Supabase generates in the next step (format `v1,whsec_...`).

- [ ] **Step 3: Configure the Supabase Send Email hook (manual, one-time)**

In the Supabase dashboard → **Authentication → Hooks → Send Email Hook**:
- Enable it; type **HTTPS**.
- URL: `https://<deployed-app-domain>/api/auth/email-hook`.
- Copy the generated secret (`v1,whsec_...`) into `SEND_EMAIL_HOOK_SECRET` (Vercel + `.env`), then redeploy so the function has it.

- [ ] **Step 4: End-to-end verification**

- Trigger a real magic-link login: go to `/login`, enter a provisioned email, request the link.
  Expected: the **branded** Hey Emma email arrives (not the default Supabase template); clicking
  the CTA lands on `/auth/callback` and signs in to `/dashboard`.
- In the console, generate a workspace invite to an address you control.
  Expected: the branded **workspace invitation** arrives with a working `/invite/<token>` link.
- (If applicable) generate a team invite and confirm the branded **team invitation** arrives.

- [ ] **Step 5: Commit**

```bash
git add DECISIONS.md
git commit -m "docs(email): record Resend email system + one-time hook config"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** workspace invite (Task 3/6) · team invite (Task 3/6) · login magic link via hook (Task 3/5) · `lib/email/` module (Tasks 2–4) · fail-soft (Task 6) · test path (Task 7) · one-time hook config (Task 8). All spec sections map to a task.
- **Deviation from spec:** the hosted logo PNG is replaced by an **image-free gradient header** (removes an undelivered-asset dependency; documented in Global Constraints). `server-only` is intentionally omitted from email modules so the `tsx` scripts can import them.
- **Type consistency:** `SupabaseEmailData`, `buildVerifyUrl`, `sendEmail`'s `{ id, error }`, and the template `{ subject, html, text }` shape are used identically across Tasks 3–7. Resend `replyTo` (camelCase) and `{ data, error }` return match the SDK. `standardwebhooks` `Webhook(secret).verify(payload, headers)` matches the docs.
- **No placeholders:** every code step contains complete, runnable code; every run step states the exact command and expected result.
