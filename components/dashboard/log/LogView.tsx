"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CallDrawer } from "@/components/dashboard/log/CallDrawer";
import { ChatDrawer } from "@/components/dashboard/log/ChatDrawer";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/states/EmptyState";
import { useNavigate } from "@/components/ui/states/PendingNav";
import { channelCode, channelColor, channelLabel } from "@/lib/channels";
import { LOG_SEARCH_EMPTY } from "@/lib/copy";
import { tint } from "@/lib/design";
import {
  INFERRED_VOICEMAIL_HINT,
  displayDisposition,
  fmtDateTime,
  isInferredVoicemail,
  num,
  relTime,
  secToMMSS,
  shortId,
} from "@/lib/format";
import type { Call, ThreadRow } from "@/lib/types";

const CALL_COLS = "grid-cols-[0.7fr_1.4fr_1.3fr_1.1fr_1.2fr_0.7fr_1fr]";

export function LogView({
  tab,
  calls,
  callTotal,
  callPage,
  callPages,
  callsTruncated,
  callsSearched,
  threads,
  threadTotal,
  threadsPartial,
  initialThreadId,
  q,
}: {
  tab: "calls" | "conversations";
  calls: Call[];
  callTotal: number;
  callPage: number;
  callPages: number;
  /** The call search crawl fell short of the whole window — see `callsSearched`. */
  callsTruncated: boolean;
  /** Calls the crawl actually covered. Only meaningful with `callsTruncated`. */
  callsSearched: number;
  threads: ThreadRow[];
  threadTotal: number;
  /** The merged list hit its fetch cap — say so rather than implying it is complete. */
  threadsPartial: boolean;
  initialThreadId: string | null;
  q: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Call | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(initialThreadId);

  // The query string of the last URL *this component* asked for, or null once a navigation has
  // committed. Composing onto `useSearchParams()` alone is not safe now that a debounced search
  // writes here: Next only reflects a navigation once it COMMITS, and a newer navigation marks
  // a pending one discarded — so a tab click landing inside the ~250ms debounce window (plus a
  // multi-second RSC round trip when the search triggers a corpus crawl) would compose onto the
  // pre-search URL and silently drop the query. Same guard as LeadsTable.
  const pendingSearchRef = useRef<string | null>(null);

  // Reset once ANY navigation commits, not just one that changes our own props: Header shares
  // this layout and writes `range` to the same URL without touching tab/page/q.
  const committed = params.toString();
  useEffect(() => {
    pendingSearchRef.current = null;
  }, [committed]);

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(pendingSearchRef.current ?? window.location.search);
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      pendingSearchRef.current = qs ? `?${qs}` : "";
      navigate(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [navigate, pathname, router],
  );

  // A new query always restarts at page 1 — page N of the old result set means nothing.
  const setQuery = useCallback((v: string) => setParam({ q: v, page: null }), [setParam]);

  // Bumped on "Clear search" to remount SearchInput with a fresh key, discarding any
  // uncommitted draft (and its pending debounce timer) even when q was already "".
  const [searchNonce, setSearchNonce] = useState(0);
  const clearSearch = useCallback(() => {
    setParam({ q: null, page: null });
    setSearchNonce((n) => n + 1);
  }, [setParam]);

  const searchingCalls = q !== "" && tab === "calls";
  const searchingThreads = q !== "" && tab === "conversations";

  return (
    <>
      {/* tab switcher + search */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex w-max gap-1 rounded-[11px] border border-ink/10 bg-white p-[3px]">
          {(["calls", "conversations"] as const).map((t) => {
            const on = tab === t;
            return (
              <button
                key={t}
                // `q` is deliberately preserved across the switch: searching a lead on one tab
                // and checking the other is the whole point of a shared search box.
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
        <div className="flex-1" />
        <SearchInput key={searchNonce} value={q} onChange={setQuery} />
      </div>

      {/* Coverage is only ever surfaced during a real search, and only when the fetch fell
          short. The count must be what we actually covered — "truncated" also means upstream
          omitted `total` or returned a short page, either of which can stop the crawl early,
          so quoting the 2,500 cap would overstate it. */}
      {searchingCalls && callsTruncated ? (
        <p className="-mt-1 mb-4 font-mono text-[11.5px] text-muted">
          {callsSearched > 0
            ? `Searched the most recent ${num(callsSearched)} ${callsSearched === 1 ? "call" : "calls"} in this range.`
            : "We couldn’t read the full call list for this range, so this search may be incomplete."}
        </p>
      ) : null}
      {searchingThreads && threadsPartial ? (
        <p className="-mt-1 mb-4 font-mono text-[11.5px] text-muted">
          Searched the most recently active threads — older ones may not be covered.
        </p>
      ) : null}

      {searchingCalls && callTotal === 0 ? (
        <div className="rounded-[16px] border border-ink/10 bg-white shadow-sm">
          <EmptyState copy={LOG_SEARCH_EMPTY(q, "calls")} onAction={clearSearch} />
        </div>
      ) : searchingThreads && threads.length === 0 ? (
        <div className="rounded-[16px] border border-ink/10 bg-white shadow-sm">
          <EmptyState copy={LOG_SEARCH_EMPTY(q, "conversations")} onAction={clearSearch} />
        </div>
      ) : tab === "calls" ? (
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
                    {c.lead ?? shortId(c.lead_id)}
                  </div>
                  <div className="truncate text-[12.5px] text-muted">{c.agent ?? "—"}</div>
                  <div>
                    <Badge kind="call" value={c.status} />
                  </div>
                  <div>
                    <Badge
                      kind="disp"
                      value={displayDisposition(c)}
                      title={isInferredVoicemail(c) ? INFERRED_VOICEMAIL_HINT : undefined}
                    />
                  </div>
                  <div className="text-right font-mono text-[12.5px] text-muted">
                    {secToMMSS(c.duration_seconds)}
                  </div>
                  <div
                    className="text-right font-mono text-[11px] text-muted"
                    suppressHydrationWarning
                  >
                    {fmtDateTime(c.started_at)}
                  </div>
                </div>
              );
            })}

            <div className="flex items-center justify-between bg-surface-tint px-[22px] py-3">
              <span className="font-mono text-xs text-muted">
                Page {callPage} of {callPages} · {num(callTotal)}{" "}
                {searchingCalls ? "matching " : ""}
                {callTotal === 1 ? "call" : "calls"}
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
      ) : threads.length === 0 ? (
        <div className="rounded-[16px] border border-ink/10 bg-white px-6 py-10 text-center text-[13.5px] text-muted shadow-sm">
          No conversations yet — when a lead texts Emma or messages on Instagram, Messenger or
          WhatsApp, the thread lands here.
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2.5">
            {threads.map((t) => {
              const color = channelColor(t.channel);
              const name =
                t.lead_name ?? (t.locked ? "PII locked" : shortId(t.lead_id));
              // No preview text is not the same as an empty thread: the counters are
              // un-gated, so fall back to them before showing a dash.
              const preview =
                t.last_message ??
                (t.locked
                  ? "Message preview locked"
                  : t.message_count
                    ? `${num(t.message_count)} message${t.message_count === 1 ? "" : "s"}`
                    : "—");
              return (
                <button
                  key={t.id}
                  onClick={() => setOpenThreadId(t.id)}
                  className="flex cursor-pointer items-center gap-4 rounded-[12px] border border-ink/10 bg-white px-[18px] py-[15px] text-left shadow-sm transition-colors hover:border-lavender-deep hover:bg-lavender/30"
                >
                  <span
                    className="w-[46px] flex-none rounded-[7px] py-1 text-center font-mono text-[10px] font-bold tracking-[0.06em]"
                    style={{ color, background: tint(color, 0.12) }}
                    title={channelLabel(t.channel)}
                  >
                    {channelCode(t.channel)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center gap-2">
                      <span className="text-sm font-medium">{name}</span>
                      {t.unread > 0 ? (
                        <span
                          className="h-[7px] w-[7px] flex-none rounded-full bg-pink"
                          title={`${num(t.unread)} awaiting reply`}
                        />
                      ) : null}
                      {t.opted_out_at ? (
                        <span
                          className="flex-none rounded-[5px] bg-ink/5 px-1.5 py-[1px] font-mono text-[9.5px] uppercase tracking-[0.06em] text-muted"
                          title={`Opted out ${relTime(t.opted_out_at)}`}
                        >
                          Opted out
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-[13px] text-muted">{preview}</div>
                  </div>
                  {t.status === "ended" ? (
                    <span className="flex-none font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
                      Ended
                    </span>
                  ) : null}
                  <div
                    className="w-[90px] flex-none text-right font-mono text-[11px] text-muted"
                    suppressHydrationWarning
                  >
                    {t.last_message_at ? relTime(t.last_message_at) : "—"}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 font-mono text-[12.5px] text-muted">
            {/* While searching, threadTotal is a MATCH count — "Latest N threads" would be a
                different (and wrong) claim, so the partial-coverage note above owns that
                caveat instead. */}
            {searchingThreads
              ? `${num(threadTotal)} matching ${threadTotal === 1 ? "thread" : "threads"}`
              : threadsPartial
                ? `Latest ${num(threadTotal)} threads`
                : `${num(threadTotal)} threads`}{" "}
            · select one to read the conversation.
          </div>
        </>
      )}

      <CallDrawer call={selected} onClose={() => setSelected(null)} />
      <ChatDrawer
        threadId={openThreadId}
        stub={threads.find((t) => t.id === openThreadId) ?? null}
        onClose={() => {
          setOpenThreadId(null);
          // Clear a deep-linked ?thread= so closing doesn't re-open on refresh/back.
          if (params.get("thread")) setParam({ thread: null });
        }}
      />
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

const DEBOUNCE_MS = 250;

function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Tracks the last value *this component* committed (trimmed, same as what the server stores).
  // Comparing incoming `value` against this — instead of syncing unconditionally — is what lets
  // the re-sync effect tell its own echo apart from a genuine external change (back/forward).
  // Without it, the URL update from our own debounced commit would come back around and clobber
  // whatever the user typed in the meantime.
  const committedRef = useRef(value);

  useEffect(() => {
    if (value === committedRef.current) return;
    committedRef.current = value;
    setDraft(value);
  }, [value]);

  // Debounce the URL write so typing doesn't fire a navigation (and a corpus crawl) per
  // keystroke. Trim before comparing AND before committing: the server trims
  // (`str(sp.q, "").trim()`), so comparing the raw draft against the trimmed committed value
  // would leave a trailing-space draft permanently "dirty" and re-fire the write forever.
  useEffect(() => {
    const next = draft.trim();
    if (next === committedRef.current) return;
    const t = setTimeout(() => {
      committedRef.current = next;
      onChange(next);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, onChange]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-muted">
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="9" cy="9" r="6" />
          <path d="M13.5 13.5 17 17" strokeLinecap="round" />
        </svg>
      </span>
      <input
        ref={inputRef}
        type="search"
        aria-label="Search calls and conversations by lead"
        placeholder="Search by lead…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="w-[220px] rounded-[10px] border border-ink/10 bg-white py-[9px] pl-[32px] pr-[30px] font-display text-[13px] text-ink placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none"
      />
      {draft ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setDraft("");
            committedRef.current = "";
            onChange("");
            inputRef.current?.focus();
          }}
          className="absolute right-[9px] top-1/2 -translate-y-1/2 cursor-pointer px-1 text-[13px] leading-none text-muted hover:text-ink"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
