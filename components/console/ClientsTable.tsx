import { setActiveClient } from "@/app/auth/actions";
import { initials as toInitials, num } from "@/lib/format";
import type { AgencyClientStats } from "@/lib/olivia/agency";

const COLS = "grid-cols-[2fr_1fr_0.8fr_1fr_1fr_1.2fr]";

export function ClientsTable({ clients }: { clients: AgencyClientStats[] }) {
  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-2 font-display text-[26px] font-bold tracking-[-0.02em]">Clients</div>
      <div className="mb-6 text-[14px] text-muted">
        {num(clients.length)} {clients.length === 1 ? "workspace" : "workspaces"} in your agency ·
        open any one to view its dashboard
      </div>

      <div className="overflow-hidden rounded-[16px] border border-ink/10 bg-white shadow-sm">
        <div
          className={`grid ${COLS} gap-3 border-b border-ink/10 bg-surface-tint px-[22px] py-[13px]`}
        >
          {["Client", "Status", "Team", "Leads · 30d", "Bookings"].map((h) => (
            <div
              key={h}
              className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted"
            >
              {h}
            </div>
          ))}
          <div className="text-right font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
            Workspace
          </div>
        </div>

        {clients.length === 0 ? (
          <div className="px-[22px] py-10 text-center text-[13px] text-muted">
            No clients found for this agency.
          </div>
        ) : (
          clients.map((c, i) => (
            <div
              key={c.id}
              className={`grid ${COLS} items-center gap-3 border-b border-lavender px-[22px] py-3 ${
                i % 2 ? "bg-lavender/40" : "bg-white"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="bg-gradient-brand flex h-8 w-8 flex-none items-center justify-center rounded-[9px] font-mono text-[11px] font-bold text-white">
                  {toInitials(c.name)}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-medium">{c.name}</div>
                  <div className="truncate font-mono text-[10.5px] text-muted">
                    {c.industry ?? "—"}
                  </div>
                </div>
              </div>
              <div>
                {c.status ? (
                  <span className="inline-flex rounded-[7px] border border-lavender-deep bg-lavender px-2 py-0.5 font-mono text-[11px] text-violet">
                    {c.status}
                  </span>
                ) : (
                  <span className="font-mono text-[12px] text-muted">—</span>
                )}
              </div>
              <div className="font-mono text-[13px] text-muted tabular-nums">
                {num(c.memberCount)}
              </div>
              <div className="font-mono text-[13px] tabular-nums">{num(c.leads)}</div>
              <div className="font-mono text-[13px] font-semibold tabular-nums">
                {num(c.bookings)}
              </div>
              <div className="flex justify-end">
                <form action={setActiveClient}>
                  <input type="hidden" name="clientId" value={c.id} />
                  <button
                    type="submit"
                    className="bg-gradient-brand inline-flex items-center gap-1.5 rounded-[9px] px-3 py-[7px] font-display text-[12.5px] font-medium text-white transition-transform active:scale-95"
                  >
                    Open workspace
                    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 13 13 7" />
                      <path d="M7.5 7H13v5.5" />
                    </svg>
                  </button>
                </form>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
