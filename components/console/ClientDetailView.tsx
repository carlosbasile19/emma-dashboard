import Link from "next/link";
import { setActiveClient } from "@/app/auth/actions";
import { initials as toInitials, num, pct } from "@/lib/format";
import type { ClientDetail } from "@/lib/olivia/agency";

const ROLE_LABEL: Record<string, string> = {
  platform_admin: "Admin",
  member: "Member",
};

export function ClientDetailView({ detail }: { detail: ClientDetail }) {
  const { client, stats, members } = detail;

  return (
    <div className="mx-auto max-w-[1000px]">
      <Link
        href="/console/clients"
        className="mb-4 inline-flex items-center gap-1.5 font-mono text-[12px] text-muted transition-colors hover:text-violet"
      >
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5l-5 5 5 5" />
        </svg>
        Clients
      </Link>

      {/* hero */}
      <div className="relative mb-6 overflow-hidden rounded-[18px] bg-ink px-7 py-6 text-white">
        <div className="pointer-events-none absolute -right-16 -top-28 h-[260px] w-[260px] rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.5),transparent_62%)]" />
        <div className="relative flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-3.5">
            <span className="bg-gradient-brand flex h-12 w-12 flex-none items-center justify-center rounded-[13px] font-mono text-[15px] font-bold text-white">
              {toInitials(client.name)}
            </span>
            <div>
              <div className="text-[24px] font-bold tracking-[-0.01em]">{client.name}</div>
              <div className="mt-1 font-mono text-[11px] tracking-[0.04em] text-violet-light">
                {client.status ?? "—"} · {client.industry ?? "no industry"}
              </div>
            </div>
          </div>
          <form action={setActiveClient}>
            <input type="hidden" name="clientId" value={client.id} />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-[11px] bg-white px-4 py-2.5 font-display text-[13px] font-semibold text-ink transition-transform active:scale-95"
            >
              Open workspace
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 13 13 7" />
                <path d="M7.5 7H13v5.5" />
              </svg>
            </button>
          </form>
        </div>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <Kpi label="Leads · 30d" value={num(stats.leads)} />
        <Kpi label="Calls · 30d" value={num(stats.calls)} />
        <Kpi label="Bookings · 30d" value={num(stats.bookings)} accent />
        <Kpi label="Pickup rate" value={pct(stats.pickupRate)} />
      </div>

      <div className="grid gap-5 md:grid-cols-[1.5fr_1fr]">
        {/* team & access */}
        <div className="overflow-hidden rounded-[16px] border border-ink/10 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-ink/10 bg-surface-tint px-5 py-3.5">
            <div className="font-display text-[14px] font-semibold">Team &amp; access</div>
            <span className="font-mono text-[11px] text-muted">{num(members.length)}</span>
          </div>
          {members.length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-muted">
              No members mapped to this workspace yet.
            </div>
          ) : (
            members.map((m, i) => (
              <div
                key={m.userId}
                className={`flex items-center gap-3 border-b border-lavender px-5 py-3 ${
                  i % 2 ? "bg-lavender/40" : "bg-white"
                }`}
              >
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-lavender-deep bg-lavender font-mono text-[11px] font-bold text-violet">
                  {m.email ? m.email[0]?.toUpperCase() : "?"}
                </span>
                <div className="min-w-0 flex-1 truncate text-[13px] font-medium">
                  {m.email ?? m.userId}
                </div>
                <span className="flex-none rounded-[6px] border border-lavender-deep bg-lavender px-2 py-0.5 font-mono text-[10.5px] text-violet">
                  {ROLE_LABEL[m.role] ?? m.role}
                </span>
              </div>
            ))
          )}
        </div>

        {/* workspace details */}
        <div className="overflow-hidden rounded-[16px] border border-ink/10 bg-white shadow-sm">
          <div className="border-b border-ink/10 bg-surface-tint px-5 py-3.5 font-display text-[14px] font-semibold">
            Workspace details
          </div>
          <div className="flex flex-col">
            <Detail label="Status" value={client.status ?? "—"} />
            <Detail label="Industry" value={client.industry ?? "—"} />
            <Detail label="Timezone" value={client.timezone ?? "—"} mono />
            <Detail label="Members" value={num(members.length)} />
            <Detail label="Client id" value={client.id} mono />
          </div>
        </div>
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

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-lavender px-5 py-3 last:border-0">
      <span className="flex-none text-[12.5px] text-muted">{label}</span>
      <span className={`min-w-0 truncate text-right text-[12.5px] ${mono ? "font-mono" : "font-medium"}`}>
        {value}
      </span>
    </div>
  );
}
