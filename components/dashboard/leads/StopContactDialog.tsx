"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  setDoNotContact,
  type DoNotContactActionResult,
} from "@/app/dashboard/leads/actions";
import { cancelledLine, ERROR_COPY, isRetryable } from "@/lib/do-not-contact";
import { useScrollLock } from "@/lib/useScrollLock";

/**
 * Confirm + run a do-not-contact change. Rendered for BOTH directions on purpose: turning it on
 * is only partly reversible, and turning it off has a surprise worth stating up front (the runs
 * cancelled earlier stay cancelled), so each direction has something the user needs before
 * clicking rather than after.
 *
 * The toggle is never flipped optimistically — `onResult` fires only once the server has
 * answered, because the cancelled-automation count in the success line comes from that response
 * and nothing local can predict it.
 */
export function StopContactDialog({
  leadId,
  leadLabel,
  /** The lead's CURRENT do_not_contact; the dialog applies the opposite. */
  current,
  onClose,
  onResult,
}: {
  leadId: string;
  leadLabel: string;
  current: boolean;
  onClose: () => void;
  /** Fires after every completed attempt — check `.ok`. Callers latch `forbidden` from here. */
  onResult: (result: DoNotContactActionResult) => void;
}) {
  const next = !current;
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<DoNotContactActionResult | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useScrollLock(true);

  // Escape closes — except mid-write, where the outcome is still unknown and dismissing would
  // leave the caller showing a state the server may have already moved past.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  // Land focus on Cancel, not the confirm button: stopping contact kills live automations, so
  // a stray Enter must not be what does it.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const apply = async () => {
    if (pending) return;
    setPending(true);
    const r = await setDoNotContact(leadId, next);
    setPending(false);
    setResult(r);
    // Report immediately so a success settles the row/toggle behind the dialog while the user
    // reads the count, and so a `forbidden` verdict can be latched — the scope is a property of
    // the key, not of this lead, so every other control should stand down too.
    onResult(r);
  };

  const done = result?.ok === true;

  return createPortal(
    <div
      onClick={() => {
        if (!pending) onClose();
      }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 px-4 backdrop-blur-[2px]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stop-contact-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] animate-fade-up rounded-[16px] bg-white p-6 shadow-[0_24px_60px_rgba(26,43,46,0.28)]"
      >
        {done ? (
          <>
            <div className="mb-3 flex items-center gap-2.5">
              <span
                className={`flex h-8 w-8 flex-none items-center justify-center rounded-full ${
                  next ? "bg-ink/8 text-ink" : "bg-success/12 text-success"
                }`}
              >
                {next ? <StopIcon size={15} /> : <CheckIcon size={15} />}
              </span>
              <h3 id="stop-contact-title" className="m-0 text-[17px] font-bold tracking-[-0.01em]">
                {next ? "Contact stopped" : "Contact resumed"}
              </h3>
            </div>
            <p className="m-0 text-[13.5px] leading-[1.55] text-muted">
              {next ? (
                <>
                  Emma will no longer call, text or DM{" "}
                  <span className="font-medium text-ink">{leadLabel}</span>.{" "}
                  {cancelledLine(result?.cancelledRuns ?? 0)}
                </>
              ) : (
                <>
                  Emma can contact <span className="font-medium text-ink">{leadLabel}</span>{" "}
                  again. Automations cancelled earlier stay cancelled — start them again if you
                  want them running.
                </>
              )}
            </p>
            <div className="mt-5 flex justify-end">
              <button
                onClick={onClose}
                autoFocus
                className="cursor-pointer rounded-[10px] bg-violet px-4 py-[9px] text-[13px] font-medium text-white transition hover:bg-[#5d3df0]"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2.5">
              <span
                className={`flex h-8 w-8 flex-none items-center justify-center rounded-full ${
                  next ? "bg-danger/10 text-danger" : "bg-violet/10 text-violet"
                }`}
              >
                {next ? <StopIcon size={15} /> : <CheckIcon size={15} />}
              </span>
              <h3 id="stop-contact-title" className="m-0 text-[17px] font-bold tracking-[-0.01em]">
                {next ? "Stop contacting this lead?" : "Allow contact again?"}
              </h3>
            </div>

            {next ? (
              <div className="text-[13.5px] leading-[1.55] text-muted">
                <p className="m-0">
                  Emma will stop calling, texting and DMing{" "}
                  <span className="font-medium text-ink">{leadLabel}</span> across every channel,
                  including reactivation campaigns.
                </p>
                <p className="mb-0 mt-2.5 rounded-[10px] border border-ink/10 bg-warm/60 px-3.5 py-3">
                  Any automations currently running for this lead will be{" "}
                  <span className="font-medium text-ink">cancelled</span> — and they will{" "}
                  <span className="font-medium text-ink">not</span> resume if you allow contact
                  again later.
                </p>
              </div>
            ) : (
              <div className="text-[13.5px] leading-[1.55] text-muted">
                <p className="m-0">
                  Emma will be able to call, text and DM{" "}
                  <span className="font-medium text-ink">{leadLabel}</span> again.
                </p>
                <p className="mb-0 mt-2.5 rounded-[10px] border border-ink/10 bg-warm/60 px-3.5 py-3">
                  Automations cancelled when contact was stopped{" "}
                  <span className="font-medium text-ink">will not resume on their own</span>.
                </p>
              </div>
            )}

            {result && !result.ok ? (
              <p className="mb-0 mt-3 text-[13px] leading-[1.5] text-danger">
                {ERROR_COPY[result.error ?? "failed"]}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2.5">
              <button
                ref={cancelRef}
                onClick={onClose}
                disabled={pending}
                className="cursor-pointer rounded-[10px] border border-ink/10 bg-white px-4 py-[9px] text-[13px] font-medium text-ink transition-colors hover:bg-lavender disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={apply}
                disabled={pending || (result?.error != null && !isRetryable(result.error))}
                className={`cursor-pointer rounded-[10px] px-4 py-[9px] text-[13px] font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  next ? "bg-danger hover:brightness-[0.94]" : "bg-violet hover:bg-[#5d3df0]"
                }`}
              >
                {pending
                  ? next
                    ? "Stopping…"
                    : "Resuming…"
                  : next
                    ? "Stop contacting"
                    : "Allow contact"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function StopIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      className="flex-none"
    >
      <circle cx="10" cy="10" r="7.25" />
      <path d="M5.1 5.1l9.8 9.8" />
    </svg>
  );
}

function CheckIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none"
    >
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}
