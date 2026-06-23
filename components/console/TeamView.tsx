import { createTeamInvite, revokeInvite } from "@/app/console/actions";
import { CopyButton } from "@/components/ui/CopyButton";
import { relTime } from "@/lib/format";
import type { InviteRow, TeamMember } from "@/lib/olivia/agency";

export function TeamView({
  team,
  invites,
  baseUrl,
  currentUserId,
}: {
  team: TeamMember[];
  invites: InviteRow[];
  baseUrl: string;
  currentUserId: string;
}) {
  const pending = invites.filter((i) => i.role === "platform_admin" && i.status === "pending");

  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-2 font-display text-[26px] font-bold tracking-[-0.02em]">Agency team</div>
      <div className="mb-6 text-[14px] text-muted">
        People who can reach the console and every client workspace. Teammates accept with a
        magic-link sign-in.
      </div>

      {/* stats */}
      <div className="mb-7 grid grid-cols-2 gap-3.5 sm:grid-cols-3">
        <Stat label="Active teammates" value={team.length} accent />
        <Stat label="Pending invites" value={pending.length} />
        <Stat label="Admins" value={team.length} />
      </div>

      {/* invite teammate */}
      <form
        action={createTeamInvite}
        className="mb-7 flex flex-wrap items-end gap-3 rounded-[16px] border border-ink/10 bg-white px-5 py-4 shadow-sm"
      >
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
            Teammate email
          </label>
          <input
            type="email"
            name="email"
            required
            placeholder="teammate@youragency.com"
            className="w-full rounded-[10px] border border-ink/10 bg-white px-3 py-2 font-display text-[13px] text-ink placeholder:text-muted/60"
          />
        </div>
        <button
          type="submit"
          className="bg-gradient-brand rounded-[10px] px-4 py-2 font-display text-[13px] font-semibold text-white transition-transform active:scale-95"
        >
          Invite teammate
        </button>
      </form>
      <div className="-mt-4 mb-7 font-mono text-[11.5px] text-muted">
        Teammates get <span className="text-violet">admin</span> access (console + all clients).
      </div>

      {/* pending */}
      {pending.length > 0 ? (
        <>
          <div className="mb-3 flex items-center gap-2">
            <span className="font-display text-[15px] font-semibold">Pending</span>
            <span className="rounded-full bg-lavender px-2 py-0.5 font-mono text-[11px] text-violet">
              {pending.length}
            </span>
          </div>
          <div className="mb-8 flex flex-col gap-2.5">
            {pending.map((inv) => {
              const link = `${baseUrl}/invite/${inv.token}`;
              return (
                <div
                  key={inv.id}
                  className="rounded-[14px] border border-ink/10 bg-white px-5 py-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-medium">{inv.email}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted">
                        Admin · expires{" "}
                        <span suppressHydrationWarning>{relTime(inv.expiresAt)}</span>
                      </div>
                    </div>
                    <form action={revokeInvite}>
                      <input type="hidden" name="id" value={inv.id} />
                      <input type="hidden" name="returnTo" value="/console/team" />
                      <button
                        type="submit"
                        className="rounded-[8px] border border-ink/10 bg-white px-2.5 py-1.5 font-display text-[12px] font-medium text-danger transition-colors hover:bg-danger/8"
                      >
                        Revoke
                      </button>
                    </form>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-[8px] border border-lavender-deep bg-lavender px-2.5 py-1.5 font-mono text-[11.5px] text-ink">
                      {link}
                    </code>
                    <CopyButton value={link} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {/* team table */}
      <div className="mb-3 font-display text-[15px] font-semibold">Teammates</div>
      <div className="overflow-hidden rounded-[16px] border border-ink/10 bg-white shadow-sm">
        <div className="grid grid-cols-[2fr_1fr_1fr] gap-3 border-b border-ink/10 bg-surface-tint px-5 py-3">
          {["Member", "Role", "Access"].map((h) => (
            <div key={h} className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
              {h}
            </div>
          ))}
        </div>
        {team.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-muted">No teammates yet.</div>
        ) : (
          team.map((m, i) => (
            <div
              key={m.userId}
              className={`grid grid-cols-[2fr_1fr_1fr] items-center gap-3 border-b border-lavender px-5 py-3 ${
                i % 2 ? "bg-lavender/40" : "bg-white"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[13px] font-medium">{m.email ?? m.userId}</span>
                {m.userId === currentUserId ? (
                  <span className="flex-none rounded-[5px] bg-ink px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wider text-white">
                    You
                  </span>
                ) : null}
              </div>
              <div>
                <span className="bg-gradient-brand rounded-[6px] px-2 py-0.5 font-mono text-[10.5px] font-bold text-white">
                  Admin
                </span>
              </div>
              <div className="font-mono text-[12px] text-muted">All clients</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
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
