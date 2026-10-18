"use client";

import { useEffect, useRef, useState } from "react";

// Mirrors the server's BriefingStatusValue / BriefTranscriptEntry. Re-declared here because the
// api/service modules are `server-only` and must never be imported into client code.
export type BriefStatusValue = "queued" | "connecting" | "live" | "ended" | "failed";
export interface BriefTranscriptEntry {
  role: "agent" | "user";
  text: string;
  at: string;
}

const TERMINAL = (s: BriefStatusValue) => s === "ended" || s === "failed";
const POLL_MS = 2000;
// Permanent failures (auth/scope/unknown session) — stop, don't spin.
const POLL_FATAL_STATUS = new Set([401, 403, 404]);
// Give up after this many consecutive transient poll failures (≈ MAX × POLL_MS of silence).
const MAX_POLL_FAILURES = 5;
const entryKey = (e: BriefTranscriptEntry) => `${e.at} ${e.role} ${e.text}`;

function isEntry(v: unknown): v is BriefTranscriptEntry {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as BriefTranscriptEntry).text === "string" &&
    ((v as BriefTranscriptEntry).role === "agent" || (v as BriefTranscriptEntry).role === "user")
  );
}

/**
 * Follows a live briefing's status, current agenda item and transcript while `active`. Prefers the
 * same-origin SSE proxy (`/api/briefing/{id}/stream`) and falls back to polling
 * (`/api/briefing/{id}`) every ~2s when the stream errors or closes (~110s) before a terminal
 * status. Each transcript turn arrives once, complete; entries are de-duplicated so an SSE→polling
 * overlap never doubles a line. The agency key never reaches the browser.
 */
export function useBriefingStream(briefingId: string | null, active: boolean) {
  const [entries, setEntries] = useState<BriefTranscriptEntry[]>([]);
  const [status, setStatus] = useState<BriefStatusValue>("connecting");
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!active || !briefingId) return;

    seen.current = new Set();
    setEntries([]);
    setStatus("connecting");
    setCurrentItemId(null);

    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    let pollFailures = 0;
    const ac = new AbortController();
    const base = `/api/briefing/${encodeURIComponent(briefingId)}`;

    const merge = (incoming: BriefTranscriptEntry[]) => {
      const fresh = incoming.filter((e) => isEntry(e) && !seen.current.has(entryKey(e)));
      if (fresh.length === 0) return;
      for (const e of fresh) seen.current.add(entryKey(e));
      setEntries((prev) => [...prev, ...fresh]);
    };

    const stop = () => {
      stopped = true;
      ac.abort();
      if (es) {
        es.close();
        es = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const fail = () => {
      setStatus("failed");
      stop();
    };

    const startPolling = () => {
      if (stopped || pollTimer) return;
      const tick = async () => {
        try {
          const res = await fetch(base, { cache: "no-store", signal: ac.signal });
          if (stopped) return;
          if (!res.ok) {
            if (POLL_FATAL_STATUS.has(res.status)) return fail();
            if (++pollFailures >= MAX_POLL_FAILURES) fail();
            return;
          }
          pollFailures = 0;
          const data = (await res.json()) as {
            status?: BriefStatusValue;
            current_item_id?: string | null;
            transcript?: BriefTranscriptEntry[];
          };
          if (stopped) return;
          if (data.current_item_id !== undefined) setCurrentItemId(data.current_item_id);
          if (Array.isArray(data.transcript)) merge(data.transcript);
          if (data.status) setStatus(data.status);
          if (data.status && TERMINAL(data.status)) stop();
        } catch {
          if (stopped) return;
          if (++pollFailures >= MAX_POLL_FAILURES) fail();
        }
      };
      pollTimer = setInterval(tick, POLL_MS);
      void tick();
    };

    const startSse = () => {
      if (typeof EventSource === "undefined") {
        startPolling();
        return;
      }
      es = new EventSource(`${base}/stream`);

      es.addEventListener("status", (ev) => {
        try {
          const { status: s } = JSON.parse((ev as MessageEvent).data) as { status: BriefStatusValue };
          if (!s) return;
          setStatus(s);
          if (TERMINAL(s)) stop();
        } catch {
          /* ignore malformed frame */
        }
      });
      es.addEventListener("item", (ev) => {
        try {
          const { current_item_id } = JSON.parse((ev as MessageEvent).data) as {
            current_item_id?: string | null;
          };
          setCurrentItemId(current_item_id ?? null);
        } catch {
          /* ignore malformed frame */
        }
      });
      es.addEventListener("transcript", (ev) => {
        try {
          merge([JSON.parse((ev as MessageEvent).data) as BriefTranscriptEntry]);
        } catch {
          /* ignore malformed frame */
        }
      });
      es.addEventListener("ended", () => {
        setStatus("ended");
        stop();
      });
      es.onerror = () => {
        // Normal end-of-stream (~110s) or a dropped connection: continue via polling.
        if (es) {
          es.close();
          es = null;
        }
        if (!stopped) startPolling();
      };
    };

    startSse();
    return stop;
  }, [briefingId, active]);

  return { entries, status, currentItemId };
}
