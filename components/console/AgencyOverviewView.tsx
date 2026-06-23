import Link from "next/link";
import { initials as toInitials, num } from "@/lib/format";
import type { AgencyOverview } from "@/lib/olivia/agency";

export function AgencyOverviewView({ overview }: { overview: AgencyOverview }) {
  const { totals, leaderboard } = overview;
  const topBookings = Math.max(1, ...leaderboard.map((c) => c.bookings));

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-2 font-display text-[26px] font-bold tracking-[-0.02em]">
        Agency overview
      </div>
      <div className="mb-6 text-[14px] text-muted">
        Every workspace Emma runs, in one view · last 30 days
      </div>

      {/* hero */}
      <div className="relative mb-7 overflow-hidden rounded-[18px] bg-ink px-7 py-7 text-white">
        <div className="pointer-events-none absolute -right-16 -top-28 h-[300px] w-[300px] rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.5),transparent_62%)]" />
        <div className="pointer-events-none absolute -bottom-32 left-[28%] h-[260px] w-[260px] rounded-full bg-[radial-gradient(circle,rgba(255,61,119,0.28),transparent_64%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-[460px]">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-violet-light">
              Agency console · Last 30 days
            </div>
            <div className="text-[27px] font-bold leading-[1.18] tracking-[-0.01em]">
              {num(totals.bookings)} appointments booked across {totals.active} live{" "}
              {totals.active === 1 ? "client" : "clients"}.
            </div>
          </div>
          <div className="flex gap-8">
            <HeroStat value={num(totals.clients)} label="clients" />
            <HeroStat value={num(totals.bookings)} label="bookings · 30d" />
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="mb-7 grid grid-cols-2 gap-3.5 md:grid-cols-5">
        <Kpi label="Clients" value={num(totals.clients)} />
        <Kpi label="Active" value={num(totals.active)} accent />
        <Kpi label="Leads · 30d" value={num(totals.leads)} />
        <Kpi label="Calls · 30d" value={num(totals.calls)} />
        <Kpi label="Bookings · 30d" value={num(totals.bookings)} />
      </div>

      {/* leaderboard */}
      <div className="overflow-hidden rounded-[16px] border border-ink/10 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-ink/10 bg-surface-tint px-[22px] py-3.5">
          <div>
            <div className="font-display text-[15px] font-semibold">Top clients</div>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
              by bookings · 30d
            </div>
          </div>
          <Link
            href="/console/clients"
            className="font-display text-[13px] font-medium text-violet hover:underline"
          >
            All clients →
          </Link>
        </div>
        {leaderboard.length === 0 ? (
          <div className="px-[22px] py-8 text-center text-[13px] text-muted">
            No clients in this agency yet.
          </div>
        ) : (
          leaderboard.slice(0, 6).map((c, i) => (
            <Link
              key={c.id}
              href={`/console/clients/${c.id}`}
              className={`flex items-center gap-3.5 border-b border-lavender px-[22px] py-3 transition-colors hover:bg-lavender ${
                i % 2 ? "bg-lavender/40" : "bg-white"
              }`}
            >
              <span className="w-4 flex-none text-right font-mono text-[12px] text-muted">
                {i + 1}
              </span>
              <span className="bg-gradient-brand flex h-8 w-8 flex-none items-center justify-center rounded-[9px] font-mono text-[11px] font-bold text-white">
                {toInitials(c.name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{c.name}</div>
                <div className="mt-1 h-[6px] w-full overflow-hidden rounded-full bg-lavender">
                  <div
                    className="bg-gradient-brand h-full rounded-full"
                    style={{ width: `${Math.round((c.bookings / topBookings) * 100)}%` }}
                  />
                </div>
              </div>
              <div className="flex-none text-right">
                <div className="font-mono text-[14px] font-bold tabular-nums">{num(c.bookings)}</div>
                <div className="font-mono text-[10px] text-muted">{num(c.leads)} leads</div>
              </div>
            </Link>
          ))
        )}
      </div>

      <div className="mt-3 font-mono text-[12px] text-muted">
        Bookings = appointments booked in the period (Olivia booking outcomes), summed across the
        agency.
      </div>
    </div>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-display text-[34px] font-bold leading-none tracking-[-0.02em]">
        {value}
      </div>
      <div className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-violet-light">
        {label}
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-[13px] border border-ink/10 bg-white px-4 py-3.5 shadow-sm">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
        {label}
      </div>
      <div
        className={`font-display text-[22px] font-bold tracking-[-0.01em] ${
          accent ? "text-violet" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
