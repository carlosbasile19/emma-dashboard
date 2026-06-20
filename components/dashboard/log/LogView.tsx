"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { CallDrawer } from "@/components/dashboard/log/CallDrawer";
import { Badge } from "@/components/ui/Badge";
import { relTime, secToMMSS } from "@/lib/format";
import type { Call, Conversation } from "@/lib/types";

const CALL_COLS = "grid-cols-[0.7fr_1.4fr_1.3fr_1.1fr_1.2fr_0.7fr_1fr]";

export function LogView({
  tab,
  calls,
  callTotal,
  callPage,
  callPages,
  conversations,
}: {
  tab: "calls" | "conversations";
  calls: Call[];
  callTotal: number;
  callPage: number;
  callPages: number;
  conversations: Conversation[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [selected, setSelected] = useState<Call | null>(null);

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return (
    <>
      {/* tab switcher */}
      <div className="mb-4 flex w-max gap-1 rounded-[11px] border border-ink/10 bg-white p-[3px]">
        {(["calls", "conversations"] as const).map((t) => {
          const on = tab === t;
          return (
            <button
              key={t}
              onClick={() => setParam({ tab: t === "calls" ? null : t, page: null })}
              className={`cursor-pointer rounded-[8px] px-4 py-2 font-display text-[13px] font-medium transition-colors ${
                on ? "bg-ink text-white" : "text-muted hover:bg-lavender"
              }`}
            >
              {t === "calls" ? "Calls" : "Conversations"}
            </button>
          );
        })}
      </div>

      {tab === "calls" ? (
        <>
          <div className="overflow-hidden rounded-[16px] border border-ink/10 bg-white shadow-sm">
            <div
              className={`grid ${CALL_COLS} gap-2.5 border-b border-ink/10 bg-surface-tint px-[22px] py-[13px]`}
            >
              {["Dir", "Lead", "Agent", "Status", "Disposition"].map((h) => (
                <div
                  key={h}
                  className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted"
                >
                  {h}
                </div>
              ))}
              <div className="text-right font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
                Dur.
              </div>
              <div className="text-right font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
                When
              </div>
            </div>

            {calls.map((c, i) => {
              const inbound = c.direction === "inbound";
              return (
                <div
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className={`grid ${CALL_COLS} cursor-pointer items-center gap-2.5 border-b border-lavender px-[22px] py-[13px] hover:bg-lavender ${
                    i % 2 ? "bg-lavender/40" : "bg-white"
                  }`}
                >
                  <div>
                    <span
                      className="font-mono text-[11px] font-bold"
                      style={{ color: inbound ? "#2BB673" : "#6D4AFF" }}
                    >
                      {inbound ? "In" : "Out"}
                    </span>
                  </div>
                  <div className="truncate text-[13px] font-medium">
                    {c.lead ?? c.lead_id}
                  </div>
                  <div className="truncate text-[12.5px] text-muted">{c.agent ?? "—"}</div>
                  <div>
                    <Badge kind="call" value={c.status} />
                  </div>
                  <div>
                    <Badge kind="disp" value={c.disposition} />
                  </div>
                  <div className="text-right font-mono text-[12.5px] text-muted">
                    {secToMMSS(c.duration_seconds)}
                  </div>
                  <div
                    className="text-right font-mono text-[11px] text-muted"
                    suppressHydrationWarning
                  >
                    {relTime(c.started_at)}
                  </div>
                </div>
              );
            })}

            <div className="flex items-center justify-between bg-surface-tint px-[22px] py-3">
              <span className="font-mono text-xs text-muted">
                Page {callPage} of {callPages} · {callTotal} calls
              </span>
              <div className="flex gap-2">
                <PageButton
                  disabled={callPage <= 1}
                  onClick={() =>
                    setParam({ page: callPage - 1 <= 1 ? null : String(callPage - 1) })
                  }
                >
                  Previous
                </PageButton>
                <PageButton
                  disabled={callPage >= callPages}
                  onClick={() => setParam({ page: String(callPage + 1) })}
                >
                  Next
                </PageButton>
              </div>
            </div>
          </div>
          <div className="mt-3 font-mono text-[12.5px] text-muted">
            Tip — select any call to read its summary &amp; transcript.
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2.5">
          {conversations.map((m) => {
            const unread = m.status === "in_progress";
            return (
              <div
                key={m.id}
                className="flex items-center gap-4 rounded-[12px] border border-ink/10 bg-white px-[18px] py-[15px] shadow-sm hover:border-lavender-deep"
              >
                <span className="w-[46px] flex-none rounded-[7px] border border-lavender-deep bg-lavender py-1 text-center font-mono text-[10px] font-bold tracking-[0.06em] text-violet">
                  {m.channel.toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-2">
                    <span className="text-sm font-medium">{m.lead ?? m.lead_id}</span>
                    {unread ? (
                      <span className="h-[7px] w-[7px] rounded-full bg-pink" />
                    ) : null}
                  </div>
                  <div className="truncate text-[13px] text-muted">{m.summary ?? "—"}</div>
                </div>
                {m.status ? (
                  <div className="flex-none">
                    <Badge kind="call" value={m.status} />
                  </div>
                ) : null}
                <div
                  className="w-[90px] flex-none text-right font-mono text-[11px] text-muted"
                  suppressHydrationWarning
                >
                  {relTime(m.started_at)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CallDrawer call={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function PageButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer rounded-[9px] border border-ink/10 bg-white px-3.5 py-[7px] font-display text-[13px] text-ink hover:bg-lavender disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
