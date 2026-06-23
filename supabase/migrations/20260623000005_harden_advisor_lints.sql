-- Hardening per Supabase advisors (pre-existing objects; behavior-preserving).
-- 1. rls_auto_enable is an event-trigger function (not RPC-callable); drop the redundant
--    public EXECUTE grants that tripped the advisor. Event triggers fire as owner regardless.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- 2. Pin the governor/lock functions' search_path. Safe: all table refs are already
--    schema-qualified (public.*) and the rest are pg_catalog built-ins (implicitly available).
alter function public.consume_rate_token(text, numeric, numeric) set search_path = '';
alter function public.try_acquire_lock(text, integer) set search_path = '';
alter function public.release_lock(text) set search_path = '';
