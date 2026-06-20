"use client";

import { Badge } from "@/components/ui/Badge";
import { fullName, relTime } from "@/lib/format";
import type { Lead } from "@/lib/types";

function hasPii(lead: Lead): boolean {
  return Boolean(lead.first_name || lead.last_name || lead.phone || lead.email);
}

export function LeadDrawer({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  if (!lead) return null;
  const pii = hasPii(lead);
  const name = fullName(lead.first_name, lead.last_name);
  const title = pii ? (name ?? lead.id) : lead.id;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex justify-end bg-ink/30 backdrop-blur-[2px]"
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="h-screen w-[440px] max-w-[92vw] animate-fade-up overflow-y-auto bg-white shadow-[-12px_0_40px_rgba(26,43,46,0.18)]"
      >
        <div className="relative overflow-hidden bg-ink px-[26px] py-6">
          <div className="absolute -right-12 -top-32 h-[220px] w-[220px] rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.5),transparent_62%)]" />
          <div className="relative flex items-start justify-between">
            <div>
              <div className="font-mono text-[11px] tracking-[0.08em] text-violet-light">
                {lead.id}
              </div>
              <div className="mt-1.5 text-[23px] font-bold tracking-[-0.01em] text-white">
                {title}
              </div>
              <div className="mt-3">
                <Badge kind="lead" value={lead.status} />
              </div>
            </div>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-white/10 text-base text-white"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="px-[26px] py-6">
          <SectionLabel>Contact</SectionLabel>
          {!pii ? (
            <div className="mb-6 flex items-start gap-[11px] rounded-[12px] border border-lavender-deep bg-lavender px-4 py-3.5">
              <svg
                width="18"
                height="18"
                viewBox="0 0 20 20"
                fill="none"
                stroke="#6D4AFF"
                strokeWidth="1.7"
                className="mt-px flex-none"
              >
                <rect x="4" y="9" width="12" height="8" rx="2" />
                <path d="M7 9V6a3 3 0 016 0v3" />
              </svg>
              <div>
                <div className="text-[13.5px] font-medium">Contact details hidden</div>
                <div className="mt-0.5 text-[12.5px] leading-[1.45] text-muted">
                  This lead arrived without consented PII. Fields appear once contact
                  info is captured.
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-6 flex flex-col gap-px overflow-hidden rounded-[12px] border border-ink/10">
              <Row label="Name" value={name ?? "—"} bg="bg-white" />
              <Row label="Phone" value={lead.phone ?? "—"} bg="bg-surface-tint" />
              <Row label="Email" value={lead.email ?? "—"} bg="bg-white" />
            </div>
          )}

          <SectionLabel>Details</SectionLabel>
          <div className="mb-6 flex flex-col gap-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted">Source</span>
              <Badge kind="source" value={lead.source} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted">Assigned agent</span>
              <span className="text-[13px] font-medium">{lead.agent ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted">Last updated</span>
              <span className="font-mono text-[13px]" suppressHydrationWarning>
                {relTime(lead.updated_at)}
              </span>
            </div>
          </div>

          {lead.context ? (
            <>
              <SectionLabel>Lead context</SectionLabel>
              <div className="mb-6 rounded-[12px] border border-lavender-deep bg-lavender px-4 py-3.5 text-[13.5px] leading-[1.55] text-ink">
                {lead.context}
              </div>
            </>
          ) : null}

          {lead.activity ? (
            <>
              <SectionLabel>Latest activity</SectionLabel>
              <div className="flex items-start gap-[11px] rounded-[12px] border border-ink/10 bg-surface-tint px-4 py-3.5">
                <span className="mt-[5px] h-2 w-2 flex-none rounded-full bg-violet" />
                <div>
                  <div className="text-[13.5px]">{lead.activity}</div>
                  <div
                    className="mt-0.5 font-mono text-[11px] text-muted"
                    suppressHydrationWarning
                  >
                    {relTime(lead.updated_at)}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">
      {children}
    </div>
  );
}

function Row({ label, value, bg }: { label: string; value: string; bg: string }) {
  return (
    <div className={`flex justify-between px-4 py-3 ${bg}`}>
      <span className="text-[13px] text-muted">{label}</span>
      <span className="font-mono text-[13px]">{value}</span>
    </div>
  );
}
