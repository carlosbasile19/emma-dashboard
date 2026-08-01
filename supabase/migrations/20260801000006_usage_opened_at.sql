-- Usage & billing report: record when each workspace was opened.
--
-- The history matrix spans every month since the agency's first workspace. Without an opening
-- date, a month before a client existed renders as $0.00 — which reads as "billed nothing" when
-- the truth is "was not a customer yet". Discovery already returns `created_at`; this stores it
-- so those cells can render blank instead.
--
-- Additive and nullable: rows synced before this migration keep a null opened_at, which the
-- report treats as "unknown opening date" and shows real data for rather than hiding it.
alter table public.olivia_clients
  add column if not exists opened_at timestamptz;

comment on column public.olivia_clients.opened_at is
  'Workspace creation time from Olivia discovery (created_at). Null = unknown; the usage report then blanks no months.';
