-- Server-only response cache (last-known-good, with fetched_at for the freshness signal
-- and stale-on-error). RLS on, no policies → only the service role can touch it.
create table if not exists public.response_cache (
  cache_key text primary key,
  client_id text not null,
  endpoint text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.response_cache enable row level security;
create index if not exists response_cache_client_idx on public.response_cache (client_id);

-- Cross-instance token-bucket rate governor (atomic via row lock).
create or replace function public.consume_rate_token(
  p_key text,
  p_capacity numeric,
  p_refill_per_sec numeric
) returns boolean
language plpgsql
as $$
declare
  v_tokens numeric;
  v_updated timestamptz;
  v_now timestamptz := clock_timestamp();
  v_elapsed numeric;
begin
  insert into public.api_rate_state (api_key_id, tokens, updated_at)
    values (p_key, p_capacity, v_now)
    on conflict (api_key_id) do nothing;

  select tokens, updated_at into v_tokens, v_updated
    from public.api_rate_state where api_key_id = p_key for update;

  v_elapsed := extract(epoch from (v_now - v_updated));
  v_tokens := least(p_capacity, v_tokens + v_elapsed * p_refill_per_sec);

  if v_tokens >= 1 then
    update public.api_rate_state set tokens = v_tokens - 1, updated_at = v_now where api_key_id = p_key;
    return true;
  else
    update public.api_rate_state set tokens = v_tokens, updated_at = v_now where api_key_id = p_key;
    return false;
  end if;
end;
$$;

-- Single-flight: acquire a lock if free or if the existing one is older than the TTL.
create or replace function public.try_acquire_lock(p_key text, p_ttl_seconds int default 20)
returns boolean
language plpgsql
as $$
declare v_holder uuid := gen_random_uuid();
begin
  insert into public.request_locks (lock_key, holder, acquired_at)
    values (p_key, v_holder, clock_timestamp())
    on conflict (lock_key) do update
      set holder = v_holder, acquired_at = clock_timestamp()
      where public.request_locks.acquired_at < clock_timestamp() - make_interval(secs => p_ttl_seconds);
  return exists (select 1 from public.request_locks where lock_key = p_key and holder = v_holder);
end;
$$;

create or replace function public.release_lock(p_key text)
returns void
language sql
as $$
  delete from public.request_locks where lock_key = p_key;
$$;

revoke all on function public.consume_rate_token(text, numeric, numeric) from public, anon, authenticated;
revoke all on function public.try_acquire_lock(text, int) from public, anon, authenticated;
revoke all on function public.release_lock(text) from public, anon, authenticated;
