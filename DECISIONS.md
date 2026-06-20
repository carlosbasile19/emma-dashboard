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
