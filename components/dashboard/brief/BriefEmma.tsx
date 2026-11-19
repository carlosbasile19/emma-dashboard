"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { beginBrief, endBrief } from "@/app/auth/actions";
import { connectBriefingVoice, type BriefStartResult, type VoiceHandle } from "@/lib/brief/voice";
import { rangeToBriefWindow } from "@/lib/filters";
import type { BriefItem } from "@/lib/overview";
import { useBriefingStream } from "./useBriefingStream";

type Step = "ready" | "connecting" | "session";
// "pending" = WebRTC offer/answer in flight; "live" = Emma's voice session is connected;
// "over" = a live session finished (transcript stays up); "sim" = no live session, show the
// lead picture instead of pretending a call is running.
type Transport = "pending" | "live" | "over" | "sim";

const MicIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="7.5" y="2.5" width="5" height="9" rx="2.5" />
    <path d="M5 9.5a5 5 0 0010 0M10 14.5v3" />
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

function refusedNotice(s?: BriefStartResult): string | null {
  const e = s?.error;
  if (!e) return null;
  if (e.code === "briefing_concurrency_limit" || e.code === "rate_limited") {
    const wait = e.retryAfterSeconds ? ` Try again in ${e.retryAfterSeconds}s.` : " Try again shortly.";
    return `Emma is already on as many calls as she can take.${wait}`;
  }
  if (e.code === "forbidden_scope") {
    return "Talking with Emma isn’t enabled for this workspace yet.";
  }
  return "Couldn’t connect Emma’s voice.";
}

/**
 * One entry point on the overview, in the same shape as Olivia’s “Talk to Olivia”:
 * open, then start a free conversation about the leads in the dashboard’s current range.
 * No focus picker and no separate reporting walkthrough. When the voice bridge is off,
 * the same modal shows the lead picture instead of a fake call.
 */
export function TalkToEmma({
  items,
  rangeLabel,
  range,
}: {
  items: BriefItem[];
  rangeLabel: string;
  range: string;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("ready");
  const [briefingId, setBriefingId] = useState<string | null>(null);
  const [transport, setTransport] = useState<Transport>("sim");
  const [muted, setMuted] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const voiceRef = useRef<VoiceHandle | null>(null);
  const connectRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptEnd = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<() => void>(() => {});
  const { entries, status: streamStatus } = useBriefingStream(
    briefingId,
    open && transport === "live",
  );

  // Every exit path funnels through here: POST …/end, pc.close(), mic tracks stopped. Also
  // cancels a connect that's still negotiating (its own teardown ends any created briefing).
  function endVoice() {
    connectRef.current?.abort();
    connectRef.current = null;
    const v = voiceRef.current;
    voiceRef.current = null;
    v?.close();
    setAudioBlocked(false);
  }

  function close() {
    endVoice();
    setOpen(false);
    setStep("ready");
    setBriefingId(null);
    setTransport("sim");
    setMuted(false);
    setLiveError(null);
    setCanRetry(false);
  }
  closeRef.current = close;

  // Unmount (navigating away with the modal open) must not leave the mic or the session running.
  // endVoice only touches refs and a setter, so the mount-time closure is safe to run on unmount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => endVoice(), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function toggleMute() {
    setMuted((m) => {
      voiceRef.current?.setMuted(!m);
      return !m;
    });
  }

  // Autoplay was refused — retry play() from this real click; the connection stays up meanwhile.
  function enableAudio() {
    voiceRef.current
      ?.retryPlay()
      .then((ok) => setAudioBlocked(!ok))
      .catch(() => setAudioBlocked(true));
  }

  function showLeadPicture(message: string) {
    setLiveError(message);
    setCanRetry(true);
    setTransport("sim");
    setStep("session");
  }

  function start() {
    endVoice();
    setMuted(false);
    setLiveError(null);
    setCanRetry(false);
    setBriefingId(null);
    setTransport("pending");
    setStep("connecting");

    if (typeof RTCPeerConnection === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      showLeadPicture("This browser can’t start a voice call. Here’s the lead picture instead.");
      return;
    }
    const ac = new AbortController();
    connectRef.current = ac;
    audioRef.current ??= new Audio();
    audioRef.current.autoplay = true;
    const won = () => connectRef.current === ac && !ac.signal.aborted;
    const briefWindow = rangeToBriefWindow(range);

    connectBriefingVoice({
      getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
      createPeerConnection: () => new RTCPeerConnection(),
      start: (sdp) => beginBrief(briefWindow, "all", sdp),
      end: (id) => endBrief(id),
      audio: audioRef.current,
      signal: ac.signal,
      onAudioBlocked: () => setAudioBlocked(true),
      onStopped: (reason) => {
        voiceRef.current = null;
        setAudioBlocked(false);
        setTransport("over");
        setCanRetry(true);
        setLiveError(
          reason === "expired"
            ? "This call reached its 15-minute limit."
            : "Emma’s connection dropped. You can start again.",
        );
      },
    })
      .then((r) => {
        if (!won()) return;
        connectRef.current = null;
        if (r.kind === "live") {
          voiceRef.current = r.handle;
          setBriefingId(r.handle.briefingId);
          setTransport("live");
          setStep("session");
        } else if (r.kind === "fallback") {
          showLeadPicture(
            r.reason === "mic_denied"
              ? "Emma needs your microphone so she can hear you. Here’s the lead picture instead."
              : refusedNotice(r.session) ?? "Couldn’t connect Emma’s voice. Here’s the lead picture instead.",
          );
        }
      })
      .catch(() => {
        if (!won()) return;
        connectRef.current = null;
        showLeadPicture("Couldn’t connect Emma’s voice. Here’s the lead picture instead.");
      });
  }

  // The session finished upstream (Emma wrapped up, or it failed) → end + close + stop the mic.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (transport !== "live" || (streamStatus !== "ended" && streamStatus !== "failed")) return;
    endVoice();
    setTransport("over");
    setCanRetry(true);
    setLiveError(
      streamStatus === "failed" ? "Emma’s call failed. You can start again." : "Emma has finished.",
    );
  }, [transport, streamStatus]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: "nearest" });
  }, [entries.length]);

  const activeCall = step === "connecting" || transport === "live" || transport === "pending";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          endVoice();
          setStep("ready");
          setBriefingId(null);
          setTransport("sim");
          setMuted(false);
          setLiveError(null);
          setCanRetry(false);
          setOpen(true);
        }}
        className="mt-5 inline-flex cursor-pointer items-center gap-2.5 rounded-[12px] bg-white px-5 py-3 text-[14.5px] font-semibold text-ink shadow-[0_8px_22px_rgba(26,43,46,0.28)] transition hover:bg-lavender"
      >
        <span className="bg-gradient-brand flex h-[26px] w-[26px] items-center justify-center rounded-[8px] text-white">
          <MicIcon size={14} />
        </span>
        Talk to Emma
      </button>

      {open
        ? // Portal to <body>: the overlay is `position: fixed` and must resolve against the
          // viewport, but an ancestor in the dashboard shell (the `animate-fade-up` <main>)
          // creates a containing block that would otherwise trap it in the scrolled column.
          createPortal(
            <div
              onClick={() => {
                if (!activeCall) close();
              }}
              className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/45 p-6 backdrop-blur-[3px]"
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="talk-emma-title"
                onClick={(e) => e.stopPropagation()}
                className="relative flex max-h-[92vh] w-[540px] max-w-full animate-pop flex-col overflow-hidden rounded-[16px] bg-white text-ink shadow-lg"
              >
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="absolute right-4 top-4 z-10 h-[30px] w-[30px] cursor-pointer rounded-lg text-base text-muted hover:bg-lavender"
                >
                  ✕
                </button>

                {step === "ready" ? (
                  <div className="flex flex-col items-center px-8 pb-10 pt-12 text-center">
                    <span className="bg-gradient-brand flex h-[88px] w-[88px] items-center justify-center rounded-full text-white">
                      <MicIcon size={32} />
                    </span>
                    <h2 id="talk-emma-title" className="mt-5 text-[23px] font-bold tracking-[-0.02em]">
                      Ready when you are
                    </h2>
                    <p className="mt-2 max-w-sm text-[14.5px] leading-relaxed text-muted">
                      Ask about your leads — who’s booked, who’s hesitating, who still needs a call.
                      Just talk.
                    </p>
                    <p className="mt-3 font-mono text-[12px] text-muted">{rangeLabel}</p>
                    <button
                      type="button"
                      onClick={start}
                      className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-[12px] bg-violet px-6 py-3 font-display text-[15px] font-medium text-white hover:bg-[#5d3df0]"
                    >
                      <MicIcon size={16} />
                      Talk to Emma
                    </button>
                    <p className="mt-3 max-w-xs text-xs leading-relaxed text-muted">
                      Nothing is changed. Emma only talks about this workspace.
                    </p>
                  </div>
                ) : step === "connecting" ? (
                  <div className="flex flex-col items-center px-[26px] py-[52px] text-center">
                    <div className="bg-gradient-brand mb-6 flex h-[84px] w-[84px] animate-ring items-center justify-center rounded-full">
                      <Wave count={5} h={30} w={4} />
                    </div>
                    <h2 id="talk-emma-title" className="text-xl font-bold tracking-[-0.01em]">
                      Connecting to Emma
                    </h2>
                    <div className="mt-2 max-w-xs text-[13.5px] leading-relaxed text-muted" role="status">
                      Allow microphone access if your browser asks. This usually takes a few seconds.
                    </div>
                    <button
                      type="button"
                      onClick={close}
                      className="mt-6 cursor-pointer rounded-[11px] border border-ink/10 bg-white px-5 py-[11px] font-display text-sm font-medium text-ink hover:bg-lavender"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="overflow-y-auto px-[26px] pb-6 pt-8">
                    <div className="mb-5 flex items-center gap-3 pr-8">
                      <span className="bg-gradient-brand flex h-12 w-12 flex-none items-center justify-center rounded-[14px]">
                        <Wave count={4} h={18} w={3} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h2 id="talk-emma-title" className="text-[17px] font-bold tracking-[-0.01em]">
                          {transport === "over"
                            ? "Session ended"
                            : transport === "sim"
                              ? "Your leads"
                              : "Talking with Emma"}
                        </h2>
                        <div className="mt-0.5 font-mono text-xs text-muted">
                          {rangeLabel}
                          {transport === "live" ? " · live" : transport === "over" ? " · ended" : " · preview"}
                        </div>
                      </div>
                    </div>

                    {liveError ? (
                      <div
                        role="status"
                        className="mb-4 rounded-[11px] border border-ink/10 bg-lavender px-3.5 py-2.5 text-[12.5px] leading-[1.45] text-muted"
                      >
                        {liveError}
                      </div>
                    ) : null}

                    {audioBlocked ? (
                      <button
                        type="button"
                        onClick={enableAudio}
                        className="mb-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[11px] bg-violet px-4 py-2.5 font-display text-sm font-medium text-white hover:bg-[#5d3df0]"
                      >
                        Turn on audio to hear Emma
                      </button>
                    ) : null}

                    {transport === "sim" ? (
                      <LeadPicture items={items} />
                    ) : (
                      <div
                        role="log"
                        aria-live="polite"
                        aria-label="Conversation with Emma"
                        className="mb-5 max-h-[280px] overflow-y-auto rounded-[13px] border border-ink/10 px-4 py-3"
                      >
                        {entries.length === 0 ? (
                          <div className="text-[13px] leading-relaxed text-muted">
                            {transport === "live"
                              ? "Emma will start speaking in a moment. Interrupt her anytime."
                              : "Nothing was said."}
                          </div>
                        ) : (
                          entries.map((e) => (
                            <div key={`${e.at} ${e.role} ${e.text}`} className="py-1.5 text-[13.5px] leading-[1.45]">
                              <span className={`font-semibold ${e.role === "agent" ? "text-violet" : "text-ink"}`}>
                                {e.role === "agent" ? "Emma" : "You"}
                              </span>
                              <span className="text-ink"> — {e.text}</span>
                            </div>
                          ))
                        )}
                        <div ref={transcriptEnd} />
                      </div>
                    )}

                    <div className="flex gap-2.5">
                      {transport === "live" ? (
                        <button
                          type="button"
                          onClick={toggleMute}
                          className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-[11px] border border-ink/10 bg-white py-3 font-display text-sm font-medium text-ink hover:bg-lavender"
                        >
                          <MicIcon size={15} />
                          {muted ? "Unmute" : "Mute"}
                        </button>
                      ) : null}
                      {canRetry ? (
                        <button
                          type="button"
                          onClick={start}
                          className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-[11px] bg-violet py-3 font-display text-sm font-medium text-white hover:bg-[#5d3df0]"
                        >
                          <MicIcon size={15} />
                          Talk again
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={close}
                        className="flex cursor-pointer items-center gap-2 rounded-[11px] bg-danger px-5 py-3 font-display text-sm font-medium text-white"
                      >
                        {transport === "live" ? "End session" : "Close"}
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

function LeadPicture({ items }: { items: BriefItem[] }) {
  if (items.length === 0) {
    return (
      <div className="mb-5 rounded-[13px] border border-ink/10 px-5 py-8 text-center text-sm text-muted">
        Nothing on the books for this window — Emma has nothing to talk through yet.
      </div>
    );
  }
  return (
    <div className="mb-5 overflow-hidden rounded-[13px] border border-ink/10">
      {items.map((item) => (
        <div key={item.id} className="border-t border-lavender px-4 py-3.5 first:border-t-0">
          <div className="text-[13.5px] font-medium leading-[1.35]">{item.title}</div>
          <div className="mt-0.5 text-[13px] leading-relaxed text-muted">{item.sub}</div>
          {item.detail?.length ? (
            <ul className="mt-1.5 flex flex-col gap-1">
              {item.detail.map((line) => (
                <li key={line} className="text-[13px] leading-[1.45] text-ink/80">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}
