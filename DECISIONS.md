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
