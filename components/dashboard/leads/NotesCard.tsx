"use client";

import { useRef, useState, useTransition } from "react";
import { saveNotes } from "@/app/dashboard/leads/[id]/actions";
import { Card } from "@/components/ui/Card";

const NOTES_MAX = 20_000;
// The Olivia write bucket is 120/min/key — block accidental double-submits client-side too.
const MIN_SAVE_GAP_MS = 1500;

export function NotesCard({ leadId, initialNotes }: { leadId: string; initialNotes: string }) {
  const [value, setValue] = useState(initialNotes);
  const [saved, setSaved] = useState<string | null>(null); // last persisted value
  const [status, setStatus] = useState<"idle" | "saved" | "failed" | "forbidden">("idle");
  const [pending, startTransition] = useTransition();
  const lastSaveAt = useRef(0);

  const dirty = value !== (saved ?? initialNotes);
  const readOnly = status === "forbidden";

  const save = () => {
    const now = Date.now();
    if (pending || !dirty || now - lastSaveAt.current < MIN_SAVE_GAP_MS) return;
    lastSaveAt.current = now;
    startTransition(async () => {
      const r = await saveNotes(leadId, value);
      if (r.ok) {
        // Last-write-wins: the server's copy replaces local state.
        setSaved(r.notes ?? value);
        setValue(r.notes ?? value);
        setStatus("saved");
      } else {
        setStatus(r.error === "forbidden" ? "forbidden" : "failed");
      }
    });
  };

  return (
    <Card className="px-6 py-[22px]">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Notes</div>
        {value.length > NOTES_MAX - 2000 ? (
          <span className="font-mono text-[10.5px] text-muted">
            {value.length.toLocaleString("en-US")} / {NOTES_MAX.toLocaleString("en-US")}
          </span>
        ) : null}
      </div>
      <textarea
        value={value}
        maxLength={NOTES_MAX}
        readOnly={readOnly}
        onChange={(e) => {
          setValue(e.target.value);
          if (status === "saved" || status === "failed") setStatus("idle");
        }}
        rows={5}
        placeholder="Anything worth remembering about this lead — context, promises made, follow-up angles…"
        className="w-full resize-y rounded-[12px] border border-ink/10 bg-warm/60 px-3.5 py-3 font-display text-sm leading-[1.55] text-ink outline-none transition-colors placeholder:text-muted/70 focus:border-violet/50 focus:bg-white read-only:cursor-default read-only:opacity-70"
      />
      <div className="mt-3 flex items-center gap-3">
        {readOnly ? (
          <span className="text-[13px] text-muted">
            Notes are read-only for this key — saving needs the{" "}
            <span className="font-mono text-[12px]">dashboard:notes</span> scope.
          </span>
        ) : (
          <>
            <button
              onClick={save}
              disabled={pending || !dirty}
              className="cursor-pointer rounded-[10px] bg-violet px-4 py-[9px] text-[13px] font-medium text-white shadow-[0_6px_18px_rgba(109,74,255,0.28)] transition hover:bg-[#5d3df0] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {pending ? "Saving…" : "Save note"}
            </button>
            {status === "saved" && !dirty ? (
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-success">
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 10.5l4 4 8-9" />
                </svg>
                Saved
              </span>
            ) : null}
            {status === "failed" ? (
              <span className="text-[13px] text-danger">
                Couldn’t save — try again in a moment.
              </span>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}
