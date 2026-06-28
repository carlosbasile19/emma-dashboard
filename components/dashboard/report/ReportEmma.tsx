"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RetellWebClient } from "retell-client-js-sdk";
import { beginReport, endReport } from "@/app/auth/actions";
import {
  type BriefWindow,
  type BriefWindowKind,
  briefWindowLabel,
} from "@/lib/filters";
import {
  type ReportStatusValue,
  type TranscriptEntry,
  useReportingTranscript,
} from "./useReportingTranscript";

type Step = "form" | "connecting" | "live";
type Mode = "live" | "sim";

const WINDOW_TABS: Array<{ v: BriefWindowKind; l: string }> = [
  { v: "week", l: "This week" },
  { v: "30d", l: "30 days" },
  { v: "90d", l: "90 days" },
  { v: "custom", l: "Custom" },
];

const todayYMD = () => new Date().toISOString().slice(0, 10);
const daysAgoYMD = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

// What Olivia walks through — shown as a static preview on the form and used to script the local
// preview transcript when the live bridge is off.
const COVERS = [
  { title: "Headline metrics", sub: "Pickup, bookings and conversions for the window.", color: "#6D4AFF" },
  { title: "Today's schedule", sub: "The calls Emma has on the books for today.", color: "#2E86F2" },
  { title: "Outstanding looms", sub: "Open items still waiting on a follow-up.", color: "#E8A33D" },
];

const PREVIEW_SCRIPT: string[] = [
  "Here's your reporting walkthrough — read-only, just the numbers.",
  "Starting with the headline metrics: pickup, bookings and conversions for this window.",
  "Then today's call schedule — what's on the books for today.",
  "And any outstanding looms still waiting on a follow-up.",
  "Want me to drill into a specific agent? Once the live bridge is on, just ask.",
];

function errMessage(e: { code: string; retryAfterSeconds?: number }): string {
  if (e.code === "reporting_concurrency_limit" || e.code === "rate_limited") {
    return `Emma's at capacity right now — try again in ${e.retryAfterSeconds ?? 30}s.`;
  }
  if (e.code === "forbidden_scope") {
    return "Reporting isn't enabled for this workspace yet — showing a preview.";
  }
  return "Couldn't start the live report — showing a preview.";
}

const statusLabel = (s: ReportStatusValue): string =>
  s === "live" ? "Live" : s === "ended" ? "Ended" : s === "failed" ? "Ended" : "Connecting";

const ChartIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 17V3M3 17h14" />
    <path d="M7 13v-3M11 13V7M15 13V9" />
  </svg>
);

const CalIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="14" height="13" rx="2" />
    <path d="M3 8h14M7 3v3M13 3v3" />
  </svg>
);

const Wave = ({ count, h, w }: { count: number; h: number; w: number }) => (
  <span className="flex items-center" style={{ gap: w / 2, height: h }}>
    {Array.from({ length: count }).map((_, i) => (
      <span
        key={i}
        className="animate-wave rounded-full bg-white"
        style={{ width: w, height: h, transformOrigin: "center", animationDelay: `${i * 0.15}s` }}
      />
    ))}
  </span>
);

export function ReportEmma({
  range,
  agents = [],
}: {
  range: string;
  agents?: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [mode, setMode] = useState<Mode>("sim");
  // "" = all agents; otherwise an explicit voice drill-down into one agent.
  const [agentId, setAgentId] = useState<string>("");
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ schedule_count: number; loom_count: number } | null>(null);
  const [audio, setAudio] = useState(false);
  const [muted, setMuted] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [simEntries, setSimEntries] = useState<TranscriptEntry[]>([]);

  // Window picker (reuses the Brief Emma window model). 90d maps to its button; everything else
  // (incl. the dashboard's 7d, which has no button here) starts on "30 days".
  const initialWin: BriefWindow = range === "90d" ? { kind: "90d" } : { kind: "30d" };
  const [win, setWin] = useState<BriefWindow>(initialWin);
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const connectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const retellRef = useRef<RetellWebClient | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Bumped on every start() and on teardown — a stale in-flight start() compares its captured id
  // and bails, so closing during "connecting" can't resurrect a session after the modal is gone.
  const runIdRef = useRef(0);
  // Mirrors reportingId so teardown() (incl. unmount) can end the session without re-subscribing.
  const reportingIdRef = useRef<string | null>(null);

  // Live transcript streams while we hold a real session and the live screen is up (and the modal
  // is open — defense-in-depth so the SSE hook can never run headless after close()).
  const liveActive = open && mode === "live" && step === "live" && !!reportingId;
  const live = useReportingTranscript(reportingId, liveActive);

  const entries = mode === "live" ? live.entries : simEntries;
  const winLabel = briefWindowLabel(showCustom && customFrom && customTo ? { kind: "custom", from: customFrom, to: customTo } : win);
  const agentName = agentId ? (agents.find((a) => a.id === agentId)?.name ?? null) : null;
  const winActive = (k: BriefWindowKind) => (k === "custom" ? showCustom : !showCustom && win.kind === k);

  // Auto-scroll the transcript to the newest line.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  function selectTab(k: BriefWindowKind) {
    if (k === "custom") {
      setShowCustom(true);
      if (!customFrom) setCustomFrom(daysAgoYMD(29));
      if (!customTo) setCustomTo(todayYMD());
      return;
    }
    setShowCustom(false);
    setWin({ kind: k });
  }

  function resolvedWindow(): BriefWindow {
    if (showCustom && customFrom && customTo) return { kind: "custom", from: customFrom, to: customTo };
    return win;
  }

  function clearTimers() {
    if (connectTimer.current) clearTimeout(connectTimer.current);
    if (simTimer.current) clearInterval(simTimer.current);
    connectTimer.current = null;
    simTimer.current = null;
  }

  // Resource teardown only (no React state) — safe to call from unmount as well as close().
  // Invalidates any in-flight start(), stops the live audio, and ends the server session.
  function teardown() {
    runIdRef.current += 1; // any in-flight start() is now stale and will bail
    // Null the ref before stopCall so the "call_ended" handler can't loop back into another stopCall.
    const client = retellRef.current;
    retellRef.current = null;
    if (client) {
      try {
        client.stopCall();
      } catch {
        /* already torn down */
      }
    }
    const id = reportingIdRef.current;
    reportingIdRef.current = null;
    if (id) endReport(id).catch(() => {});
    clearTimers();
  }

  function close() {
    teardown();
    setOpen(false);
    setStep("form");
    setMode("sim");
    setReportingId(null);
    setSummary(null);
    setAudio(false);
    setMuted(false);
    setLiveError(null);
    setAudioBlocked(false);
    setSimEntries([]);
  }

  function toggleMute() {
    const client = retellRef.current;
    setMuted((m) => {
      const next = !m;
      if (client) {
        try {
          if (next) client.mute();
          else client.unmute();
        } catch {
          /* no live audio to mute */
        }
      }
      return next;
    });
  }

  function enableAudio() {
    retellRef.current
      ?.startAudioPlayback()
      .then(() => setAudioBlocked(false))
      .catch(() => setAudioBlocked(true));
  }

  function start() {
    const myRun = ++runIdRef.current; // claim this attempt; teardown()/a newer start() supersedes it
    clearTimers();
    reportingIdRef.current = null;
    setReportingId(null);
    setSummary(null);
    setAudio(false);
    setMuted(false);
    setLiveError(null);
    setAudioBlocked(false);
    setSimEntries([]);
    setMode("sim"); // until beginReport tells us otherwise
    setStep("connecting");

    const superseded = () => myRun !== runIdRef.current;

    beginReport(resolvedWindow(), agentId || undefined)
      .then(async (s) => {
        // Modal closed (or a new attempt started) while beginReport was in flight: don't write any
        // state, and end the session we just created so it can't leak against the concurrency cap.
        if (superseded()) {
          if (s.mode === "live" && s.reportingId) endReport(s.reportingId).catch(() => {});
          return;
        }

        if (s.error) setLiveError(errMessage(s.error));

        // Reporting emits the generic transport shape (realtime.token) or the briefing-style alias
        // (realtime.access_token) — accept either. A live session with a reporting_id streams the
        // real transcript even if the audio join later fails; only a non-live result previews.
        const rt = s.realtime;
        const accessToken = rt?.token ?? rt?.access_token;

        if (s.mode !== "live" || !s.reportingId) {
          runPreview();
          return;
        }

        reportingIdRef.current = s.reportingId; // so teardown()/close() can end the session
        setReportingId(s.reportingId);
        if (s.summary) setSummary(s.summary);
        setMode("live");
        setStep("live"); // show the transcript pane immediately; SSE begins streaming

        if (!accessToken) return; // session is live (text), just no audio token

        // Join Emma's Retell web call for audio. The SDK is browser-only (WebRTC/mic), so import it
        // lazily here — keeps it out of SSR + the initial client bundle.
        try {
          const { RetellWebClient } = await import("retell-client-js-sdk");
          if (superseded()) {
            // Closed during the dynamic import — end the session (idempotent) and don't open audio.
            endReport(s.reportingId).catch(() => {});
            return;
          }
          const client = new RetellWebClient();
          retellRef.current = client;
          client.on("call_started", () => {
            setAudio(true);
            // startCall ran after awaits, so the browser may have suspended audio autoplay. Try to
            // start playback; if blocked, surface a tap-to-enable control (a user gesture unblocks).
            client.startAudioPlayback().catch(() => setAudioBlocked(true));
          });
          client.on("call_ended", () => {
            // Audio finished — keep the modal open so the user can read the final transcript.
            retellRef.current = null;
            setAudio(false);
          });
          client.on("error", () => {
            const c = retellRef.current;
            retellRef.current = null;
            if (c) {
              try {
                c.stopCall();
              } catch {
                /* already torn down */
              }
            }
            setAudio(false);
            setLiveError("Emma's audio dropped — the transcript keeps streaming.");
          });
          await client.startCall({
            accessToken,
            ...(rt?.sample_rate ? { sampleRate: rt.sample_rate } : {}),
          });
        } catch {
          // startCall rejected (mic denied / token expired) or the SDK failed to load — the live
          // transcript still streams over SSE, so keep the session and just note audio is off.
          retellRef.current = null;
          setAudio(false);
          setLiveError("Couldn't start the audio — showing the live transcript only.");
        }
      })
      .catch(() => {
        if (superseded()) return;
        runPreview();
      });
  }

  // Local preview walkthrough (bridge off / start failed): a short scripted transcript on a timer.
  function runPreview() {
    setMode("sim");
    setSimEntries([]);
    connectTimer.current = setTimeout(() => {
      setStep("live");
      let i = 0;
      const push = () => {
        const line = PREVIEW_SCRIPT[i];
        i += 1;
        if (line) {
          setSimEntries((prev) => [
            ...prev,
            { role: "agent", text: line, at: new Date().toISOString() },
          ]);
        }
        if (i >= PREVIEW_SCRIPT.length && simTimer.current) {
          clearInterval(simTimer.current);
          simTimer.current = null;
        }
      };
      push();
      simTimer.current = setInterval(push, 2400);
    }, 1100);
  }

  // Unmount (e.g. navigating away from /dashboard): run the same resource teardown as close() so a
  // route change can't leave Retell audio playing or a reporting session open against the cap.
  // teardown() only touches refs + stable imports, so the mount-time closure stays correct.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => teardown(), []);

  const status: ReportStatusValue = mode === "live" ? live.status : "live";

  return (
    <>
      <button
        onClick={() => {
          setStep("form");
          setOpen(true);
        }}
        className="mt-5 ml-3 inline-flex cursor-pointer items-center gap-2.5 rounded-[12px] border border-white/30 bg-white/10 px-5 py-3 text-[14.5px] font-semibold text-white backdrop-blur-sm transition hover:bg-white/20"
      >
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[8px] border border-white/30">
          <ChartIcon size={15} />
        </span>
        Reporting walkthrough
      </button>

      {open
        ? createPortal(
            <div
              onClick={close}
              className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/45 p-6 backdrop-blur-[3px]"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="flex max-h-[92vh] w-[540px] max-w-full animate-pop flex-col overflow-hidden rounded-[16px] bg-white text-ink shadow-lg"
              >
                {step === "form" ? (
                  <>
                    <div className="flex items-start justify-between px-[26px] pt-6">
                      <div className="text-[23px] font-bold tracking-[-0.02em]">Reporting walkthrough</div>
                      <button
                        onClick={close}
                        className="h-[30px] w-[30px] cursor-pointer rounded-lg text-base text-muted hover:bg-lavender"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex items-start gap-3.5 border-b border-ink/10 px-[26px] pb-5 pt-3.5">
                      <span className="bg-gradient-brand flex h-11 w-11 flex-none items-center justify-center rounded-[12px]">
                        <ChartIcon size={20} />
                      </span>
                      <div>
                        <div className="text-base font-semibold tracking-[-0.01em]">
                          Hear your numbers, read-only
                        </div>
                        <div className="mt-0.5 text-[13.5px] leading-[1.5] text-muted">
                          Emma web-calls you and walks through your headline metrics, today’s call
                          schedule and outstanding looms — nothing changes, it’s a spoken report.
                        </div>
                      </div>
                    </div>

                    <div className="overflow-y-auto px-[26px]">
                      <div className="border-b border-ink/10 py-5">
                        <div className="mb-3 flex items-baseline justify-between">
                          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                            Window
                          </span>
                          <span className="font-mono text-[13px] text-ink">{winLabel}</span>
                        </div>
                        <div className="flex gap-1 rounded-[12px] border border-ink/10 bg-lavender/50 p-1">
                          {WINDOW_TABS.map((t) => {
                            const on = winActive(t.v);
                            return (
                              <button
                                key={t.v}
                                type="button"
                                onClick={() => selectTab(t.v)}
                                className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] px-2.5 py-2 font-display text-[12.5px] font-medium transition ${
                                  on
                                    ? "bg-white text-violet shadow-[0_1px_3px_rgba(26,43,46,0.14)]"
                                    : "text-muted hover:bg-white/70"
                                }`}
                              >
                                <CalIcon size={13} />
                                {t.l}
                              </button>
                            );
                          })}
                        </div>
                        {showCustom ? (
                          <div className="mt-3 flex flex-wrap items-end gap-2.5">
                            <label className="flex flex-1 flex-col gap-1">
                              <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">
                                From
                              </span>
                              <input
                                type="date"
                                value={customFrom}
                                max={customTo || todayYMD()}
                                onChange={(e) => setCustomFrom(e.target.value)}
                                className="cursor-pointer rounded-[10px] border border-ink/10 bg-white px-3 py-2 font-display text-[13px] text-ink focus:border-violet focus:shadow-[0_0_0_3px_rgba(109,74,255,0.14)]"
                              />
                            </label>
                            <label className="flex flex-1 flex-col gap-1">
                              <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">
                                To
                              </span>
                              <input
                                type="date"
                                value={customTo}
                                min={customFrom || undefined}
                                max={todayYMD()}
                                onChange={(e) => setCustomTo(e.target.value)}
                                className="cursor-pointer rounded-[10px] border border-ink/10 bg-white px-3 py-2 font-display text-[13px] text-ink focus:border-violet focus:shadow-[0_0_0_3px_rgba(109,74,255,0.14)]"
                              />
                            </label>
                          </div>
                        ) : null}
                      </div>

                      {agents.length > 0 ? (
                        <div className="border-b border-ink/10 py-5">
                          <div className="mb-3 flex items-baseline justify-between">
                            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                              Drill into agent
                            </span>
                            <span className="font-mono text-[11px] text-muted">optional</span>
                          </div>
                          <div className="relative">
                            <select
                              value={agentId}
                              onChange={(e) => setAgentId(e.target.value)}
                              className="w-full cursor-pointer appearance-none rounded-[11px] border border-ink/10 bg-white py-3 pl-3.5 pr-9 font-display text-sm text-ink focus:border-violet focus:shadow-[0_0_0_3px_rgba(109,74,255,0.14)]"
                            >
                              <option value="">All agents</option>
                              {agents.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted">
                              ▼
                            </span>
                          </div>
                          {agentName ? (
                            <div className="mt-2 font-display text-[12px] text-muted">
                              Emma will focus this report on {agentName}.
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="py-5">
                        <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                          What Emma covers
                        </div>
                        <div className="overflow-hidden rounded-[13px] border border-ink/10">
                          {COVERS.map((c) => (
                            <div
                              key={c.title}
                              className="flex items-start gap-3 border-t border-lavender px-4 py-3.5 first:border-t-0"
                            >
                              <span className="mt-[5px] h-2 w-2 flex-none rounded-full" style={{ background: c.color }} />
                              <div className="min-w-0 flex-1">
                                <div className="text-[13.5px] font-medium leading-[1.35]">{c.title}</div>
                                <div className="mt-0.5 text-xs text-muted">{c.sub}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 border-t border-ink/10 px-[26px] py-4">
                      <div className="flex flex-1 items-center gap-1.5 font-mono text-[11px] text-muted">
                        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <circle cx="10" cy="10" r="7" />
                          <path d="M3 10h14M10 3a11 11 0 010 14M10 3a11 11 0 000 14" />
                        </svg>
                        Read-only web call · powered by Hey Emma
                      </div>
                      <button
                        onClick={close}
                        className="cursor-pointer rounded-[11px] border border-ink/10 bg-white px-4 py-[11px] font-display text-sm font-medium text-ink hover:bg-lavender"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={start}
                        className="flex cursor-pointer items-center gap-2 rounded-[11px] bg-violet px-5 py-[11px] font-display text-sm font-medium text-white hover:bg-[#5d3df0]"
                      >
                        <ChartIcon size={15} />
                        Start report
                      </button>
                    </div>
                  </>
                ) : step === "connecting" ? (
                  <div className="flex flex-col items-center px-[26px] py-[52px] text-center">
                    <div className="bg-gradient-brand mb-6 flex h-[84px] w-[84px] animate-ring items-center justify-center rounded-full">
                      <Wave count={5} h={30} w={4} />
                    </div>
                    <div className="text-xl font-bold tracking-[-0.01em]">Starting your report…</div>
                    <div className="mt-2 text-[13.5px] text-muted">Connecting your web call with Emma</div>
                    <div className="mt-[22px] flex items-center gap-2 font-mono text-xs text-muted">
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-lavender-deep border-t-violet" />
                      Powered by Hey Emma
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-col px-[26px] py-6">
                    <div className="mb-[18px] flex items-center gap-3">
                      <span className="bg-gradient-brand flex h-12 w-12 flex-none items-center justify-center rounded-[14px]">
                        <Wave count={4} h={18} w={3} />
                      </span>
                      <div className="flex-1">
                        <div className="text-[17px] font-bold tracking-[-0.01em]">Emma is reporting</div>
                        <div className="mt-0.5 font-mono text-xs text-muted">
                          {mode === "live" ? "live report" : "preview"} · {winLabel}
                          {agentName ? ` · ${agentName}` : ""}
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-danger/25 bg-danger/10 py-1.5 pl-2.5 pr-3 font-display text-xs font-medium text-danger">
                        <span className="h-[7px] w-[7px] animate-blink rounded-full bg-danger" />
                        {mode === "live" ? statusLabel(status) : "Preview"}
                      </span>
                    </div>

                    {summary ? (
                      <div className="mb-3 flex gap-2">
                        <span className="rounded-full border border-ink/10 bg-lavender/60 px-3 py-1 font-mono text-[11px] text-ink">
                          {summary.schedule_count} on today’s schedule
                        </span>
                        <span className="rounded-full border border-ink/10 bg-lavender/60 px-3 py-1 font-mono text-[11px] text-ink">
                          {summary.loom_count} outstanding loom{summary.loom_count === 1 ? "" : "s"}
                        </span>
                      </div>
                    ) : null}

                    {liveError ? (
                      <div className="mb-3 rounded-[11px] border border-ink/10 bg-lavender px-3.5 py-2.5 text-[12.5px] leading-[1.45] text-muted">
                        {liveError}
                      </div>
                    ) : null}
                    {audioBlocked ? (
                      <button
                        onClick={enableAudio}
                        className="mb-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[11px] bg-violet px-4 py-2.5 font-display text-sm font-medium text-white hover:bg-[#5d3df0]"
                      >
                        <svg width="16" height="16" viewBox="0 0 20 20" fill="#fff">
                          <path d="M4 8v4h3l4 3V5L7 8H4z" />
                          <path d="M14 7a4 4 0 010 6" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                        </svg>
                        Tap to hear Emma
                      </button>
                    ) : null}

                    <div className="mb-[11px] font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                      Transcript
                    </div>
                    <div
                      ref={scrollRef}
                      className="mb-5 min-h-[180px] flex-1 overflow-y-auto rounded-[13px] border border-ink/10 bg-lavender/30 px-4 py-3.5"
                    >
                      {entries.length === 0 ? (
                        <div className="flex h-full min-h-[150px] items-center justify-center gap-2 font-mono text-[12px] text-muted">
                          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-lavender-deep border-t-violet" />
                          Emma is gathering your numbers…
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3">
                          {entries.map((e, idx) => (
                            <TranscriptLine key={`${e.at}-${idx}`} entry={e} />
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2.5">
                      <button
                        onClick={toggleMute}
                        disabled={!audio}
                        className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-[11px] border border-ink/10 bg-white py-3 font-display text-sm font-medium text-ink hover:bg-lavender disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="7.5" y="3" width="5" height="9" rx="2.5" />
                          <path d="M5 9a5 5 0 0010 0M10 14v3" />
                        </svg>
                        {muted ? "Unmute" : "Mute"}
                      </button>
                      <button
                        onClick={close}
                        className="flex cursor-pointer items-center gap-2 rounded-[11px] bg-danger px-5 py-3 font-display text-sm font-medium text-white"
                      >
                        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 4l3 1 1 3-2 1a8 8 0 004 4l1-2 3 1 1 3a2 2 0 01-2 2A12 12 0 013 6a2 2 0 012-2z" />
                          <path d="M16 4L4 16" />
                        </svg>
                        End report
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function TranscriptLine({ entry }: { entry: TranscriptEntry }) {
  const isUser = entry.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[82%]">
        <div className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
          {isUser ? "You" : "Emma"}
        </div>
        <div
          className={`rounded-[12px] px-3.5 py-2.5 text-[13.5px] leading-[1.45] ${
            isUser ? "bg-violet text-white" : "border border-ink/10 bg-white text-ink"
          }`}
        >
          {entry.text}
        </div>
      </div>
    </div>
  );
}
