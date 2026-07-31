"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { loadThread } from "@/app/dashboard/log/actions";
import { agentLabel, channelCode, channelColor, channelLabel } from "@/lib/channels";
import { tint } from "@/lib/design";
import { num, relTime, shortId } from "@/lib/format";
import type { ConversationThread, ThreadRow } from "@/lib/types";
import { useScrollLock } from "@/lib/useScrollLock";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; notFound: boolean }
  | { phase: "ready"; thread: ConversationThread };

/**
 * DM chat drawer — same portal/overlay pattern as CallDrawer. Receives the list stub for an
 * instant header and loads the full message history through the server action (the agency
 * key never reaches the browser).
 */
export function ChatDrawer({
  threadId,
  stub,
  onClose,
}: {
  threadId: string | null;
  stub: ThreadRow | null;
  onClose: () => void;
}) {
  useScrollLock(Boolean(threadId));
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    setState({ phase: "loading" });
    setLoadingOlder(false);
    loadThread(threadId).then((r) => {
      if (cancelled) return;
      if (r.ok && r.thread) setState({ phase: "ready", thread: r.thread });
      else setState({ phase: "error", notFound: r.error === "not_found" });
    });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  /** Page backwards with the `before` cursor — the oldest timestamp we currently hold. */
  const loadOlder = useCallback(async () => {
    if (!threadId || state.phase !== "ready" || loadingOlder) return;
    const oldest = state.thread.messages[0]?.timestamp;
    if (!oldest) return;
    setLoadingOlder(true);
    const r = await loadThread(threadId, oldest);
    setLoadingOlder(false);
    if (!r.ok || !r.thread) return;
    setState((prev) => {
      if (prev.phase !== "ready") return prev;
      // `before` should be exclusive, but dedupe anyway — a boundary repeat would
      // otherwise render the same message twice.
      const held = new Set(prev.thread.messages.map((m) => m.id ?? m.timestamp + m.text));
      const older = r.thread!.messages.filter(
        (m) => !held.has(m.id ?? m.timestamp + m.text),
      );
      return {
        phase: "ready",
        thread: {
          ...prev.thread,
          has_more: r.thread!.has_more,
          messages: [...older, ...prev.thread.messages],
        },
      };
    });
  }, [threadId, state, loadingOlder]);

  if (!threadId) return null;

  const channel = state.phase === "ready" ? state.thread.channel : (stub?.channel ?? "dm");
  const color = channelColor(channel);
  const leadName =
    stub?.lead_name ?? (stub?.locked ? "PII locked" : stub ? shortId(stub.lead_id) : "Thread");
  const agentName = state.phase === "ready" ? agentLabel(state.thread.agent) : "Emma";
  const locked = state.phase === "ready" ? Boolean(state.thread.locked) : Boolean(stub?.locked);
  const leadId = stub?.lead_id ?? (state.phase === "ready" ? state.thread.lead_id : null);
  const optedOutAt = stub?.opted_out_at ?? null;

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex justify-end bg-ink/30 backdrop-blur-[2px]"
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-screen w-[460px] max-w-[92vw] animate-fade-up flex-col bg-white shadow-[-12px_0_40px_rgba(26,43,46,0.18)]"
      >
        {/* channel header */}
        <div className="flex items-start justify-between border-b border-ink/10 px-[26px] py-[22px]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex flex-none items-center rounded-[6px] px-[7px] py-[3px] font-mono text-[10px] font-bold tracking-[0.05em]"
                style={{ color, background: tint(color, 0.12) }}
              >
                {channelCode(channel)}
              </span>
              <span className="truncate font-mono text-[11px] tracking-[0.08em] text-muted">
                {channelLabel(channel)} · {agentName}
              </span>
              {optedOutAt ? (
                <span
                  className="flex-none rounded-[5px] bg-ink/5 px-1.5 py-[1px] font-mono text-[9.5px] uppercase tracking-[0.06em] text-muted"
                  title={`Lead opted out ${relTime(optedOutAt)} — history is kept, Emma stops sending`}
                >
                  Opted out
                </span>
              ) : null}
            </div>
            {leadId ? (
              <Link
                href={`/dashboard/leads/${encodeURIComponent(leadId)}`}
                title="Open lead page"
                className="group mt-1.5 flex w-max max-w-full items-center gap-1.5 text-[21px] font-bold tracking-[-0.01em] text-ink transition-colors hover:text-violet"
              >
                <span className="truncate">{leadName}</span>
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="flex-none opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <path d="M7 13 13 7" />
                  <path d="M7.5 7H13v5.5" />
                </svg>
              </Link>
            ) : (
              <div className="mt-1.5 truncate text-[21px] font-bold tracking-[-0.01em]">
                {leadName}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-ink/10 bg-white text-[15px] text-ink"
          >
            ✕
          </button>
        </div>

        {/* messages */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-[22px] py-[20px]">
          {state.phase === "loading" ? (
            <div className="flex flex-col gap-3">
              <div className="shimmer h-[52px] w-[70%] self-start rounded-[14px]" />
              <div className="shimmer h-[52px] w-[70%] self-end rounded-[14px]" />
              <div className="shimmer h-[52px] w-[55%] self-start rounded-[14px]" />
            </div>
          ) : state.phase === "error" ? (
            <div className="rounded-[12px] border border-dashed border-lavender-deep bg-surface-tint p-[18px] text-center text-[13px] leading-[1.5] text-muted">
              {state.notFound
                ? "This thread no longer exists in your workspace."
                : "The conversation couldn’t be loaded — close and try again."}
            </div>
          ) : locked || state.thread.messages.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-[12px] border border-dashed border-lavender-deep bg-surface-tint p-[22px] text-center">
              {locked ? (
                <>
                  <LockIcon />
                  <div className="text-[13px] leading-[1.5] text-muted">
                    <span className="font-medium text-ink">Messages are PII-locked.</span>
                    <br />
                    The current API key can’t read this thread’s contents.
                  </div>
                </>
              ) : (
                <div className="text-[13px] leading-[1.5] text-muted">
                  No messages in this thread yet.
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {state.thread.has_more ? (
                <button
                  onClick={loadOlder}
                  disabled={loadingOlder}
                  className="mx-auto mb-1 cursor-pointer rounded-[9px] border border-ink/10 bg-white px-3.5 py-[7px] font-display text-[12.5px] text-muted transition-colors hover:bg-lavender disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingOlder ? "Loading…" : "Load older messages"}
                </button>
              ) : null}
              {state.thread.messages.map((m, i) => {
                const isAgent = m.from === "agent";
                const failed = m.status === "failed";
                return (
                  <div
                    key={m.id ?? `${m.timestamp}-${i}`}
                    className={`flex max-w-[85%] flex-col ${isAgent ? "items-end self-end" : "items-start self-start"}`}
                  >
                    <div
                      className={`rounded-[14px] px-3.5 py-2.5 text-[13.5px] leading-[1.5] ${
                        failed
                          ? "rounded-br-[4px] border border-dashed border-[#E5484D]/50 bg-[#E5484D]/5 text-ink"
                          : isAgent
                            ? "bg-gradient-brand rounded-br-[4px] text-white"
                            : "rounded-bl-[4px] border border-ink/10 bg-white text-ink"
                      }`}
                    >
                      {m.text}
                    </div>
                    <span
                      className="mt-1 px-0.5 font-mono text-[10px] text-muted"
                      suppressHydrationWarning
                    >
                      {isAgent ? agentName : leadName} · {relTime(m.timestamp)}
                      {failed ? (
                        <span className="text-[#E5484D]"> · not delivered</span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* reply composer — visual per the design; sending has no serving endpoint yet,
            and Emma replies to leads automatically, so the control is disabled. */}
        <div className="border-t border-ink/10 px-[22px] py-[16px]">
          {state.phase === "ready" && !locked && state.thread.messages.length > 0 ? (
            <div className="mb-2 font-mono text-[10.5px] text-muted">
              {state.thread.has_more
                ? `Showing latest ${num(state.thread.messages.length)} messages`
                : `${num(state.thread.messages.length)} message${
                    state.thread.messages.length === 1 ? "" : "s"
                  } · full history`}
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <input
              disabled
              placeholder="Emma replies automatically — manual replies coming soon"
              className="min-w-0 flex-1 cursor-not-allowed rounded-[11px] border border-ink/10 bg-warm/70 px-3.5 py-[10px] text-[13px] text-ink placeholder:text-muted/70"
            />
            <button
              disabled
              title="Manual replies aren’t available yet"
              className="flex h-[38px] w-[38px] flex-none cursor-not-allowed items-center justify-center rounded-[11px] bg-violet/35 text-white"
            >
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 10l14-6-4 13-3.5-5L3 10z" />
              </svg>
            </button>
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function LockIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 20 20"
      fill="none"
      stroke="#6D4AFF"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="9" width="12" height="8" rx="2" />
      <path d="M7 9V6a3 3 0 016 0v3" />
    </svg>
  );
}
