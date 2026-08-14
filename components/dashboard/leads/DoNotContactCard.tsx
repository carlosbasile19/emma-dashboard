"use client";

import { useState } from "react";
import { StopContactDialog } from "@/components/dashboard/leads/StopContactDialog";
import { Card } from "@/components/ui/Card";
import type { DoNotContactActionResult } from "@/app/dashboard/leads/actions";

/**
 * Stop / resume every outbound channel for one lead.
 *
 * The switch is a dialog trigger, not a control that writes on flip: the change kills live
 * automations and is only partly reversible, so it never moves until the server confirms.
 */
export function DoNotContactCard({
  leadId,
  leadLabel,
  /** Controlled by the page so the header badge tracks the same server-confirmed value. */
  stopped,
  onStoppedChange,
}: {
  leadId: string;
  leadLabel: string;
  stopped: boolean;
  onStoppedChange: (stopped: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  // The scope belongs to the API key, not to this lead — once a write comes back 403 the
  // control is inert for every lead, so stop offering it rather than let it fail repeatedly.
  const [forbidden, setForbidden] = useState(false);

  const onResult = (r: DoNotContactActionResult) => {
    if (r.ok) onStoppedChange(r.doNotContact ?? !stopped);
    if (r.error === "forbidden") setForbidden(true);
  };

  return (
    <Card className="px-6 py-[22px]">
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
        Contact
      </div>

      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold">
              {stopped ? "Contact stopped" : "Emma can contact this lead"}
            </span>
            {stopped ? <StoppedBadge /> : null}
          </div>
          <p className="m-0 mt-1 text-[13px] leading-[1.55] text-muted">
            {stopped ? (
              <>
                Emma will not call, text or DM this lead on any channel, and they can’t be
                enrolled in reactivation campaigns. Automations cancelled when contact was
                stopped won’t resume if you turn this back on.
              </>
            ) : (
              <>
                Stopping contact halts calls, texts, DMs and campaign enrolment for this lead,
                and cancels any automations currently running for them.
              </>
            )}
          </p>
        </div>

        {forbidden ? null : (
          <Switch
            on={stopped}
            label={stopped ? "Allow contact again" : "Stop contacting this lead"}
            onClick={() => setOpen(true)}
          />
        )}
      </div>

      {forbidden ? (
        <p className="mb-0 mt-3 text-[13px] leading-[1.5] text-muted">
          Contact settings are read-only for this key — changing them needs the{" "}
          <span className="font-mono text-[12px]">dashboard:notes</span> scope.
        </p>
      ) : null}

      {open ? (
        <StopContactDialog
          leadId={leadId}
          leadLabel={leadLabel}
          current={stopped}
          onClose={() => setOpen(false)}
          onResult={onResult}
        />
      ) : null}
    </Card>
  );
}

function StoppedBadge() {
  return (
    <span className="inline-flex flex-none items-center gap-1 rounded-[6px] bg-danger/10 px-[7px] py-[3px] font-mono text-[10px] font-bold uppercase tracking-[0.05em] text-danger">
      <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="10" cy="10" r="7.25" />
        <path d="M5.1 5.1l9.8 9.8" />
      </svg>
      Stopped
    </span>
  );
}

/**
 * Rendered as a `switch` because it reports a persistent on/off state, but it only OPENS the
 * confirm dialog — `aria-checked` therefore keeps reporting the server's value until a write
 * lands, which is exactly the "don't flip optimistically" rule stated in the UI.
 */
function Switch({
  on,
  label,
  onClick,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`relative mt-0.5 h-[26px] w-[46px] flex-none cursor-pointer rounded-full border transition-colors ${
        on
          ? "border-danger/40 bg-danger"
          : "border-ink/15 bg-ink/10 hover:border-ink/25 hover:bg-ink/15"
      }`}
    >
      <span
        className={`absolute top-[2px] h-[20px] w-[20px] rounded-full bg-white shadow-[0_1px_3px_rgba(26,43,46,0.3)] transition-[left] ${
          on ? "left-[23px]" : "left-[2px]"
        }`}
      />
    </button>
  );
}
