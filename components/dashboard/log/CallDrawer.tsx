"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import {
  formatTranscript,
  initials,
  parseTranscript,
  relTime,
  secToMMSS,
  shortId,
  type TranscriptTurn,
} from "@/lib/format";
import type { Call } from "@/lib/types";
import { useScrollLock } from "@/lib/useScrollLock";

// Deterministic waveform bar heights from the call id. The recording is served cross-origin
// without CORS headers, so the real amplitude can't be decoded client-side — these bars are a
// progress visualization (they fill to the live playhead and are seekable), not literal audio.
function waveform(id: string): number[] {
  let seed = id.length * 97 + 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  return Array.from({ length: 48 }, () => 5 + Math.round(rnd() * 21));
}

export function CallDrawer({ call, onClose }: { call: Call | null; onClose: () => void }) {
  useScrollLock(Boolean(call));
  if (!call) return null;
  const hasRecording = Boolean(call.recording_url) && (call.duration_seconds ?? 0) > 0;

  // Portal to <body>: the overlay is `position: fixed` and must resolve against the
  // viewport, but an ancestor in the dashboard shell (the `animate-fade-up` <main>) creates
  // a containing block that would otherwise trap it inside the scrolled content column.
  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex justify-end bg-ink/30 backdrop-blur-[2px]"
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="h-screen w-[460px] max-w-[92vw] animate-fade-up overflow-y-auto overscroll-contain bg-white shadow-[-12px_0_40px_rgba(26,43,46,0.18)]"
      >
        <div className="flex items-start justify-between border-b border-ink/10 px-[26px] py-[22px]">
          <div>
            <div className="font-mono text-[11px] tracking-[0.08em] text-muted">
              {shortId(call.id)} · {call.direction === "inbound" ? "Inbound" : "Outbound"}
            </div>
            <div className="mt-1.5 text-[21px] font-bold tracking-[-0.01em]">
              {call.lead ?? shortId(call.lead_id)}
            </div>
            <div className="mt-3 flex gap-2">
              <Badge kind="call" value={call.status} />
              <Badge kind="disp" value={call.disposition} />
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-ink/10 bg-white text-[15px] text-ink"
          >
            ✕
          </button>
        </div>

        <div className="px-[26px] py-[22px]">
          <div className="mb-6 grid grid-cols-2 gap-3.5">
            <Field label="Agent" value={call.agent ?? "—"} />
            <Field label="Duration" value={secToMMSS(call.duration_seconds ?? 0)} mono />
            <Field label="When" value={relTime(call.started_at)} mono />
            <Field
              label="Direction"
              value={call.direction === "inbound" ? "Inbound" : "Outbound"}
            />
          </div>

          <div className="mb-2.5 flex items-center justify-between">
            <Label>Recording</Label>
            {hasRecording && call.recording_url ? (
              <a
                href={`/api/calls/${call.id}/recording?src=${encodeURIComponent(call.recording_url)}`}
                download
                className="flex flex-none items-center gap-1.5 rounded-[8px] border border-ink/10 bg-white px-2.5 py-1.5 font-display text-[12px] font-medium text-ink transition-colors hover:bg-lavender"
              >
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M10 3v9" />
                  <path d="M6 9.5l4 4 4-4" />
                  <path d="M4 16.5h12" />
                </svg>
                Download
              </a>
            ) : null}
          </div>
          {hasRecording ? (
            <RecordingPlayer key={call.id} call={call} />
          ) : (
            <div className="mb-6 rounded-[12px] border border-dashed border-lavender-deep bg-surface-tint p-4 text-center text-[13px] text-muted">
              No recording — the call ended before it connected.
            </div>
          )}

          {call.callback_notes ? (
            <>
              <Label>Summary</Label>
              <div className="mb-6 rounded-[12px] border border-lavender-deep bg-lavender px-[17px] py-[15px] text-sm leading-[1.55]">
                {call.callback_notes}
              </div>
            </>
          ) : null}

          <Transcript call={call} />
        </div>
      </aside>
    </div>,
    document.body,
  );
}

// ---- Recording player (real <audio>, seekable) ----
function RecordingPlayer({ call }: { call: Call }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(call.duration_seconds ?? 0);
  const [failed, setFailed] = useState(false);
  const bars = useMemo(() => waveform(call.id), [call.id]);
  const progress = dur > 0 ? Math.min(1, pos / dur) : 0;

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => setFailed(true));
    else a.pause();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || dur <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = frac * dur;
    setPos(frac * dur);
  };

  if (failed) {
    return (
      <div className="mb-6 rounded-[12px] border border-dashed border-lavender-deep bg-surface-tint p-4 text-center text-[13px] text-muted">
        Recording couldn’t be loaded.{" "}
        <a
          href={call.recording_url ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-violet underline-offset-2 hover:underline"
        >
          Open the audio file
        </a>
      </div>
    );
  }

  return (
    <div className="relative mb-6 flex items-center gap-3.5 overflow-hidden rounded-[13px] bg-ink px-4 py-3.5">
      <div className="absolute -right-12 -top-32 h-[200px] w-[200px] rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.4),transparent_64%)]" />
      <audio
        ref={audioRef}
        src={call.recording_url ?? undefined}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPos(dur);
        }}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDur(d);
        }}
        onError={() => setFailed(true)}
      />
      <button
        onClick={toggle}
        aria-label={playing ? "Pause recording" : "Play recording"}
        className="bg-gradient-brand relative flex h-[42px] w-[42px] flex-none items-center justify-center rounded-full text-white shadow-[0_4px_12px_rgba(109,74,255,0.4)] transition-transform active:scale-95"
      >
        {playing ? (
          <svg width="15" height="15" viewBox="0 0 20 20" fill="#fff">
            <rect x="5" y="4" width="3.4" height="12" rx="1" />
            <rect x="11.6" y="4" width="3.4" height="12" rx="1" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 20 20" fill="#fff">
            <path d="M6 4l11 6-11 6z" />
          </svg>
        )}
      </button>
      <div
        onClick={seek}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur)}
        aria-valuenow={Math.round(pos)}
        tabIndex={0}
        className="group relative flex h-[30px] min-w-0 flex-1 cursor-pointer items-center gap-0.5"
      >
        {bars.map((h, i) => (
          <span
            key={i}
            className="flex-1 rounded-[9px] transition-colors"
            style={{
              height: `${h}px`,
              background:
                i / bars.length <= progress ? "#A48BFF" : "rgba(255,255,255,0.20)",
            }}
          />
        ))}
      </div>
      <div className="relative flex-none whitespace-nowrap font-mono text-xs text-white tabular-nums">
        {secToMMSS(Math.floor(pos))} / {secToMMSS(Math.floor(dur))}
      </div>
    </div>
  );
}

// ---- Transcript (speaker-attributed conversation) ----
function Transcript({ call }: { call: Call }) {
  const turns = useMemo(
    () => (call.transcript ? parseTranscript(call.transcript) : []),
    [call.transcript],
  );

  if (turns.length === 0) {
    return (
      <>
        <Label>Transcript</Label>
        <div className="rounded-[12px] border border-dashed border-lavender-deep bg-surface-tint p-[18px] text-center text-[13px] leading-[1.5] text-muted">
          No transcript for this call — it ended before a conversation began.
        </div>
      </>
    );
  }

  const agentName = call.agent ?? "Emma";
  const leadMark = call.lead ? initials(call.lead) : null;

  return (
    <>
      <div className="mb-2.5 flex items-center justify-between">
        <Label>Transcript</Label>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[10.5px] text-muted">{turns.length} turns</span>
          <CopyButton value={formatTranscript(call)} />
        </div>
      </div>
      <div className="flex flex-col gap-3.5">
        {turns.map((turn, i) => (
          <Turn
            key={i}
            turn={turn}
            agentName={agentName}
            leadName="Lead"
            leadMark={leadMark}
          />
        ))}
      </div>
    </>
  );
}

function Turn({
  turn,
  agentName,
  leadName,
  leadMark,
}: {
  turn: TranscriptTurn;
  agentName: string;
  leadName: string;
  leadMark: string | null;
}) {
  const isAgent = turn.speaker === "agent";
  return (
    <div className="flex gap-2.5">
      <div
        className={`mt-[3px] flex h-7 w-7 flex-none items-center justify-center rounded-full text-[10px] font-bold ${
          isAgent
            ? "bg-gradient-brand text-white"
            : "border border-lavender-deep bg-lavender text-violet"
        }`}
      >
        {isAgent ? (
          <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor">
            <rect x="3" y="8" width="2" height="4" rx="1" />
            <rect x="7" y="5" width="2" height="10" rx="1" />
            <rect x="11" y="3" width="2" height="14" rx="1" />
            <rect x="15" y="7.5" width="2" height="5" rx="1" />
          </svg>
        ) : leadMark ? (
          leadMark
        ) : (
          <svg
            width="13"
            height="13"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <circle cx="10" cy="7" r="3" />
            <path d="M4.5 16c0-3 2.6-4.8 5.5-4.8s5.5 1.8 5.5 4.8" />
          </svg>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.07em] text-muted">
          {isAgent ? agentName : leadName}
        </div>
        <div
          className={`rounded-[13px] rounded-tl-[4px] px-3.5 py-2.5 text-[13.5px] leading-[1.5] text-ink ${
            isAgent ? "bg-lavender" : "border border-ink/10 bg-white"
          }`}
        >
          {turn.text}
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">
      {children}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-muted">{label}</div>
      <div
        className={`text-[13.5px] ${mono ? "font-mono" : "font-medium"}`}
        suppressHydrationWarning
      >
        {value}
      </div>
    </div>
  );
}
