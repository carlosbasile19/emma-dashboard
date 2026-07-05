"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { loadThread } from "@/app/dashboard/log/actions";
import { dmChannelCode, dmChannelColor, dmChannelLabel } from "@/lib/dm";
import { tint } from "@/lib/design";
import { relTime, shortId } from "@/lib/format";
import type { ConversationThread, DmThread } from "@/lib/types";
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
  stub: DmThread | null;
  onClose: () => void;
}) {
  useScrollLock(Boolean(threadId));
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    setState({ phase: "loading" });
    loadThread(threadId).then((r) => {
      if (cancelled) return;
      if (r.ok && r.thread) setState({ phase: "ready", thread: r.thread });
      else setState({ phase: "error", notFound: r.error === "not_found" });
    });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  if (!threadId) return null;

  const channel = state.phase === "ready" ? state.thread.channel : (stub?.channel ?? "dm");
  const color = dmChannelColor(channel);
  const leadName =
    stub?.lead_name ?? (stub?.locked ? "PII locked" : stub ? shortId(stub.lead_id) : "Thread");
  const agentLabel = state.phase === "ready" ? (state.thread.agent ?? "Emma") : "Emma";
  const locked = state.phase === "ready" ? Boolean(state.thread.locked) : Boolean(stub?.locked);

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
                {dmChannelCode(channel)}
              </span>
              <span className="font-mono text-[11px] tracking-[0.08em] text-muted">
                {dmChannelLabel(channel)} · {agentLabel}
              </span>
            </div>
            <div className="mt-1.5 truncate text-[21px] font-bold tracking-[-0.01em]">
              {leadName}
            </div>
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
              {state.thread.messages.map((m, i) => {
                const isAgent = m.from === "agent";
                return (
                  <div
                    key={i}
                    className={`flex max-w-[85%] flex-col ${isAgent ? "items-end self-end" : "items-start self-start"}`}
                  >
                    <div
                      className={`rounded-[14px] px-3.5 py-2.5 text-[13.5px] leading-[1.5] ${
                        isAgent
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
                      {isAgent ? agentLabel : leadName} · {relTime(m.timestamp)}
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
