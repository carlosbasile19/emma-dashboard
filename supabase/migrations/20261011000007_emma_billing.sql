-- Stripe billing: platform defaults, per-client config + card mirror, invoices, card-setup
-- links, webhook idempotency and the run log. Every table is service-role only — RLS enabled
-- with NO policies denies anon/authenticated, exactly like `invites`. All money is integer
-- cents; markup is basis points; months are 'YYYY-MM'.
--
-- `livemode` columns: rows written while the app ran on a sandbox key are tagged false. The
-- server ignores a Stripe customer created under the other key mode, so sandbox state can
-- never be charged against live keys.

create table if not exists public.billing_settings (
  id int primary key default 1 check (id = 1),
  markup_bps int not null default 0 check (markup_bps between 0 and 30000),
  fee_cents int not null default 0 check (fee_cents >= 0),
  anchor_day int not null default 3 check (anchor_day between 1 and 28),
  currency text not null default 'usd',
  alert_email text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
comment on table public.billing_settings is 'Platform-wide billing defaults (single row, id = 1).';
insert into public.billing_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.client_billing (
  olivia_client_id text primary key references public.olivia_clients(olivia_client_id),
  enabled boolean not null default false,
  stripe_customer_id text unique,
  stripe_livemode boolean,
  billing_email text,
  bill_from_month text check (bill_from_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- Per-client overrides; null = use billing_settings.
  markup_bps int check (markup_bps between 0 and 30000),
  fee_cents int check (fee_cents >= 0),
  anchor_day int check (anchor_day between 1 and 28),
  -- Mirror of the card on file (Stripe is the source of truth; webhooks keep this current).
  default_payment_method_id text,
  card_brand text,
  card_last4 text,
  card_exp_month int,
  card_exp_year int,
  card_added_at timestamptz,
  card_removed_at timestamptz,
  -- The last due month an admin was emailed "no card on file" for — alert once per month.
  no_card_alerted_month text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
comment on table public.client_billing is 'Per-workspace Stripe billing config + card-on-file mirror.';
create index if not exists client_billing_pm_idx on public.client_billing (default_payment_method_id);

create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  olivia_client_id text not null,
  period_month text not null check (period_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  period_from date,
  period_to date,
  tz text,
  raw_usage_cents int,
  markup_bps int,
  billed_usage_cents int,
  fee_cents int,
  total_cents int,
  currency text not null default 'usd',
  stripe_invoice_id text unique,
  hosted_invoice_url text,
  invoice_pdf_url text,
  -- reserved | open | paid | failed | action_required | void | uncollectible | skipped_zero
  status text not null default 'reserved',
  failure_code text,
  failure_message text,
  trigger text not null default 'cron', -- cron | manual
  created_by uuid references auth.users(id) on delete set null,
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  -- THE idempotency guard: a client-month can never be invoiced twice.
  unique (olivia_client_id, period_month)
);
comment on table public.billing_invoices is 'One row per client per billed month; the (client, month) pair is unique.';
create index if not exists billing_invoices_client_idx on public.billing_invoices (olivia_client_id, period_month desc);

create table if not exists public.billing_setup_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  olivia_client_id text not null,
  created_by uuid references auth.users(id) on delete set null,
  sent_to text,
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'pending', -- pending | completed | revoked
  completed_at timestamptz
);
comment on table public.billing_setup_links is 'Public card-setup links (token-gated, 7-day TTL, reusable until completed).';
create index if not exists billing_setup_links_client_idx on public.billing_setup_links (olivia_client_id);

create table if not exists public.billing_events (
  stripe_event_id text primary key,
  type text not null,
  livemode boolean not null default false,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
comment on table public.billing_events is 'Stripe webhook idempotency: processed events are no-ops on redelivery.';

create table if not exists public.billing_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null, -- cron | manual
  livemode boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb
);
comment on table public.billing_runs is 'One row per billing run with per-client outcomes.';

alter table public.billing_settings enable row level security;
alter table public.client_billing enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_setup_links enable row level security;
alter table public.billing_events enable row level security;
alter table public.billing_runs enable row level security;
-- No policies on purpose: only the service role (server code) may read or write billing data.
