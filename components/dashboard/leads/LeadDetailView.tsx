"use client";

import Link from "next/link";
import { useState } from "react";
import { loadCall } from "@/app/dashboard/leads/[id]/actions";
import { NotesCard } from "@/components/dashboard/leads/NotesCard";
import { CallDrawer } from "@/components/dashboard/log/CallDrawer";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { dmChannelCode, dmChannelColor, dmChannelLabel } from "@/lib/dm";
import { STAGE_COLORS, tint } from "@/lib/design";
import { resolveStageColor } from "@/lib/pipeline/board";
import {
  centsToMoney,
  fmtEnum,
  fullName,
  initials,
  num,
  relTime,
  secToMMSS,
  shortId,
} from "@/lib/format";
import type {
  Call,
  ConversationThread,
  LeadBooking,
  LeadDetail,
  LeadStatus,
} from "@/lib/types";

// Fallback stage bar when the lead has no pipeline (or sits in an archived stage).
const FIXED_STAGES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "booked",
  "converted",
  "lost",
  "dnc",
];

export function LeadDetailView({
  detail,
  workspaceName,
  threadPreview,
  upcomingBookings,
  pastBookings,
}: {
  detail: LeadDetail;
  workspaceName: string;
  threadPreview: ConversationThread | null;
  upcomingBookings: LeadBooking[];
  pastBookings: LeadBooking[];
}) {
  const { lead, pipeline, summary, calls, conversations } = detail;
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  // The lead-detail payload embeds a SLIM call shape (no recording/transcript). Opening the
  // drawer hydrates the full row via loadCall; hydrated rows are kept so re-opens are instant.
  const [fullCalls, setFullCalls] = useState<Record<string, Call>>({});
  const [callLoadingId, setCallLoadingId] = useState<string | null>(null);
  const [callFailedId, setCallFailedId] = useState<string | null>(null);

  const openCall = (c: Call) => {
    const known = fullCalls[c.id];
    if (known) {
      setSelectedCall(known);
      return;
    }
    setSelectedCall(c);
    if (c.recording_url || c.transcript) return; // already complete — nothing to hydrate
    setCallFailedId(null);
    setCallLoadingId(c.id);
    loadCall(c.id, c.started_at)
      .then((r) => {
        if (r.ok && r.call) {
          const full = r.call;
          // Keep the stamped lead identity if the call-log row couldn't resolve a name.
          const merged: Call = {
            ...c,
            ...full,
            lead: full.lead ?? c.lead,
            lead_id: full.lead_id ?? c.lead_id,
          };
          setFullCalls((m) => ({ ...m, [c.id]: merged }));
          setSelectedCall((cur) => (cur && cur.id === c.id ? merged : cur));
        } else {
          setCallFailedId(c.id);
        }
      })
      .catch(() => setCallFailedId(c.id))
      .finally(() => setCallLoadingId((cur) => (cur === c.id ? null : cur)));
  };

  const name = fullName(lead.first_name, lead.last_name);
  const locked = lead.locked ?? !(lead.first_name || lead.last_name || lead.phone || lead.email);
  const displayName = name ?? (locked ? "PII locked" : shortId(lead.id));

  return (
    <div>
      {/* top bar: back · name · status (no edit/message/delete actions — per design) */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          href="/dashboard/leads"
          className="flex items-center gap-1.5 rounded-[10px] border border-ink/10 bg-white px-3 py-[7px] text-[13px] font-medium text-ink transition-colors hover:bg-lavender"
        >
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.5 4L6.5 10l6 6" />
          </svg>
          Back
        </Link>
        <div
          className={`flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] font-mono text-[13px] font-bold ${
            name ? "bg-gradient-brand text-white" : "border border-lavender-deep bg-lavender text-violet"
          }`}
        >
          {name ? initials(name) : <LockIcon size={14} />}
        </div>
        <div className="min-w-0">
          <h2 className="m-0 truncate text-[19px] font-bold tracking-[-0.01em]">{displayName}</h2>
          <div className="font-mono text-[11px] text-muted">{lead.id}</div>
        </div>
        <Badge kind="lead" value={lead.status} />
      </div>

      {/* pipeline stage bar */}
      <Card className="mb-4 overflow-x-auto px-4 py-3">
        <StageBar detail={detail} />
      </Card>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.7fr_1fr]">
        {/* main column */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="px-6 py-[22px]">
            <SectionLabel>Lead details</SectionLabel>
            {locked ? (
              <div className="mb-4 flex items-center gap-3 rounded-[12px] border border-lavender-deep bg-lavender px-4 py-3.5">
                <LockIcon size={16} />
                <div className="text-[13px] leading-[1.5] text-muted">
                  <span className="font-medium text-ink">Contact details hidden.</span> This
                  lead’s personal data is locked for the current API key.
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-2">
              <Row label="Email" value={lead.email} mono lockedField={locked} />
              <Row label="Phone" value={lead.phone} mono lockedField={locked} />
              {lead.instagram_handle ? (
                <Row label="Instagram" value={`@${lead.instagram_handle}`} mono />
              ) : null}
              <Row label="Client" value={workspaceName} />
              <Row label="Assigned agent" value={detail.sales_rep?.name ?? lead.agent} />
              <div>
                <div className="mb-1 text-[11px] text-muted">Source</div>
                <Badge kind="source" value={lead.source} />
              </div>
              <Row label="Last updated" value={relTime(lead.updated_at)} mono />
            </div>
            {lead.lead_context ? (
              <div className="mt-4">
                <div className="mb-1.5 text-[11px] text-muted">Lead context</div>
                <div className="rounded-[12px] border border-lavender-deep bg-lavender px-[17px] py-[15px] text-sm leading-[1.55]">
                  {lead.lead_context}
                </div>
              </div>
            ) : null}
          </Card>

          <Card className="px-6 py-[22px]">
            <SectionLabel>Conversation · DMs</SectionLabel>
            {conversations.length === 0 ? (
              <InlineEmpty>No DM threads with this lead yet.</InlineEmpty>
            ) : (
              <>
                {threadPreview ? (
                  <div className="mb-4 rounded-[12px] border border-ink/10 bg-warm/50 p-3.5">
                    {threadPreview.locked || threadPreview.messages.length === 0 ? (
                      <div className="flex items-center gap-2 py-2 text-[13px] text-muted">
                        <LockIcon size={13} />
                        {threadPreview.locked
                          ? "Messages are PII-locked for this key."
                          : "No messages in this thread yet."}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {threadPreview.messages.slice(-3).map((m, i) => (
                          <div
                            key={i}
                            className={`max-w-[85%] rounded-[12px] px-3 py-2 text-[13px] leading-[1.45] ${
                              m.from === "agent"
                                ? "bg-gradient-brand self-end rounded-br-[4px] text-white"
                                : "self-start rounded-bl-[4px] border border-ink/10 bg-white text-ink"
                            }`}
                          >
                            {m.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
                <div className="flex flex-col gap-2">
                  {conversations.map((c) => (
                    <Link
                      key={c.id}
                      href={`/dashboard/log?tab=conversations&thread=${encodeURIComponent(c.id)}`}
                      className="flex items-center gap-3 rounded-[10px] border border-ink/10 px-3.5 py-2.5 transition-colors hover:bg-lavender"
                    >
                      <ChannelBadge channel={c.channel} />
                      <span className="flex-1 text-[13px] font-medium">
                        {dmChannelLabel(c.channel)} thread
                      </span>
                      {c.last_message_at ? (
                        <span className="font-mono text-[11px] text-muted" suppressHydrationWarning>
                          {relTime(c.last_message_at)}
                        </span>
                      ) : null}
                      <span className="text-[12.5px] font-medium text-violet">
                        Open full thread →
                      </span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </Card>

          <Card className="px-6 py-[22px]">
            <div className="mb-3 flex items-baseline justify-between">
              <SectionLabel className="mb-0">Calls</SectionLabel>
              <span className="font-mono text-xs text-muted">
                {calls.length < summary.calls
                  ? `latest ${calls.length} of ${num(summary.calls)}`
                  : `${num(summary.calls)} total`}
              </span>
            </div>
            {calls.length === 0 ? (
              <InlineEmpty>No calls logged for this lead.</InlineEmpty>
            ) : (
              <div className="flex flex-col gap-2">
                {calls.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => openCall(c)}
                    className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-ink/10 px-3.5 py-2.5 text-left transition-colors hover:bg-lavender"
                  >
                    <span className="font-mono text-[11px] text-muted" suppressHydrationWarning>
                      {relTime(c.started_at)}
                    </span>
                    <Badge kind="call" value={c.status} />
                    <Badge kind="disp" value={c.disposition} />
                    <span className="ml-auto font-mono text-xs text-muted">
                      {secToMMSS(c.duration_seconds ?? 0)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card className="px-6 py-[22px]">
            <div className="mb-3 flex items-baseline justify-between">
              <SectionLabel className="mb-0">Bookings</SectionLabel>
              <span className="font-mono text-xs text-muted">
                {num(summary.bookings)} total
              </span>
            </div>
            {upcomingBookings.length === 0 && pastBookings.length === 0 ? (
              <InlineEmpty>No bookings yet — Emma is still working this lead.</InlineEmpty>
            ) : (
              <div className="flex flex-col gap-3">
                {upcomingBookings.length > 0 ? (
                  <BookingGroup label="Upcoming" bookings={upcomingBookings} />
                ) : (
                  <InlineEmpty>Nothing upcoming.</InlineEmpty>
                )}
                {pastBookings.length > 0 ? (
                  <BookingGroup label="Past" bookings={pastBookings} dim />
                ) : null}
              </div>
            )}
          </Card>

          <NotesCard leadId={lead.id} initialNotes={lead.notes ?? ""} />
        </div>

        {/* right rail: dark summary card, sticky */}
        <div className="xl:sticky xl:top-[76px]">
          <div className="relative overflow-hidden rounded-[16px] bg-ink p-6 shadow-ink">
            <div className="absolute -right-16 -top-32 h-60 w-60 rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.5),transparent_62%)]" />
            <div className="relative">
              <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.12em] text-violet-light">
                Summary
              </div>
              <div className="mb-5">
                <div className="font-mono text-[34px] font-medium tracking-[-0.02em] text-white">
                  {centsToMoney(summary.total_spend_cents, summary.currency)}
                </div>
                <div className="mt-0.5 text-[12px] text-[#8FA1A3]">Total spend · billed</div>
              </div>
              <div className="grid grid-cols-3 gap-3 border-t border-white/10 pt-4">
                <SummaryStat label="Calls" value={num(summary.calls)} />
                <SummaryStat label="Bookings" value={num(summary.bookings)} />
                <SummaryStat label="Days in pipeline" value={num(summary.days_in_pipeline)} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <CallDrawer
        call={selectedCall}
        onClose={() => setSelectedCall(null)}
        loading={selectedCall != null && callLoadingId === selectedCall.id}
        loadFailed={selectedCall != null && callFailedId === selectedCall.id}
      />
    </div>
  );
}

// ---- Stage bar ----
function StageBar({ detail }: { detail: LeadDetail }) {
  const { lead, pipeline } = detail;
  const stages = pipeline
    ? pipeline.stages.map((s, i) => ({
        key: s.id,
        label: s.name,
        color: resolveStageColor(s.color, i),
      }))
    : FIXED_STAGES.map((s) => ({
        key: s,
        label: fmtEnum(s),
        color: STAGE_COLORS[s] ?? "#5C6B6D",
      }));
  // pipeline.stage may be null (archived stage) → nothing highlighted, nothing done.
  const currentKey = pipeline ? pipeline.stage : lead.status;
  const currentIdx = stages.findIndex((s) => s.key === currentKey);

  return (
    <div className="flex min-w-max items-center gap-1.5">
      {stages.map((s, i) => {
        const done = currentIdx >= 0 && i < currentIdx;
        const current = i === currentIdx;
        return (
          <div key={s.key} className="flex items-center gap-1.5">
            {i > 0 ? <span className="h-px w-4 bg-ink/15" /> : null}
            <span
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-[5px] text-[12px] font-medium ${
                current ? "text-white" : done ? "" : "border border-ink/10 text-muted"
              }`}
              style={
                current
                  ? { background: s.color }
                  : done
                    ? { color: s.color, background: tint(s.color, 0.12) }
                    : undefined
              }
            >
              {done ? (
                <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 10.5l4 4 8-9" />
                </svg>
              ) : null}
              {s.label}
            </span>
          </div>
        );
      })}
      {pipeline ? (
        <span className="ml-2 whitespace-nowrap font-mono text-[10.5px] text-muted">
          {pipeline.name}
        </span>
      ) : null}
    </div>
  );
}

// ---- Bits ----
function BookingGroup({
  label,
  bookings,
  dim = false,
}: {
  label: string;
  bookings: LeadBooking[];
  dim?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">
        {label}
      </div>
      <div className={`flex flex-col gap-2 ${dim ? "opacity-70" : ""}`}>
        {bookings.map((b) => (
          <div
            key={b.id}
            className="flex items-center gap-3 rounded-[10px] border border-ink/10 px-3.5 py-2.5"
          >
            <span className="text-[13px] font-medium">{b.service ?? "Appointment"}</span>
            <span className="font-mono text-[11.5px] text-muted" suppressHydrationWarning>
              {new Date(b.scheduled_at).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            <span className="ml-auto">
              <Badge kind="booking" value={b.status} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const color = dmChannelColor(channel);
  return (
    <span
      className="inline-flex flex-none items-center rounded-[6px] px-[7px] py-[3px] font-mono text-[10px] font-bold tracking-[0.05em]"
      style={{ color, background: tint(color, 0.12) }}
    >
      {dmChannelCode(channel)}
    </span>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[20px] font-medium text-white">{value}</div>
      <div className="mt-0.5 text-[11px] leading-[1.35] text-[#8FA1A3]">{label}</div>
    </div>
  );
}

function SectionLabel({
  children,
  className = "mb-4",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`font-mono text-[11px] uppercase tracking-[0.12em] text-muted ${className}`}>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
  lockedField = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  lockedField?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-muted">{label}</div>
      <div
        className={`text-[13.5px] ${mono ? "font-mono text-[12.5px]" : "font-medium"} ${
          value ? "" : "text-muted"
        }`}
        suppressHydrationWarning
      >
        {value ?? (lockedField ? "•••" : "—")}
      </div>
    </div>
  );
}

function InlineEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] bg-warm px-3.5 py-4 text-center text-[13px] text-muted">
      {children}
    </div>
  );
}

function LockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none text-muted"
    >
      <rect x="4" y="9" width="12" height="8" rx="2" />
      <path d="M7 9V6a3 3 0 016 0v3" />
    </svg>
  );
}
