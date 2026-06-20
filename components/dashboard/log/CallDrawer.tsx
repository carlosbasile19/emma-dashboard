"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { relTime, secToMMSS } from "@/lib/format";
import type { Call } from "@/lib/types";

// Deterministic waveform bar heights from the call id.
function waveform(id: string): number[] {
  let seed = id.length * 97 + 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  return Array.from({ length: 46 }, () => 6 + Math.round(rnd() * 20));
}

export function CallDrawer({ call, onClose }: { call: Call | null; onClose: () => void }) {
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const duration = call?.duration_seconds ?? 0;
  const bars = useMemo(() => (call ? waveform(call.id) : []), [call]);

  // Reset when the selected call changes.
  useEffect(() => {
    setPlaying(false);
    setPos(0);
  }, [call?.id]);

  // Simulated playback clock.
  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setPos((p) => {
        if (p + 1 >= duration) {
          setPlaying(false);
          return duration;
        }
        return p + 1;
      });
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, duration]);

  if (!call) return null;
  const hasRecording = Boolean(call.recording_url) && duration > 0;
  const hasTranscript = Boolean(call.transcript);
  const progress = duration ? pos / duration : 0;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex justify-end bg-ink/30 backdrop-blur-[2px]"
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="h-screen w-[460px] max-w-[92vw] animate-fade-up overflow-y-auto bg-white shadow-[-12px_0_40px_rgba(26,43,46,0.18)]"
      >
        <div className="flex items-start justify-between border-b border-ink/10 px-[26px] py-[22px]">
          <div>
            <div className="font-mono text-[11px] tracking-[0.08em] text-muted">
              {call.id} · {call.direction === "inbound" ? "Inbound" : "Outbound"}
            </div>
            <div className="mt-1.5 text-[21px] font-bold tracking-[-0.01em]">
              {call.lead ?? call.lead_id}
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
            <Field label="Duration" value={secToMMSS(duration)} mono />
            <Field label="When" value={relTime(call.started_at)} mono />
            <Field
              label="Direction"
              value={call.direction === "inbound" ? "Inbound" : "Outbound"}
            />
          </div>

          <Label>Recording</Label>
          {hasRecording ? (
            <div className="relative mb-6 flex items-center gap-3.5 overflow-hidden rounded-[13px] bg-ink px-4 py-3.5">
              <div className="absolute -right-12 -top-32 h-[200px] w-[200px] rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.4),transparent_64%)]" />
              <button
                onClick={() => {
                  if (pos >= duration) setPos(0);
                  setPlaying((p) => !p);
                }}
                className="bg-gradient-brand relative flex h-[42px] w-[42px] flex-none items-center justify-center rounded-full text-white shadow-[0_4px_12px_rgba(109,74,255,0.4)]"
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
              <div className="relative flex h-[30px] min-w-0 flex-1 items-center gap-0.5">
                {bars.map((h, i) => (
                  <span
                    key={i}
                    className="flex-1 rounded-[9px]"
                    style={{
                      height: `${h}px`,
                      background:
                        i / bars.length <= progress ? "#A48BFF" : "rgba(255,255,255,0.20)",
                    }}
                  />
                ))}
              </div>
              <div className="relative flex-none whitespace-nowrap font-mono text-xs text-white">
                {secToMMSS(pos)} / {secToMMSS(duration)}
              </div>
            </div>
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

          <Label>Transcript</Label>
          {hasTranscript ? (
            <div className="whitespace-pre-wrap text-[13.5px] leading-[1.5] text-ink">
              {call.transcript}
            </div>
          ) : (
            <div className="rounded-[12px] border border-dashed border-lavender-deep bg-surface-tint p-[18px] text-center text-[13px] leading-[1.5] text-muted">
              No transcript for this call — it ended before a conversation began.
            </div>
          )}
        </div>
      </aside>
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
      <div className={`text-[13.5px] ${mono ? "font-mono" : "font-medium"}`}>{value}</div>
    </div>
  );
}
