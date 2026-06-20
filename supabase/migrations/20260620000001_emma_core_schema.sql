-- Emma dashboard core schema.
-- Maps each Supabase user to exactly one Olivia client (their workspace) and holds
-- server-only shared state: snapshots, the cross-instance rate-limiter token bucket,
-- and single-flight request locks.

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  olivia_client_id text not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (user_id)
);
comment on table public.workspace_members is 'Maps a Supabase user to exactly one Olivia client_id (their workspace).';
create index if not exists workspace_members_client_idx on public.workspace_members (olivia_client_id);

create table if not exists public.olivia_clients (
  olivia_client_id text primary key,
  name text,
  slug text,
  status text,
  industry text,
  timezone text,
  synced_at timestamptz not null default now()
);
comment on table public.olivia_clients is 'Cache of Olivia client metadata (from discovery); refreshed periodically.';

create table if not exists public.daily_snapshots (
  client_id text not null,
  date date not null,
  payload jsonb,
  captured_at timestamptz not null default now(),
  primary key (client_id, date)
);
comment on table public.daily_snapshots is 'Per-client daily aggregate snapshots (Phase 8 seam; disabled for now).';

create table if not exists public.api_rate_state (
  api_key_id text primary key,
  tokens numeric not null default 0,
  updated_at timestamptz not null default now()
);
comment on table public.api_rate_state is 'Cross-instance token-bucket state for the Olivia rate governor.';

create table if not exists public.request_locks (
  lock_key text primary key,
  holder uuid,
  acquired_at timestamptz not null default now()
);
comment on table public.request_locks is 'Single-flight locks: collapse concurrent cold-key fetches into one upstream call.';
