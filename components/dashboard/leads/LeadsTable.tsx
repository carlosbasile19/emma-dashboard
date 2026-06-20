"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { LeadDrawer } from "@/components/dashboard/leads/LeadDrawer";
import { EmptyState } from "@/components/ui/states/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { EMPTY_COPY } from "@/lib/copy";
import { fmtEnum, fullName, num, relTime } from "@/lib/format";
import { LEAD_SOURCES, LEAD_STATUSES, type Lead } from "@/lib/types";

const COLS = "grid-cols-[1.5fr_1.7fr_1fr_1.3fr_1.2fr_0.8fr]";

function hasPii(lead: Lead): boolean {
  return Boolean(lead.first_name || lead.last_name || lead.phone || lead.email);
}

export function LeadsTable({
  rows,
  total,
  page,
  pages,
  start,
  end,
  status,
  source,
}: {
  rows: Lead[];
  total: number;
  page: number;
  pages: number;
  start: number;
  end: number;
  status: string;
  source: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [selected, setSelected] = useState<Lead | null>(null);

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === "all" || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const filtered = status !== "all" || source !== "all";
  const clearFilters = () => setParam({ status: null, source: null, page: null });

  return (
    <>
      {/* filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onChange={(v) => setParam({ status: v, page: null })}
          options={[
            { v: "all", l: "All statuses" },
            ...LEAD_STATUSES.map((s) => ({ v: s, l: fmtEnum(s) })),
          ]}
        />
        <Select
          value={source}
          onChange={(v) => setParam({ source: v, page: null })}
          options={[
            { v: "all", l: "All sources" },
            ...LEAD_SOURCES.map((s) => ({ v: s, l: s })),
          ]}
        />
        {filtered ? (
          <button
            onClick={clearFilters}
            className="px-1 py-[9px] font-display text-[13px] font-medium text-violet"
          >
            Clear filters
          </button>
        ) : null}
        <div className="flex-1" />
        <span className="font-mono text-xs text-muted">
          {start}–{end} of {num(total)}
        </span>
      </div>

      {total === 0 ? (
        <div className="rounded-[16px] border border-ink/10 bg-white shadow-sm">
          <EmptyState copy={EMPTY_COPY.leads} onAction={clearFilters} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-[16px] border border-ink/10 bg-white shadow-sm">
          <div
            className={`grid ${COLS} gap-3 border-b border-ink/10 bg-surface-tint px-[22px] py-[13px]`}
          >
            {["Lead", "Contact", "Status", "Source", "Agent"].map((h) => (
              <div
                key={h}
                className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted"
              >
                {h}
              </div>
            ))}
            <div className="text-right font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">
              Updated
            </div>
          </div>

          {rows.map((r, i) => {
            const pii = hasPii(r);
            const name = fullName(r.first_name, r.last_name);
            return (
              <div
                key={r.id}
                onClick={() => setSelected(r)}
                className={`grid ${COLS} cursor-pointer items-center gap-3 border-b border-lavender px-[22px] py-3.5 hover:bg-lavender ${
                  i % 2 ? "bg-lavender/40" : "bg-white"
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{name ?? "—"}</div>
                  <div className="font-mono text-[11px] text-muted">{r.id}</div>
                </div>
                <div className="min-w-0">
                  {pii ? (
                    <div>
                      <div className="truncate font-mono text-[12.5px]">{r.phone ?? "—"}</div>
                      <div className="truncate font-mono text-[11px] text-muted">
                        {r.email ?? "—"}
                      </div>
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-[7px] border border-lavender-deep bg-lavender px-2.5 py-[3px] font-mono text-[11.5px] text-muted">
                      <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <rect x="4" y="9" width="12" height="8" rx="2" />
                        <path d="M7 9V6a3 3 0 016 0v3" />
                      </svg>
                      PII hidden
                    </span>
                  )}
                </div>
                <div>
                  <Badge kind="lead" value={r.status} />
                </div>
                <div>
                  <Badge kind="source" value={r.source} />
                </div>
                <div className="truncate text-[12.5px] text-muted">{r.agent ?? "—"}</div>
                <div
                  className="text-right font-mono text-[11.5px] text-muted"
                  suppressHydrationWarning
                >
                  {relTime(r.updated_at)}
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-between bg-surface-tint px-[22px] py-3">
            <span className="font-mono text-xs text-muted">
              Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              <PageButton
                disabled={page <= 1}
                onClick={() => setParam({ page: page - 1 <= 1 ? null : String(page - 1) })}
              >
                Previous
              </PageButton>
              <PageButton
                disabled={page >= pages}
                onClick={() => setParam({ page: String(page + 1) })}
              >
                Next
              </PageButton>
            </div>
          </div>
        </div>
      )}

      <LeadDrawer lead={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ v: string; l: string }>;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer appearance-none rounded-[10px] border border-ink/10 bg-white py-[9px] pl-[13px] pr-[30px] font-display text-[13px] text-ink"
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-[11px] top-1/2 -translate-y-1/2 text-[10px] text-muted">
        ▼
      </span>
    </div>
  );
}

function PageButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer rounded-[9px] border border-ink/10 bg-white px-3.5 py-[7px] font-display text-[13px] text-ink hover:bg-lavender disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
