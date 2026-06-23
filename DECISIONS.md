# Emma Dashboard — Build Decisions & Assumptions

This log records every assumption, documented default, and intentional deviation made
while building the Emma Dashboard, per the autonomous build brief. Newest phases appended
as work proceeds.

## Stack (locked by brief)

- Next.js App Router + TypeScript (strict) + Tailwind + Supabase (auth + Postgres) +
  Recharts, deployed to Vercel.
- All shared server state (rate governor, single-flight locks, snapshots) lives in
  Supabase Postgres — no Redis / extra infra.
- Fonts: Space Grotesk (display) + Space Mono (mono), from the design.
- Source of truth for the Olivia integration: `docs/olivia-external-api.md`.

## Phase 0 — Preflight (passed)

- **Source-of-truth doc:** `docs/olivia-external-api.md` was missing from the repo;
  hard-stopped and the user supplied its full content, now committed.
- **claude_design MCP:** authorized via `/design-login`.
- **Supabase MCP:** reachable — project `zieagshjnznbmdlfhssr`. `public` schema was empty
  at start (no Emma tables).
- **Vercel MCP:** reachable — team **Impero Agency LLC** (`lunar-growth`,
  `team_56qhLEWmhfLP3slUgS0MYXxj`).
- **GitHub:** no GitHub MCP configured. **Decision (user-confirmed):** use the `gh` CLI +
  git for commits and the final PR (authed as `carlosbasile19`, remote
  `carlosbasile19/emma-dashboard`). Documented default, not a blocker.
- **Secrets:** all five present in local `.env` (`OLIVIA_API_KEY`, `OLIVIA_API_BASE`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
  `.gitignore` covers `.env*`. Vercel-side env is set in Phase 9.

## Key technical decisions

- **Tailwind v4, not v3.** The repo uses Tailwind v4 (`@import "tailwindcss"` +
  `@tailwindcss/postcss`, no `tailwind.config.js`). Design tokens are therefore wired via
  the CSS `@theme` block in `app/globals.css` rather than a `tailwind.config.js` file.
  This satisfies the brief's intent (tokens exposed as Tailwind utilities) the v4 way.
- **TypeScript conversion.** The boilerplate is JavaScript. Since Emma is rewritten from
  the imported design, retained/new files are authored in `.ts`/`.tsx` with a strict
  `tsconfig.json`; `jsconfig.json` is removed.
- **Domain default:** `heyemma.io` (used for branding/metadata where a domain is needed).
- **Middleware:** staying on `middleware.ts` (Next.js 15.5.x). Next 16's `proxy.ts` is not
  used because the project is on Next 15.

## Phase 1.5 — ShipFast/DaisyUI strip (done)

**Dependencies removed** (16 direct; npm removed 129 transitive): `@auth/mongodb-adapter`,
`@headlessui/react`, `axios`, `crisp-sdk-web`, `form-data`, `mongodb`, `mongoose`,
`next-auth`, `next-sitemap`, `nextjs-toploader`, `nodemailer`, `react-hot-toast`,
`react-tooltip`, `resend`, `stripe`, `daisyui`.

**Dependencies added**: `@supabase/supabase-js`, `@supabase/ssr`, `recharts`, `typescript`,
`@types/node`, `@types/react`, `@types/react-dom`.

**Files/dirs deleted** (read-only dashboard needs none of these):
- `app/api/**` — NextAuth route, `/lead`, Stripe (`create-checkout`, `create-portal`), `webhook/stripe`
- `app/blog/**`, `app/privacy-policy`, `app/tos` — marketing/blog/legal pages
- `app/dashboard/**` — ShipFast demo dashboard (rebuilt from the imported design in Phase 2)
- `app/opengraph-image.png`, `app/twitter-image.png` — ShipFast OG art
- `components/**` — all 28 ShipFast marketing/demo components (Hero, Pricing, FAQ, CTA, Testimonials, Footer, Header, Modal, Button*, etc.)
- `libs/**` — `api`, `auth`, `gpt`, `mongo`, `mongoose`, `resend`, `seo`, `stripe`
- `models/**` — Mongoose `Lead`, `User`, `plugins/toJSON`
- `public/blog/**`
- `next-sitemap.config.js`, `jsconfig.json`, `claude-instructions.md`, `.cursorrules`, plus old `middleware.js` / `config.js` (rewritten)

**Files rewritten/added**:
- `config.js` → `config.ts` (Hey Emma branding, `heyemma.io`)
- `app/layout.js` → `app/layout.tsx` (Space Grotesk + Space Mono via `next/font`, metadata, `robots: noindex` for a private dashboard)
- `app/globals.css` — removed `@plugin "daisyui"` + theme block; added Emma design tokens via Tailwind v4 `@theme`
- `next.config.js` — removed MongoDB webpack `IgnorePlugin` block and demo image domains
- `README.md` — rewritten for Hey Emma
- `.eslintrc.json` — `next/core-web-vitals` + `next/typescript` (was `eslint:recommended`, which misfired `no-undef` on TS)
- added `tsconfig.json` (strict, `noUncheckedIndexedAccess`)
- `app/page.tsx`, `app/not-found.tsx`, `app/error.tsx` — minimal clean replacements

**ACCEPT**: `npm run build` green (7 routes). `daisyui` absent from `package.json`, config, classes,
and `node_modules`. No `shipfast` string in product code.

**Deferred / ambiguous (noted, not guessed)**:
- `app/icon.png`, `app/apple-icon.png`, `app/favicon.ico` retained — binary ShipFast app icons. They
  contain no `shipfast` string. The design is HTML/CSS (no favicon asset), so these should be replaced
  with Emma branding assets when provided; left in place rather than deleted to avoid a missing-icon build.
- The only remaining `shipfast` string in the repo is in **this file** (the required removal record).
  Phase 10's `grep -ri shipfast` is therefore scoped to application files, excluding this build log.

## Phase 2 — Import & implement the design (done)

**Import method.** The design lives at the claude.ai/design project `0d1c71dd-…` ("Emma
Dashboard"). The Vercel plugin's `import-claude-design-from-url` needs a *public* file URL
(claude.ai is auth-gated), so it could not fetch it. Used the **`DesignSync` MCP**
(authorized via `/design-login`) to read `Emma Dashboard.dc.html` (the `.dc.html` is a
template-engine bundle: `<sc-if>`/`<sc-for>`/`{{ }}` driven by `support.js`) plus the
brand kit, and re-implemented it as React + plain Tailwind. The design file is a build
input, not committed.

**Tokens.** All design tokens wired into Tailwind v4 `@theme` in `app/globals.css`
(verified present in the compiled CSS): warm `#F7F5F2`, ink `#1A2B2E`, muted `#5C6B6D`,
violet `#6D4AFF`, pink `#FF3D77`, violet-light `#A48BFF`, lavender `#ECEAF7` /
lavender-deep `#C9C2E8`, surface/surface-tint, semantic success/warning/danger/info, an
8-color chart palette, radii sm/md/lg/xl, shadows sm/md/lg/ink, fonts Space Grotesk +
Space Mono, and the 100deg violet→pink gradient. Data-driven colors (badge accents, chart
segments) are applied as inline styles (the value→color map is dynamic); all static chrome
uses token utilities.

**Routes = 9 views + login.** `/login`; `/dashboard` (overview), `/dashboard/trends`,
`/dashboard/funnel`, `/dashboard/outcomes`, `/dashboard/agents`, `/dashboard/campaigns`,
`/dashboard/leads`, `/dashboard/log` (calls & conversations), `/dashboard/design` (the
design-system reference — the 9th view). Persistent sidebar nav (Analytics / Performance /
Records / Reference) + sticky header with the global date-range (7d/30d/90d) and campaign
filter (both URL-param driven). Loading (skeleton) / empty / error states built for every
data view (`components/ui/states/*` + `lib/copy.ts`), plus lead and call drill-down drawers.

**Charts via Recharts** (per the stack): `Sparkline`, `TrendChart` (area+gradient), `Donut`
(with track ring) — styled to match the hand-rolled SVG in the design.

**Data layer.** Placeholder data (`lib/sample-data.ts`) is shaped as the Olivia domain
types (`lib/types.ts`). Pages compose view-models from those domain objects, so Phase 6
swaps the source (sample → live proxy) without touching components.

**Intentionally excluded design-tool artifacts** (not real product UI):
- The **"Preview state" switcher** (live/loading/empty/error toggle) — real states come
  from the fetch lifecycle in Phase 6, not a manual control.
- The login **"preview: default/error"** buttons.
- The **Agency Console** sidebar link → `Emma Console.dc.html` — agency-admin UI is out of
  v1 scope (Phase 7 provisioning is a seed/admin route, no self-serve console).

**KPI deltas.** The overview cards show period-over-period deltas computed from a previous
equal-length period (`buildKpiCards` in `lib/overview.ts`). Phase 6 supplies the real
previous-period `/overview`; sparklines are derived from `/timeseries` where a daily series
exists (calls, pickup rate, bookings, spend) and omitted otherwise — no invented series.

**Build fix.** Wrapped `<Header>` (uses `useSearchParams`) in `<Suspense>` in the dashboard
layout so statically-prerendered views (e.g. `/dashboard/design`) don't hit the CSR-bailout
error. `npm run build` green — 17 routes.

## Phase 3 — Supabase backend, auth & RLS (done)

**Migrations** (applied via the Supabase MCP, also saved in `supabase/migrations/`):
`emma_core_schema` (the 5 tables: `workspace_members`, `olivia_clients`, `daily_snapshots`,
`api_rate_state`, `request_locks`) and `emma_rls_policies`.

**RLS model.** All 5 tables have RLS enabled.
- `workspace_members` — SELECT own row (`user_id = auth.uid()`); writes service-role only.
- `olivia_clients` — SELECT only the row the caller is mapped to; writes service-role only.
- `daily_snapshots` / `api_rate_state` / `request_locks` — RLS on, **no policies** (deny all
  non-service-role). The three `rls_enabled_no_policy` advisor INFOs are intentional (these are
  server-only tables).

**RLS verified behaviourally** (transaction, rolled back): anonymous sees 0, an authenticated
but unmapped user sees 0 (foreign client unreachable), and the mapped user sees exactly their
own client + their own membership row. The `user_id` FK to `auth.users` is enforced.

**Auth wiring.**
- `@supabase/ssr` clients: `lib/supabase/server.ts` (RSC/actions, request-cookie bound),
  `client.ts` (browser), `middleware.ts` (session refresh), and `admin.ts` (service-role,
  `server-only`, bypasses RLS — for Phases 5/7/8).
- Root `middleware.ts` calls `updateSession` to refresh the session and gate routes: public =
  `/login` + `/auth/*`; everything else requires a session (unauth → `/login`, authed on
  `/login` → `/dashboard`). `getUser()` (not `getSession`) validates the JWT server-side.
- `getSessionClientId()` (`lib/auth.ts`) is the single source of tenant identity: validate
  session → `workspace_members` → `olivia_client_id`, throwing `AuthError(401)` (no session) /
  `AuthError(403)` (no mapping). `getWorkspace()` builds the chrome's workspace from the session.
- Email/password sign-in/out via server actions (`app/auth/actions.ts`); `LoginForm` uses
  `useActionState`; the sidebar sign-out posts the `signOut` action.

**Login round-trip** is verified end-to-end in Phase 7, once a real user is seeded (no users
exist yet). The flow is fully wired.

**Pre-existing advisory (not from this build).** The security advisor flags
`public.rls_auto_enable()` — a `SECURITY DEFINER` function callable by `anon`/`authenticated`.
It predates this work and is unrelated to Emma; left untouched and surfaced to the user to
review/revoke rather than modifying a DB object we didn't create.

**Note.** Generated Supabase TS types were not added; server queries use explicit casts. Can be
added later via the MCP if stricter DB typing is wanted.

## Phase 4 — Olivia proxy layer (done, server-only)

`lib/olivia/`:
- `errors.ts` — `OliviaError` + machine codes (`unauthorized` / `forbidden_scope` /
  `client_not_found` / `invalid_date_range` / `invalid_timezone` / `date_range_too_large` /
  `internal_error` / `rate_limited` / `network_error`).
- `client.ts` — `oliviaFetch` (`server-only`): sets `x-api-key`, builds query, retries 429
  honoring `Retry-After` (+ jitter), throws typed errors; `no-store` by default with optional
  `next: { revalidate, tags }` cache hints for Phase 5.
- `api.ts` — typed functions for the two trees: `discoverClients` (`/api/v1/external/clients`)
  and the 9 analytics endpoints (`/api/external/v1/clients/{clientId}/…`). List endpoints
  normalized to `ListResponse<T>`; `/campaigns` takes no date params (lifetime-to-date, §6.6).
- `service.ts` — the ONLY frontend-facing surface. Every function derives `client_id` from
  `getSessionClientId()`; the browser can never choose the client. PII fields stay optional /
  null-guarded throughout (`Lead`/`Call`/`Conversation` types).

**Verified live** against `https://www.lunarolivia.com`: discovery → HTTP 200 (2 clients);
`/overview` → HTTP 200 with a shape matching the `Overview` type exactly. `dashboard:pii` was
inconclusive (the test client has 0 leads); the UI null-guards PII regardless.

**Discovered clients (for Phase 7 provisioning):**
- `9c6d445a-4d4a-465b-aca7-b8108083e529` — "001. SOLVI" (Europe/London)
- `01b1fb8e-2b65-4330-8f0d-ed631afa03bf` — "000. Emma Test Funnel" (Australia/Sydney) ← will
  map the seeded test user to this client.

## Phase 5 — Freshness, caching & rate governance (done)

**Architecture decision (documented deviation).** Made **Supabase Postgres the authoritative
SWR cache + governance layer** instead of the Next.js Data Cache. Rationale: (1) the brief's
hard constraint — *all* shared server state in Supabase, no Redis; (2) a real `fetched_at`
timestamp is needed for the "updated Xm ago" freshness signal and for deterministic
stale-on-error, which Next's opaque cache doesn't expose; (3) the Supabase cache is strictly
server-side + RLS-locked, satisfying "PII list responses cache server-side only — never
CDN/edge/browser." Tag-based invalidation is replaced by `force` re-fetch + the fact that any
filter/date change yields a new cache key.

**`cachedFetch` (`lib/olivia/cache.ts`)** — every service call flows through it:
- Cache key = `clientId::endpoint::stableParams` — includes client_id + endpoint + every param;
  a cached value can never be served to another client_id (tenant isolation).
- Per-endpoint tiers: overview/timeseries/funnel/outcomes = fresh 60s / stale +5m;
  agents/campaigns = 120s / +10m; leads/calls/conversations = 30s / +60s; discovery = 1h / +24h.
- `fresh` window → served from cache, no upstream call.
- stale/expired/force → single-flight refresh (`try_acquire_lock`) + a rate token
  (`consume_rate_token`); concurrent callers await the holder's result or serve stale.
- **Stale-on-error**: upstream error or governor-block → serve last-known-good; error only when
  there is no cached value at all.
- Freshness: returns `WithFreshness<T>` = `{ data, freshness: { fetchedAt, stale } }`.

**Governance** (`lib/olivia/governor.ts` + SQL in `response_cache`/`api_rate_state`/`request_locks`):
- Rate governor: token bucket, **500/min** (margin under Olivia's 600/min-per-key), cross-instance
  via atomic SQL refill+decrement (`for update`). Proven: 510 requests → exactly 500 granted.
- Single-flight: `try_acquire_lock` / `release_lock` (20s TTL). Proven: acquire→deny→release→acquire.
- Helper functions revoked from `anon`/`authenticated` (service-role only).

**Parallel fan-out** is enabled (`Promise.all` over service calls in Phase 6 pages — concurrent,
never serial).

**Manual refresh:** the `force` capability exists in the service layer, but **no refresh button is
added** — the imported design has no such control, and the brief says wire only to controls present
in the design. Date-range/campaign/pagination changes already produce new cache keys → fresh data.

**Verification:** the atomic governor + lock primitives are proven via direct SQL (above);
`cachedFetch` composition is typechecked + reviewed; full concurrent end-to-end behaviour is
verified on the live deploy (Phases 9–10).

## Phase 6 — Wire frontend to live data (done)

- All 9 views now fetch live through the cached, session-scoped service (`lib/olivia/service`):
  overview→/overview, trends→/timeseries, funnel→/funnel, outcomes→/outcomes, agents→/agents,
  campaigns→/campaigns, leads→/leads, log→/calls + /conversations. Pages are now dynamic (`ƒ`).
- **Workspace isolation**: every fetch resolves client_id from `getSessionClientId()` — a user
  only ever sees their mapped client. `getWorkspace()`/`getSessionClientId()` are `cache()`-memoized
  per request so the auth lookup runs once per render.
- **Header** shows the live workspace name from `olivia_clients` (via `getWorkspace`).
- **Date range** (7d/30d/90d, default 30d) → `{from,to,tz}` via `lib/filters` (window capped at
  366d; tz from the workspace, else America/New_York). Changing it re-renders with new params.
- **Pagination** server-side via Olivia `page`/`limit` (leads & calls, limit 25 ≤ 100; conversations
  list limit 50). Lead `status`/`source` filters passed through to the proxy.
- **Campaign filter — presentational only.** The Olivia analytics endpoints expose no campaign
  param (guide §5/§6); only `/campaigns` is per-campaign. The selector is kept (design-faithful) and
  its options come from the live `/campaigns` list, but it does not filter analytics data. Documented
  limitation — would need an upstream API param to function.
- **Parallel fan-out**: overview fetches current + previous-period `/overview` + `/timeseries`
  concurrently (`Promise.all`); the log fetches `/calls` + `/conversations` concurrently.
- **States wired to the fetch lifecycle**: per-route `loading.tsx` → the designed `Skeleton`
  variants; per-view empty + error states (error retry reloads; 429/upstream failure → stale-on-error
  serves cached data with the `FreshnessNote`, only erroring when no cache).
- **Freshness signal**: `FreshnessNote` renders "updated Xm ago" only when serving stale data (the
  design has no permanent freshness slot, so nothing is shown when fresh).
- **PII** rendered null-guarded: leads table shows phone/email or a "PII hidden" pill; the lead and
  call drawers show name/phone/email and recording/transcript/summary when present, otherwise a
  redacted/empty state.
- Removed the now-unused `lib/sample-data.ts`; made `EmptyState`/`ErrorState` client components.
- **Full live render** is verified after Phase 7 (needs a provisioned user) and on the deploy.

## Phase 7 — Provisioning (done)

`scripts/seed.mjs` (service role, idempotent) — run with `node --env-file=.env scripts/seed.mjs`:
(a) calls Olivia discovery and upserts `olivia_clients`; (b) creates/updates a test Supabase user
(`email_confirm: true`) and maps it to one `olivia_client_id` via `workspace_members`. Configurable
via `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` / `SEED_CLIENT_ID`.

**Seeded:** `demo@heyemma.io` → client `01b1fb8e-…` ("000. Emma Test Funnel"). Generated credentials
are written to `.seed-credentials.txt` (**gitignored**, never committed/printed).

**Verified end-to-end** (anon-key sign-in as the seeded user): login **OK**; the user sees exactly
their own `workspace_members` row and **only** their own `olivia_clients` row (the other agency client,
SOLVI, is invisible) — workspace isolation **PASS**. This also satisfies Phase 3's deferred
login-round-trip check.

**No self-serve agency-admin UI in v1** — re-run `scripts/seed.mjs` to (re)provision clients/users.

## Phase 8 — Snapshot seam (scaffolded, OFF)

- `daily_snapshots` table already exists (Phase 3).
- `app/api/cron/snapshot/route.ts` — the cron entrypoint, **disabled by default**: returns
  `{status:"disabled"}` unless `SNAPSHOTS_ENABLED=true`. When enabled it requires `CRON_SECRET`
  (Vercel cron `Authorization: Bearer …`) and runs `runDailySnapshots()`.
- `lib/olivia/snapshots.ts` (inactive): `captureDailySnapshot` (per client/day — only *today's*
  row is ever rewritten, so closed days are immutable), `runDailySnapshots` (iterate
  `olivia_clients`), and `getSnapshotHistory` — the read seam so a future "history from snapshots
  + today live" path composes without refactoring (same domain types as the live path).
- `vercel.json` registers the cron at `/api/cron/snapshot`, daily `5 0 * * *` (UTC) — a harmless
  no-op until activated. Chose `vercel.json` over `vercel.ts` for zero-dependency simplicity.
- `middleware.ts` matcher now excludes `/api` (API routes self-authenticate; the cron uses
  `CRON_SECRET`), so the cron isn't redirected to `/login`.
- `.env.example` documents `SNAPSHOTS_ENABLED` / `CRON_SECRET` (both off).
- **Not activated.**

## Phase 9 — Deploy to Vercel (done, verified live)

- Linked to Vercel project **emma-dashboard** (`prj_pArNAVfSA7hDzxySPyfW7eEXat7D`) under team
  **Impero Agency LLC** (`lunar-growth`). `.vercel/` is gitignored.
- **Env vars**: all five present in Production + Preview (the user had pre-set these on the
  project; my add attempts reported "already exists") and added to Development by the seed step.
  `OLIVIA_API_KEY` + `SUPABASE_SERVICE_ROLE_KEY` are server-only; `OLIVIA_API_BASE`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` round out the set.
- **Cron** registered via `vercel.json` → `/api/cron/snapshot` (disabled no-op).
- **Production deploy green**: `READY` at https://emma-dashboard-blue.vercel.app (build ~35s).
- **Verified on production**:
  - `/` and `/dashboard` (unauth) → `307` → `/login`; `/login` → `200` (renders).
  - `/api/cron/snapshot` → `{status:"disabled"}`.
  - **Authenticated `/dashboard`** (seeded `demo@heyemma.io` session) → `200`, renders the live
    workspace name "000. Emma Test Funnel", KPI labels, and the sidebar nav — i.e. one workspace
    renders live, scoped to the session's client.
  - **No server secret in the client bundle**: the production bundle (9 chunks, 476 KB) and a local
    comprehensive `.next/static` scan both show **0** occurrences of `oa_live` / the Olivia key /
    the service-role key.
- Removed the unused browser Supabase client (`lib/supabase/client.ts`) — all auth is server-side.

## Phase 10 — Verify & PR (done)

Ran a **parallel adversarial audit** (9 independent agents, read-only) against the acceptance
checklist. **All 9 dimensions PASS:**

- ✅ Read-only — Olivia client is GET-only (the only `fetch()` in the repo); no mutating Olivia
  routes/UI; the only writes are to Emma's own Supabase tables.
- ✅ `OLIVIA_API_KEY` + `SUPABASE_SERVICE_ROLE_KEY` referenced only in `server-only` modules; no
  `"use client"` file touches them; `client_id` always from `getSessionClientId()`, never from the
  browser.
- ✅ Workspace isolation — every fetch resolves `client_id` server-side; RLS on all user tables.
- ✅ All 9 views live; date range + pagination + loading/empty/error states wired.
- ✅ Caching tiers match the brief; client-scoped keys; single-flight; ~500/min governor;
  stale-on-error.
- ✅ PII null-guarded; no UI for never-returned fields (cost/notes/intel/custom/provider-ids/
  message bodies).
- ✅ Snapshot seam scaffolded but disabled.
- ✅ No `shipfast` in product code; DaisyUI absent from deps/config/classes.
- ✅ `tsc --noEmit` clean; `next build` green (17 routes).

**Hardening applied from audit concerns:**
- Added `app/dashboard/error.tsx` — a dashboard-scoped error boundary (keeps the shell on an
  unexpected render error).
- The snapshot cron now **fails closed**: when `SNAPSHOTS_ENABLED=true` it requires `CRON_SECRET`
  (500 if missing, 401 on mismatch).

**Noted as intentional / design-faithful (not changed):**
- The conversations tab has no pagination control (the imported design has none); it shows the
  most recent 50. Calls + leads paginate server-side.
- The leads empty state lives inside `LeadsTable` so the filter chrome + "Clear filters" stay
  available.
- `api.discoverClients` is part of the typed proxy surface (Phase 4); the seed script does its own
  discovery fetch (it can't import `server-only` modules).
- The design-system reference page is static (no loading/error files needed).

## Post-v1: Platform admin (cross-client access)

Requested after v1: make `carlos@lunargrowth.com` a **complete platform admin**. Implemented a
`platform_admin` role + a header **workspace switcher** to view ALL agency clients, while keeping
non-admins strictly isolated.

- **Tenant resolution centralized in `getSessionContext()`** (`lib/auth.ts`): members → their single
  client, the active-client cookie is **ignored entirely** (isolation preserved); admins → all
  agency clients listed via the **service role** *after* the admin role is verified from the session,
  with the active client taken from the `emma-active-client` cookie and validated against that set
  (a tampered/foreign id falls back to the home client). The agency key only exposes its own
  clients, so even an admin can't reach a foreign agency's data.
- **`setActiveClient`** server action: admin-gated, validates the target client, sets an httpOnly
  cookie; non-admins are rejected.
- **`WorkspaceSwitcher`** (admins only) replaces the static workspace badge.
- **No RLS relaxation** — admin cross-client reads use the service-role client in server code after
  the role check; RLS stays strict for member sessions.
- `scripts/seed.mjs` gained `SEED_USER_ROLE`. **Seeded `carlos@lunargrowth.com` as `platform_admin`**
  (home client: SOLVI); `demo@heyemma.io` stays a member. Temp passwords are in the gitignored
  `.seed-credentials.txt` — change on first login.
- **Deploy note:** the Vercel build hit a webpack `WasmHash` crash on **build-cache restore**
  (`Cannot read properties of undefined (reading 'length')`). Local builds are clean; resolved with a
  forced no-cache deploy (`vercel deploy --prod --force`). Not a code issue.
- **Verified live on production (all pass):** admin sees the switcher + both clients, default active
  = SOLVI, switching to Test Funnel works; member has no switcher, sees only their client, and a
  tampered `emma-active-client` cookie is ignored (isolation holds).

## Post-launch fix: `{raw}`-wrapped transcript (Calls & Conversations crash)

- **Symptom:** opening a **completed call** in the Calls & Conversations view crashed into the
  dashboard error boundary ("Something went wrong"). Server SSR returned 200; the crash was
  client-side (React error **#31** — "object with keys {raw}").
- **Root cause:** the **live** Olivia API returns `call.transcript` as **`{ raw: "…" }`** (an object),
  not the plain string that `docs/olivia-external-api.md` §6.8 documents. `CallDrawer` rendered
  `{call.transcript}` → React cannot render an object child → crash. (Real SOLVI data also has
  `started_at`/`duration_seconds`/`recording_url`/`transcript`/`callback_notes` null on no-answer
  calls — those were already null-guarded.)
- **Fix:** normalize any `{raw}`-wrapped text field to `string|null` at the proxy boundary
  (`lib/olivia/api.ts` → `flatText`), applied to call `transcript` + `callback_notes` and conversation
  `summary`. Cleared `response_cache` so previously-cached object-shaped payloads re-fetch normalized.
- **Doc discrepancy:** the source doc says `transcript` is a string; the live API wraps it in `{raw}`.
  The proxy adapts to the real shape.
- **Also fixed earlier:** hydration-safe relative timestamps (`suppressHydrationWarning`).
- **Verified in a real headless browser** (admin / SOLVI, 1,902 leads): completed-call drawer +
  recording player, conversations tab + drill-down, and leads drill-down — **all 0 client errors**.
  (Playwright was used only to capture the error and removed afterward.)

## Design update 2: landing page, magic-link login, Brief Emma

Re-pulled the claude.ai design (new `Emma Landing.dc.html`, brief flow, magic-link login).

### Landing page (public `/`)
- `app/page.tsx` is now the public marketing landing (was a redirect to `/dashboard`). Indexable
  (`robots: index` overriding the layout's noindex). `middleware` makes `/` public; Sign-in / CTAs
  point to `/login`. Verified: `/` → 200, public.

### Magic-link login (passwordless)
- `LoginForm`: email → "Email me a magic link" → "Check your inbox" (Resend / use a different email).
  Uses `signInWithOtp({ shouldCreateUser: false, emailRedirectTo: <origin>/auth/callback })`.
- `app/auth/callback/route.ts` exchanges the link (PKCE `code` or `token_hash`) for a session →
  `/dashboard`; failures → `/login?error=link`.
- **Password grant is kept at the Supabase API level as a fallback** (no UI) — the seeded users still
  have passwords, so access isn't lost if email delivery has issues.
- **⚠ REQUIRED one-time Supabase config (dashboard) for magic links to complete:**
  Authentication → URL Configuration → **Site URL** = `https://emma-dashboard-blue.vercel.app`;
  **Redirect URLs** add `https://emma-dashboard-blue.vercel.app/auth/callback` (and
  `http://localhost:3000/auth/callback` for dev). Without it the link redirects to the default Site
  URL and won't sign in. Supabase's built-in auth email is also rate-limited — add custom SMTP for
  production volume. (These are GoTrue/project settings not reachable via the MCP/CLI.)
- Verified: login renders the magic-link UI; `signInWithOtp` is accepted (OTP enabled; non-provisioned
  emails return "Signups not allowed" — secure, no auto-signup / enumeration via success).

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

### Brief Emma
- "Brief Emma" button on the overview hero → modal: **form → connecting → live** web-call
  walkthrough. Brief items are derived from **real data** (`buildBriefItems`: new / booked /
  in-progress / converted leads + active campaigns); focus filter (Everything / Bookings / Leads /
  Campaigns); window = the current dashboard range. Campaigns are fetched alongside the overview and
  fail-soft (don't break the page).
- The "web call" is a faithful **UI simulation** (matching the design) — an actual voice brief needs a
  voice backend, which the read-only Olivia API does not provide.
- Fixed an empty-brief case: "new leads to work" is now included (SOLVI's leads are all `new`).
  Verified end-to-end in a browser: button → form → connecting → live, **0 errors**.

## Briefing bridge — client wiring + Retell transport

The dashboard is wired to the (future) Olivia briefing API ahead of the backend:
`oliviaFetch` gained POST; `api.startBriefing`/`endBriefing`; `service.startBriefing`/`endBriefing`
are session-scoped + gated by `OLIVIA_BRIEFING_ENABLED` and fall back to `{ mode: "simulated" }`;
`beginBrief`/`endBrief` server actions; `BriefEmma` calls them (simulation carries the UX until the
backend ships). Full contract in `docs/olivia-briefing-bridge.md`.

**Transport decided: Retell web calls** — Olivia's voice already runs on Retell (`libs/retell.ts`,
`createWebCall`), so `realtime` is `{ provider:"retell", access_token, call_id, sample_rate, expires_at }`
and the browser joins with the Retell **Web** SDK (`retell-client-js-sdk`). The exact, ready-to-enable
connect snippet lives in `BriefEmma.tsx` (`ACTIVATION (briefing-bridge)`); it is intentionally **not
shipped wired** (no unverified SDK dependency added). Activation = `OLIVIA_BRIEFING_ENABLED=true` +
`npm i retell-client-js-sdk` + uncomment the block.
