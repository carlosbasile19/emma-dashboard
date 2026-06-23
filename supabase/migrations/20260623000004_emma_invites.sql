-- Phase 2: workspace invitations. Single-use magic-link tokens, service-role only
-- (the accept flow runs before the invitee is authenticated). RLS enabled with no policies
-- denies anon/authenticated; the service role bypasses RLS.
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  olivia_client_id text not null,
  email text not null,
  role text not null default 'member', -- pending | accepted | revoked
  status text not null default 'pending',
  invited_by uuid references auth.users(id) on delete set null,
  accepted_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz
);
comment on table public.invites is 'Workspace invitations (single-use magic-link tokens). Service-role only.';
create index if not exists invites_client_idx on public.invites (olivia_client_id);
create index if not exists invites_status_idx on public.invites (status);

alter table public.invites enable row level security;
-- No policies on purpose: only the service role (server actions) may read/write invites.
