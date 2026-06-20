-- RLS: users can only read their own mapping + their own client row.
-- All writes (and snapshots / rate-state / locks) are service-role only — RLS enabled
-- with no permissive policies denies anon/authenticated; the service role bypasses RLS.

alter table public.workspace_members enable row level security;
alter table public.olivia_clients enable row level security;
alter table public.daily_snapshots enable row level security;
alter table public.api_rate_state enable row level security;
alter table public.request_locks enable row level security;

-- workspace_members: a user may read only their own membership row.
drop policy if exists workspace_members_select_own on public.workspace_members;
create policy workspace_members_select_own
  on public.workspace_members
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- olivia_clients: a user may read only the client row they are mapped to.
drop policy if exists olivia_clients_select_mapped on public.olivia_clients;
create policy olivia_clients_select_mapped
  on public.olivia_clients
  for select
  to authenticated
  using (
    olivia_client_id in (
      select wm.olivia_client_id
      from public.workspace_members wm
      where wm.user_id = (select auth.uid())
    )
  );

-- daily_snapshots / api_rate_state / request_locks: no client-facing policies (server-only).
