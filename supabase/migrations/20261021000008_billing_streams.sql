-- Billing v2: two charge streams on the client's saved card, an agency-defined service fee,
-- a low-balance threshold and automatic suspension.
--
--   Stream A  credits      AI Power Credits, USD, weekly (every Monday, client tz) for the
--                          previous Mon–Sun, plus early charges when unbilled usage crosses the
--                          client's low-balance threshold.
--   Stream B  service_fee  The agency's retail monthly service fee, AUD or USD, charged IN
--                          ADVANCE on the anchor day (default the 3rd) for that calendar month.
--
-- The wholesale fee the agency pays Emma never enters this schema: `billing_settings.fee_cents`
-- (the old platform-wide fee default) is zeroed and no longer read. The service fee is per client
-- only, so a client with no fee configured is charged no fee.

-- ---- Agency defaults ----
alter table public.billing_settings
  add column if not exists fee_currency text not null default 'usd' check (fee_currency in ('usd', 'aud')),
  add column if not exists low_balance_cents int check (low_balance_cents is null or low_balance_cents > 0);
comment on column public.billing_settings.fee_currency is 'Default currency of the service fee (usd | aud); a client may override it.';
comment on column public.billing_settings.low_balance_cents is 'Default early-charge threshold for unbilled AI Power Credits (USD cents); null = off.';
comment on column public.billing_settings.fee_cents is 'UNUSED since 2026-10-21: the service fee is per client (client_billing.fee_cents).';
update public.billing_settings set fee_cents = 0 where fee_cents <> 0;

-- ---- Per client ----
alter table public.client_billing
  add column if not exists fee_currency text check (fee_currency is null or fee_currency in ('usd', 'aud')),
  -- null = agency default; 0 = threshold off for this client.
  add column if not exists low_balance_cents int check (low_balance_cents is null or low_balance_cents >= 0),
  -- Agency-side billing contact: payment-failure alerts, receipt copies, suspension notices.
  -- null = the agency default (billing_settings.alert_email, else the earliest platform admin).
  add column if not exists agency_contact_email text,
  -- Suspension: set when a charge is still unpaid after its retry; cleared when every unpaid
  -- invoice is settled (or an admin lifts it).
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text,
  add column if not exists suspended_invoice_id uuid,
  -- The upstream platform has no pause API: an admin pauses the client by hand and records it here.
  add column if not exists service_paused_at timestamptz;
comment on column public.client_billing.fee_cents is 'The agency''s retail monthly service fee in fee_currency cents; null = no fee.';

-- ---- Invoices: one row per (client, stream, period) ----
alter table public.billing_invoices
  add column if not exists stream text not null default 'credits' check (stream in ('credits', 'service_fee')),
  -- credits: the period's first day (YYYY-MM-DD); service_fee: the month (YYYY-MM).
  add column if not exists period_key text,
  add column if not exists retry_count int not null default 0,
  add column if not exists next_retry_at timestamptz;
update public.billing_invoices set period_key = period_month where period_key is null;
alter table public.billing_invoices alter column period_key set not null;
alter table public.billing_invoices drop constraint if exists billing_invoices_olivia_client_id_period_month_key;
alter table public.billing_invoices
  add constraint billing_invoices_client_stream_period_key unique (olivia_client_id, stream, period_key);
comment on table public.billing_invoices is 'One row per client per stream per billed period; (client, stream, period_key) is unique.';
create index if not exists billing_invoices_retry_idx on public.billing_invoices (next_retry_at)
  where next_retry_at is not null;
-- `trigger` gains 'threshold' (an early credits charge); the column is free text already.
