# Hey Emma — Dashboard

A **read-only** analytics dashboard that surfaces each client's Olivia workspace —
leads, calls, conversations, campaigns, agents and outcomes — one workspace per
authenticated user.

## Stack

- **Next.js** (App Router) + **TypeScript** (strict)
- **Tailwind CSS v4** (design tokens via `@theme`, no DaisyUI)
- **Supabase** — auth (email/password) + Postgres (workspace mapping, snapshots,
  rate-limiter, single-flight locks)
- **Recharts** for charts
- Deployed on **Vercel**

## How it works

- The dashboard holds **one agency-scoped Olivia API key** (`OLIVIA_API_KEY`,
  server-only). It is never exposed to the browser.
- Each Supabase user maps to exactly **one** Olivia `client_id` (their workspace).
  The server always derives `client_id` from the authenticated session — never from
  anything the browser sends.
- All Olivia calls happen server-side through a typed proxy layer; the frontend only
  talks to Emma's own server routes.

See [`docs/olivia-external-api.md`](docs/olivia-external-api.md) for the authoritative
Olivia API contract and [`DECISIONS.md`](DECISIONS.md) for build decisions.

## Local development

```bash
cp .env.example .env.local   # fill in real values
npm install
npm run dev
```

Required environment variables are documented in [`.env.example`](.env.example).
`OLIVIA_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are **server-only** secrets.
