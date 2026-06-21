"use client";

import { useEffect, useRef, useState } from "react";
import type { RetellWebClient } from "retell-client-js-sdk";
import { beginBrief, endBrief } from "@/app/auth/actions";
import { tint } from "@/lib/design";
import type { BriefCategory, BriefItem } from "@/lib/overview";

type Step = "form" | "connecting" | "live";
type Focus = "all" | BriefCategory;
// "pending" = deciding (real briefing creds in flight); "live" = a real Retell web call is
// connected (audio); "sim" = no live session, run the local walkthrough animation.
type Transport = "pending" | "live" | "sim";

const FOCUS_OPTIONS: Array<{ v: Focus; l: string }> = [
  { v: "all", l: "Everything" },
  { v: "bookings", l: "Bookings" },
  { v: "leads", l: "Leads" },
  { v: "campaigns", l: "Campaigns" },
];

const EqIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="#fff">
    <rect x="3" y="8" width="2.3" height="4" rx="1.15" />
    <rect x="7" y="5" width="2.3" height="10" rx="1.15" />
    <rect x="11" y="3" width="2.3" height="14" rx="1.15" />
    <rect x="15" y="7" width="2.3" height="6" rx="1.15" />
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

export function BriefEmma({
  items,
  rangeLabel,
  range,
}: {
  items: BriefItem[];
  rangeLabel: string;
  range: string;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [focus, setFocus] = useState<Focus>("all");
  const [callId, setCallId] = useState("");
  const [liveIdx, setLiveIdx] = useState(0);
  const [briefingId, setBriefingId] = useState<string | null>(null);
  const [transport, setTransport] = useState<Transport>("sim");
  const [muted, setMuted] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const retellRef = useRef<RetellWebClient | null>(null);

  const filtered = focus === "all" ? items : items.filter((i) => i.category === focus);
  const countLabel = `${filtered.length} item${filtered.length === 1 ? "" : "s"}`;

  function close() {
    // Tear down the live call first; null the ref before stopCall so the "call_ended"
    // handler (which also calls close) can't loop back into another stopCall.
    const client = retellRef.current;
    retellRef.current = null;
    if (client) {
      try {
        client.stopCall();
      } catch {
        /* already torn down */
      }
    }
    if (briefingId) endBrief(briefingId).catch(() => {});
    if (timer.current) clearTimeout(timer.current);
    if (ticker.current) clearInterval(ticker.current);
    setOpen(false);
    setStep("form");
    setLiveIdx(0);
    setBriefingId(null);
    setTransport("sim");
    setMuted(false);
    setLiveError(null);
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
          /* no live call to mute */
        }
      }
      return next;
    });
  }

  function start() {
    if (filtered.length === 0) return;
    setCallId(`BR-${Math.floor(1000 + Math.random() * 8999)}`);
    setLiveIdx(0);
    setMuted(false);
    setLiveError(null);
    setTransport("pending"); // hold the simulated walkthrough until we know if a live call connects
    setStep("connecting");
    beginBrief(range, focus)
      .then(async (s) => {
        if (s.briefingId) {
          setBriefingId(s.briefingId);
          setCallId(s.briefingId);
        }

        // The bridge returns the Retell join token as realtime.access_token (the documented shape)
        // or realtime.token (the generic transport shape the backend currently emits) — accept
        // either. No token → no call to join, so run the local walkthrough.
        const rt = s.realtime;
        const accessToken = rt?.access_token ?? rt?.token;
        if (s.mode !== "live" || !accessToken) {
          setTransport("sim");
          return;
        }

        // Live: join Emma's Retell web call. The SDK is browser-only (WebRTC/mic), so load it
        // lazily here — keeps it out of the SSR + initial client bundle.
        try {
          const { RetellWebClient } = await import("retell-client-js-sdk");
          const client = new RetellWebClient();
          retellRef.current = client;
          client.on("call_started", () => {
            setTransport("live");
            setStep("live");
          });
          client.on("call_ended", () => close());
          client.on("error", () => {
            // Audio dropped mid-call → degrade to the silent walkthrough rather than ejecting
            // the user from the modal.
            const c = retellRef.current;
            retellRef.current = null;
            if (c) {
              try {
                c.stopCall();
              } catch {
                /* already torn down */
              }
            }
            setLiveError("Emma’s audio dropped — showing the walkthrough instead.");
            setTransport("sim");
            setStep("live");
          });
          await client.startCall({
            accessToken,
            ...(rt?.sample_rate ? { sampleRate: rt.sample_rate } : {}),
          });
        } catch {
          // startCall rejected (mic permission denied, token expired) or the SDK failed to load.
          retellRef.current = null;
          setLiveError(
            "Couldn’t start the audio call — check microphone permissions. Showing the walkthrough.",
          );
          setTransport("sim");
        }
      })
      .catch(() => {
        // beginBrief itself failed → fall back to the walkthrough.
        setTransport("sim");
      });
  }

  // connecting → live (simulated only; a real call transitions on the "call_started" event)
  useEffect(() => {
    if (step !== "connecting" || transport !== "sim") return;
    timer.current = setTimeout(() => setStep("live"), 1600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [step, transport]);

  // advance the "speaking now" item (simulated only — the real call carries the audio; per-item
  // sync from the backend's current_item_id is a follow-up, see docs/olivia-briefing-bridge.md §4.2)
  useEffect(() => {
    if (step !== "live" || transport !== "sim") return;
    ticker.current = setInterval(() => {
      setLiveIdx((i) => (i + 1 < filtered.length ? i + 1 : i));
    }, 2600);
    return () => {
      if (ticker.current) clearInterval(ticker.current);
    };
  }, [step, transport, filtered.length]);

  return (
    <>
      <button
        onClick={() => {
          setStep("form");
          setOpen(true);
        }}
        className="mt-5 inline-flex cursor-pointer items-center gap-2.5 rounded-[12px] bg-white px-5 py-3 text-[14.5px] font-semibold text-ink shadow-[0_8px_22px_rgba(26,43,46,0.28)] transition hover:bg-lavender"
      >
        <span className="bg-gradient-brand flex h-[26px] w-[26px] items-center justify-center rounded-[8px]">
          <EqIcon />
        </span>
        Brief Emma
      </button>

      {open ? (
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
                  <div className="text-[23px] font-bold tracking-[-0.02em]">Brief Emma</div>
                  <button
                    onClick={close}
                    className="h-[30px] w-[30px] cursor-pointer rounded-lg text-base text-muted hover:bg-lavender"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex items-start gap-3.5 border-b border-ink/10 px-[26px] pb-5 pt-3.5">
                  <span className="bg-gradient-brand flex h-11 w-11 flex-none items-center justify-center rounded-[12px]">
                    <EqIcon size={20} />
                  </span>
                  <div>
                    <div className="text-base font-semibold tracking-[-0.01em]">
                      Catch up in 60 seconds
                    </div>
                    <div className="mt-0.5 text-[13.5px] leading-[1.5] text-muted">
                      Emma will web-call you and walk through your bookings, leads to chase and
                      campaign results — in priority order.
                    </div>
                  </div>
                </div>

                <div className="overflow-y-auto px-[26px]">
                  <div className="border-b border-ink/10 py-5">
                    <div className="mb-3 flex items-baseline justify-between">
                      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                        Window
                      </span>
                      <span className="font-mono text-[13px] text-ink">{rangeLabel}</span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-violet/30 bg-violet/10 px-3.5 py-2 font-display text-[13px] font-medium text-violet">
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="14" height="13" rx="2" />
                        <path d="M3 8h14M7 3v3M13 3v3" />
                      </svg>
                      {rangeLabel}
                    </span>
                  </div>

                  <div className="border-b border-ink/10 py-5">
                    <div className="mb-3 flex items-baseline justify-between">
                      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                        Filter
                      </span>
                    </div>
                    <div className="relative">
                      <select
                        value={focus}
                        onChange={(e) => setFocus(e.target.value as Focus)}
                        className="w-full cursor-pointer appearance-none rounded-[11px] border border-ink/10 bg-white py-3 pl-3.5 pr-9 font-display text-sm text-ink focus:border-violet focus:shadow-[0_0_0_3px_rgba(109,74,255,0.14)]"
                      >
                        {FOCUS_OPTIONS.map((o) => (
                          <option key={o.v} value={o.v}>
                            {o.l}
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted">
                        ▼
                      </span>
                    </div>
                  </div>

                  <div className="py-5">
                    <div className="mb-3 flex items-baseline justify-between">
                      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                        To brief
                      </span>
                      <span className="font-mono text-[13px] text-muted">{countLabel}</span>
                    </div>
                    {filtered.length === 0 ? (
                      <div className="rounded-[13px] border border-ink/10 px-5 py-8 text-center text-sm text-muted">
                        Nothing on the books for this window — Emma has nothing to brief.
                      </div>
                    ) : (
                      <div className="overflow-hidden rounded-[13px] border border-ink/10">
                        {filtered.map((i) => (
                          <BriefRow key={i.id} item={i} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 border-t border-ink/10 px-[26px] py-4">
                  <div className="flex flex-1 items-center gap-1.5 font-mono text-[11px] text-muted">
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="10" cy="10" r="7" />
                      <path d="M3 10h14M10 3a11 11 0 010 14M10 3a11 11 0 000 14" />
                    </svg>
                    Web call · powered by Hey Emma
                  </div>
                  <button
                    onClick={close}
                    className="cursor-pointer rounded-[11px] border border-ink/10 bg-white px-4 py-[11px] font-display text-sm font-medium text-ink hover:bg-lavender"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={start}
                    disabled={filtered.length === 0}
                    className="flex cursor-pointer items-center gap-2 rounded-[11px] bg-violet px-5 py-[11px] font-display text-sm font-medium text-white hover:bg-[#5d3df0] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg width="15" height="15" viewBox="0 0 20 20" fill="#fff">
                      <path d="M11 2L4 11h5l-1 7 7-9h-5z" />
                    </svg>
                    Start briefing
                  </button>
                </div>
              </>
            ) : step === "connecting" ? (
              <div className="flex flex-col items-center px-[26px] py-[52px] text-center">
                <div className="bg-gradient-brand mb-6 flex h-[84px] w-[84px] animate-ring items-center justify-center rounded-full">
                  <Wave count={5} h={30} w={4} />
                </div>
                <div className="text-xl font-bold tracking-[-0.01em]">Starting your briefing…</div>
                <div className="mt-2 text-[13.5px] text-muted">Connecting your web call with Emma</div>
                <div className="mt-[22px] flex items-center gap-2 font-mono text-xs text-muted">
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-lavender-deep border-t-violet" />
                  Powered by Hey Emma
                </div>
              </div>
            ) : (
              <div className="overflow-y-auto px-[26px] py-6">
                <div className="mb-[22px] flex items-center gap-3">
                  <span className="bg-gradient-brand flex h-12 w-12 flex-none items-center justify-center rounded-[14px]">
                    <Wave count={4} h={18} w={3} />
                  </span>
                  <div className="flex-1">
                    <div className="text-[17px] font-bold tracking-[-0.01em]">Emma is briefing you</div>
                    <div className="mt-0.5 font-mono text-xs text-muted">{callId} · web call</div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-danger/25 bg-danger/10 py-1.5 pl-2.5 pr-3 font-display text-xs font-medium text-danger">
                    <span className="h-[7px] w-[7px] animate-blink rounded-full bg-danger" />
                    {transport === "live" ? "Live" : "Preview"} · {rangeLabel}
                  </span>
                </div>
                {liveError ? (
                  <div className="mb-4 rounded-[11px] border border-ink/10 bg-lavender px-3.5 py-2.5 text-[12.5px] leading-[1.45] text-muted">
                    {liveError}
                  </div>
                ) : null}
                <div className="mb-[11px] font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                  Walking through · {countLabel}
                </div>
                <div className="mb-5 overflow-hidden rounded-[13px] border border-ink/10">
                  {filtered.map((i, idx) => (
                    <BriefRow key={i.id} item={i} speaking={idx === liveIdx} />
                  ))}
                </div>
                <div className="flex gap-2.5">
                  <button
                    onClick={toggleMute}
                    disabled={transport !== "live"}
                    className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-[11px] border border-ink/10 bg-white py-3 font-display text-sm font-medium text-ink hover:bg-lavender disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="7.5" y="3" width="5" height="9" rx="2.5" />
                      <path d="M5 9a5 5 0 0010 0M10 14v3" />
                    </svg>
                    {muted ? "Unmute" : "Mute"}
                  </button>
                  <button
                    onClick={() => setStep("form")}
                    className="cursor-pointer rounded-[11px] border border-ink/10 bg-white px-4 py-3 font-display text-sm font-medium text-ink hover:bg-lavender"
                  >
                    Re-brief
                  </button>
                  <button
                    onClick={close}
                    className="flex cursor-pointer items-center gap-2 rounded-[11px] bg-danger px-5 py-3 font-display text-sm font-medium text-white"
                  >
                    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 4l3 1 1 3-2 1a8 8 0 004 4l1-2 3 1 1 3a2 2 0 01-2 2A12 12 0 013 6a2 2 0 012-2z" />
                      <path d="M16 4L4 16" />
                    </svg>
                    End call
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function BriefRow({ item, speaking }: { item: BriefItem; speaking?: boolean }) {
  return (
    <div
      className="flex items-start gap-3 border-t border-lavender px-4 py-3.5 first:border-t-0"
      style={speaking ? { background: tint(item.color, 0.06) } : undefined}
    >
      <span
        className="mt-[5px] h-2 w-2 flex-none rounded-full"
        style={{ background: item.color }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium leading-[1.35]">{item.title}</div>
        <div className="mt-0.5 text-xs text-muted">{item.sub}</div>
        {speaking ? (
          <div className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10.5px] text-violet">
            <span className="flex items-center gap-[1.5px]">
              {[0, 0.2, 0.4].map((d) => (
                <span
                  key={d}
                  className="animate-wave rounded-full bg-violet"
                  style={{ width: 2, height: 8, transformOrigin: "center", animationDelay: `${d}s` }}
                />
              ))}
            </span>
            Speaking now
          </div>
        ) : null}
      </div>
      <span
        className="flex-none whitespace-nowrap rounded-full border px-2.5 py-0.5 font-display text-[11px] font-medium"
        style={{ color: item.color, background: tint(item.color, 0.1), borderColor: tint(item.color, 0.22) }}
      >
        {item.tag}
      </span>
    </div>
  );
}
