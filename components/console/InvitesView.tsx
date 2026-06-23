import { createInvite, revokeInvite } from "@/app/console/actions";
import { CopyButton } from "@/components/ui/CopyButton";
import { relTime } from "@/lib/format";
import type { AgencyClient, InviteRow, MemberRow } from "@/lib/olivia/agency";

const ROLE_LABEL: Record<string, string> = { platform_admin: "Admin", member: "Member" };

export function InvitesView({
  invites,
  members,
  clients,
  baseUrl,
}: {
  invites: InviteRow[];
  members: MemberRow[];
  clients: AgencyClient[];
  baseUrl: string;
}) {
  const pending = invites.filter((i) => i.status === "pending");

  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-2 font-display text-[26px] font-bold tracking-[-0.02em]">
        Invites &amp; members
      </div>
      <div className="mb-6 text-[14px] text-muted">
        Invite people into a client workspace — they get a single-use link and a magic-link sign-in.
      </div>

      {/* generate invite */}
      <form
        action={createInvite}
        className="mb-7 flex flex-wrap items-end gap-3 rounded-[16px] border border-ink/10 bg-white px-5 py-4 shadow-sm"
      >
        <div className="min-w-[180px] flex-1">
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
            Workspace
          </label>
          <div className="relative">
            <select
              name="clientId"
              required
              defaultValue=""
              className="w-full cursor-pointer appearance-none rounded-[10px] border border-ink/10 bg-white py-2 pl-3 pr-8 font-display text-[13px] text-ink"
            >
              <option value="" disabled>
                Select a client…
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted">
              ▼
            </span>
          </div>
        </div>
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
            Email
          </label>
          <input
            type="email"
            name="email"
            required
            placeholder="person@company.com"
            className="w-full rounded-[10px] border border-ink/10 bg-white px-3 py-2 font-display text-[13px] text-ink placeholder:text-muted/60"
          />
        </div>
        <button
          type="submit"
          className="bg-gradient-brand rounded-[10px] px-4 py-2 font-display text-[13px] font-semibold text-white transition-transform active:scale-95"
        >
          Generate invite
        </button>
      </form>

      {/* pending invites */}
      <div className="mb-3 flex items-center gap-2">
        <span className="font-display text-[15px] font-semibold">Pending</span>
        <span className="rounded-full bg-lavender px-2 py-0.5 font-mono text-[11px] text-violet">
          {pending.length}
        </span>
      </div>
      {pending.length === 0 ? (
        <div className="mb-8 rounded-[14px] border border-dashed border-lavender-deep bg-surface-tint px-5 py-6 text-center text-[13px] text-muted">
          No pending invites.
        </div>
      ) : (
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
                      {inv.clientName} · {ROLE_LABEL[inv.role] ?? inv.role} · expires{" "}
                      <span suppressHydrationWarning>{relTime(inv.expiresAt)}</span>
                    </div>
                  </div>
                  <form action={revokeInvite}>
                    <input type="hidden" name="id" value={inv.id} />
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
      )}

      {/* members */}
      <div className="mb-3 flex items-center gap-2">
        <span className="font-display text-[15px] font-semibold">Members</span>
        <span className="rounded-full bg-lavender px-2 py-0.5 font-mono text-[11px] text-violet">
          {members.length}
        </span>
      </div>
      <div className="overflow-hidden rounded-[16px] border border-ink/10 bg-white shadow-sm">
        <div className="grid grid-cols-[2fr_1.5fr_0.8fr] gap-3 border-b border-ink/10 bg-surface-tint px-5 py-3">
          {["Member", "Workspace", "Role"].map((h) => (
            <div key={h} className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
              {h}
            </div>
          ))}
        </div>
        {members.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-muted">No members yet.</div>
        ) : (
          members.map((m, i) => (
            <div
              key={m.userId}
              className={`grid grid-cols-[2fr_1.5fr_0.8fr] items-center gap-3 border-b border-lavender px-5 py-3 ${
                i % 2 ? "bg-lavender/40" : "bg-white"
              }`}
            >
              <div className="min-w-0 truncate text-[13px] font-medium">
                {m.email ?? m.userId}
              </div>
              <div className="min-w-0 truncate text-[12.5px] text-muted">{m.clientName}</div>
              <div>
                <span className="rounded-[6px] border border-lavender-deep bg-lavender px-2 py-0.5 font-mono text-[10.5px] text-violet">
                  {ROLE_LABEL[m.role] ?? m.role}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
