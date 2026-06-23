# Branded transactional emails via Resend — design

**Date:** 2026-06-23
**Status:** Approved (brainstorming) → ready for implementation plan
**Author:** Carlitos + Claude

## Summary

Hey Emma sends (or should send) three transactional emails: a **workspace
invitation**, an **agency team invitation**, and a **login magic link**. Today
the invitations send **no email at all** (an admin copies the `/invite/<token>`
link by hand), and the magic link uses Supabase's **default, unbranded GoTrue
email** (rate-limited per DECISIONS.md).

This work introduces one brand-consistent email system in code and routes all
three emails through **Resend**, matching the Hey Emma brand kit. Invitations
are sent directly from the existing server actions; the login magic link is sent
via a **Supabase "Send Email" auth hook** so that *every* GoTrue magic-link
email (login + the post-accept sign-in link) becomes branded automatically.

## Goals

- One source of brand truth for email, living in code (`lib/email/`).
- Branded **workspace invitation** email sent automatically on invite creation.
- Branded **agency team invitation** email sent automatically on team-invite creation.
- Branded **login magic-link** email delivered through Resend via a Supabase auth hook.
- Fail-soft: an email send failure never breaks the underlying action.
- A test path to actually send all three and eyeball them.

## Non-goals (YAGNI)

- Welcome / onboarding emails, digests, password-reset, email-change flows.
- A drag-and-drop template editor or per-tenant theming.
- Migrating to `react-email` (evaluated; rejected for these 3 simple emails).
- Localization / multi-language.

## Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Resend account | Account exists, sending **domain verified**. |
| Login email delivery | **Supabase "Send Email" auth hook → our code → Resend** (full design control). |
| Email scope | Workspace invite · Agency team invite · Login magic link. |
| From address | `Hey Emma <no-reply@heyemma.io>`. |
| Reply-To | A monitored inbox — default `carlos@imperoagency.com`, via `EMAIL_REPLY_TO` (swap to `support@heyemma.io` later). |
| Rendering | Hand-built table-based HTML + inline styles (no heavy deps). |
| Hook host | Next.js Route Handler (shares `lib/email`), **not** a Supabase Edge Function. |

## Brand reference (from the codebase)

- **Logo:** gradient rounded-square mark with 5 equalizer bars + "**Hey** Emma"
  wordmark ("Hey" muted, "Emma" bold ink). Source: `components/brand/Logo.tsx`.
- **Brand gradient:** `linear-gradient(100deg, #6D4AFF 0%, #FF3D77 100%)` (violet → pink).
- **Colors:** warm `#F7F5F2` (canvas), ink `#1A2B2E` (text), muted `#5C6B6D`
  (captions), violet `#6D4AFF` (primary CTA), pink `#FF3D77` (accent), lavender
  `#ECEAF7` (tints/dividers), surface `#FFFFFF`.
- **Type:** Space Grotesk (display), Space Mono (mono eyebrows, uppercase,
  letter-spaced). Email uses web-safe stacks: display →
  `'Space Grotesk', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
  mono → `'Space Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace`.
- **Radii / shadow:** card radius 16px, button radius 12px, soft `0 4px 16px rgba(26,43,46,0.08)`.
- **Footer voice (existing):** "Secured by Supabase · One workspace, your data only".

## Architecture

### `lib/email/` — the brand email system

```
lib/email/
  theme.ts      brand tokens, font stacks, hosted logo URL, from/reply-to, footer
  layout.ts     renderShell(...) -> { html, text } shared chrome (table-based, MSO-safe)
  templates.ts  workspaceInvite(...), teamInvite(...), magicLink(...) -> { subject, html, text }
  send.ts       sendEmail({ to, subject, html, text }) -> Resend SDK wrapper
```

- **`theme.ts`** centralizes every brand constant so the three templates never
  hardcode a hex. Includes `LOGO_PNG_URL` (a hosted PNG of the gradient mark —
  email clients do not render inline SVG reliably; an `<img>` + adjacent text
  wordmark gives an image-blocked-safe lockup), `FROM`, `REPLY_TO`, and the
  footer strings.
- **`layout.ts` `renderShell()`** renders the shared chrome and returns **both**
  an HTML string and a plain-text alternative:
  - Outer warm `#F7F5F2` canvas → centered `~500px` white card (radius 16, soft shadow).
  - Header: logo lockup (gradient mark PNG + "Hey Emma" text fallback).
  - Hidden **preheader** span for inbox preview text.
  - Slots: `eyebrow` (mono uppercase), `heading`, `bodyHtml`, `cta { label, url }`,
    optional `meta`/`helper` lines, footer.
  - **Outlook/MSO safety:** VML/`<!--[if mso]>` button fallback; solid violet
    `bgcolor` fallback wherever a gradient background is used; tables not flexbox.
- **`templates.ts`** builds each email's subject + body slots, delegating chrome
  to `renderShell`.
- **`send.ts`** wraps the `resend` SDK: reads `RESEND_API_KEY`, sends `from` =
  `Hey Emma <no-reply@heyemma.io>`, `reply_to` = `EMAIL_REPLY_TO`. Returns a
  result; callers decide whether a failure is fatal (it never is, here).

### Path 1 — Invitations (application emails)

The `invites` table flow is ours, not GoTrue's, so we send directly:

- In `app/console/actions.ts`:
  - `createInvite(...)` → after inserting the row, build the absolute link
    `${origin}/invite/${token}` and call `sendEmail(workspaceInvite({ to, inviterName, clientName, acceptUrl, email, expiresAt }))`.
  - `createTeamInvite(...)` → same, with `teamInvite(...)` (admin-role copy).
- **Fail-soft:** wrap the send in try/catch. On failure, log and continue — the
  invite row already exists and the console's copy-link UI (`InvitesView`)
  remains the manual fallback. Optionally surface a non-fatal `?sent=0` note on
  redirect so the admin knows to share the link manually.
- Inviter name: derived from the calling admin's user (email or
  `user_metadata.full_name`); fall back to "Your Hey Emma admin".
- Client name: looked up from `olivia_clients` (already fetched for validation).

### Path 2 — Login magic link (Supabase auth hook)

- New Route Handler **`app/api/auth/email-hook/route.ts`** implementing the
  Supabase **Send Email Hook**:
  1. Read the raw body + headers; verify the **Standard Webhooks** signature
     using `SEND_EMAIL_HOOK_SECRET` (`standardwebhooks` package). Invalid → 401.
  2. Parse `{ user, email_data }`. `email_data` provides `token` (6-digit OTP),
     `token_hash`, `email_action_type`, `redirect_to`, `site_url`.
  3. Build the verify URL: `${redirect_to}?token_hash=${token_hash}&type=${email_action_type}`.
     This matches `app/auth/callback/route.ts`, which calls
     `verifyOtp({ type, token_hash })` — **no callback change needed**.
  4. Render `magicLink({ to: user.email, verifyUrl, code: token })` and
     `sendEmail(...)`. Return `200 {}` on success.
  5. On render/send error, return a non-2xx so Supabase surfaces a failure
     (rather than silently "succeeding" with no email). Log the error.
- **Coverage:** once the hook is registered, *all* GoTrue magic-link/OTP emails
  route through it — the login link **and** the post-accept sign-in link emitted
  by `acceptInvite`'s `signInWithOtp`. The handler renders the magic-link
  template for `magiclink`/`email`/`recovery` action types and a safe generic
  "complete your sign-in" variant for any other type.
- **Runtime:** Node.js route handler (needs raw body for signature verification).

### Config / env

New environment variables (add to `.env`, `.env.example`, and Vercel):

| Var | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Resend SDK auth (server-only). |
| `SEND_EMAIL_HOOK_SECRET` | Standard-Webhooks secret shared with the Supabase hook (server-only). |
| `EMAIL_REPLY_TO` | Reply-to address; default `carlos@imperoagency.com`. |

A hosted logo PNG URL is referenced by `theme.ts` (e.g. an asset served from the
production domain). If no stable asset exists yet, add one as part of
implementation; the text wordmark fallback keeps the email readable if the image
is blocked or missing.

New dependencies: `resend`, `standardwebhooks`.

## The three emails

Shared shell for all three: warm canvas · centered white card · logo lockup ·
mono uppercase eyebrow · heading · body · violet rounded-12 CTA · meta + helper
lines · muted footer (security line + "didn't expect this? ignore it" + reply
hint) · hidden preheader · plain-text alternative.

```
┌──────────────────────────────────────┐
│            ◼ Hey Emma                 │  logo lockup
│  ───────────────────────────────────  │
│  WORKSPACE INVITATION        (eyebrow) │
│  You've been invited to Hey Emma       │  heading
│                                        │
│  {Inviter} invited you to the          │  body
│  {ClientName} workspace — your view    │
│  of leads, calls, campaigns & outcomes.│
│                                        │
│        [ Accept your invitation ]      │  violet CTA → /invite/{token}
│                                        │
│  Just for {email} · expires in 7 days  │  meta
│  When you accept, we'll email a        │  helper
│  one-click magic link to sign in.      │
│  ───────────────────────────────────  │
│  Secured by Supabase · ignore if not   │  footer
│  you · reply to this email for help    │
└──────────────────────────────────────┘
```

### 1. Workspace invitation
- **Subject:** `You're invited to {ClientName} on Hey Emma`
- **Preheader:** `{Inviter} added you to the {ClientName} workspace on Hey Emma.`
- **Eyebrow:** `Workspace invitation`
- **Heading:** `You've been invited to Hey Emma`
- **Body:** `{Inviter} invited you to the {ClientName} workspace on Hey Emma — your read-only view of leads, calls, campaigns and outcomes from Olivia.`
- **CTA:** `Accept your invitation` → `{origin}/invite/{token}`
- **Meta:** `This invite is just for {email} and expires in 7 days.`
- **Helper:** `When you accept, we'll email you a one-click magic link to sign in — no password needed.`

### 2. Agency team invitation
- **Subject:** `You're invited to the Hey Emma agency team`
- **Preheader:** `{Inviter} invited you to the Hey Emma console as an admin.`
- **Eyebrow:** `Team invitation`
- **Heading:** `You've been invited to the agency team`
- **Body:** `{Inviter} invited you to join the Hey Emma agency team as an admin — full console access: every client workspace, team management and invites.`
- **CTA:** `Join the team` → `{origin}/invite/{token}`
- **Meta/Helper:** same expiry + magic-link helper as above.

### 3. Login magic link
- **Subject:** `Your Hey Emma sign-in link`
- **Preheader:** `Your one-click link to sign in to Hey Emma.`
- **Eyebrow:** `Sign in`
- **Heading:** `Here's your magic link`
- **Body:** `Click below to sign in to Hey Emma. This link works once and expires soon.`
- **CTA:** `Sign in to Hey Emma` → verify URL
- **Fallback code:** `Or enter this code: {token}` (6-digit OTP from the hook payload), for resilience when the link can't be clicked.
- **Helper:** `If you didn't request this, you can safely ignore this email.`

## Error handling & edge cases

- **Invite send fails:** caught; action still succeeds; copy-link UI is the
  fallback; optional non-fatal note to the admin.
- **Hook signature invalid / missing:** `401`.
- **Unknown auth action type:** render a generic branded "complete your request"
  email with the action URL rather than failing.
- **Image blocked:** text wordmark + alt text keep the email legible.
- **Deliverability:** every email ships a plain-text alternative + hidden
  preheader; sends from the verified domain with a real reply-to.

## Testing

- **`scripts/send-test-emails.ts`** (run via `npx tsx`) renders and sends all
  three templates with sample data to a recipient (default
  `carlos@imperoagency.com`). Eyeball in Gmail (and ideally Outlook).
- **Hook end-to-end:** after the one-time dashboard config, trigger a real
  magic-link login on the deployed preview → confirm the branded email arrives
  and the link signs in via `/auth/callback`.
- **Build/lint:** `npm run build` and `npm run lint` clean.

### One-time manual config (not MCP/CLI-reachable)

Supabase → **Authentication → Hooks → Send Email** → enable, type **HTTPS**,
URL `https://<app-domain>/api/auth/email-hook`, secret = `SEND_EMAIL_HOOK_SECRET`.
(Mirrors the existing one-time redirect-URL config noted in DECISIONS.md.)

## Files touched (anticipated)

- **New:** `lib/email/theme.ts`, `lib/email/layout.ts`, `lib/email/templates.ts`,
  `lib/email/send.ts`, `app/api/auth/email-hook/route.ts`,
  `scripts/send-test-emails.ts`.
- **Edited:** `app/console/actions.ts` (send on invite create),
  `.env.example` (new vars), `package.json` (deps), `DECISIONS.md` (record the
  email system + the one-time hook config).
- **No change needed:** `app/auth/callback/route.ts` (already handles `token_hash`).
