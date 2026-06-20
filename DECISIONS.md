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

## Removed (Phase 1.5 — ShipFast/DaisyUI strip)

_Recorded as the strip is executed._
