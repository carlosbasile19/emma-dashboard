"use client";
import { useState, useTransition } from "react";
import { loadStageLeads } from "@/app/dashboard/trends/actions";
import { LeadCard } from "@/components/dashboard/pipeline/LeadCard";
import { tint } from "@/lib/design";
import { num } from "@/lib/format";
import { hasMoreLeads, resolveStageColor } from "@/lib/pipeline/board";
import { type StageLeads } from "@/lib/pipeline/types";
import type { Lead, PipelineStage } from "@/lib/types";

const LOST_GREY = "#5C6B6D";

export function StageColumn({
  stage,
  index,
  initial,
}: {
  stage: PipelineStage;
  index: number;
  initial: StageLeads | undefined;
}) {
  const ok = initial && initial.ok ? initial : null;
  const [items, setItems] = useState<Lead[]>(ok ? ok.items : []);
  const [nextPage, setNextPage] = useState<number>(2);
  const [hasMore, setHasMore] = useState<boolean>(
    ok ? hasMoreLeads(ok.items.length, ok.total, ok.items.length, ok.limit) : false,
  );
  const [errorCode, setErrorCode] = useState<string | null>(
    initial && !initial.ok ? initial.code : null,
  );
  const [pending, startTransition] = useTransition();

  const accent = stage.stage_type === "lost" ? LOST_GREY : resolveStageColor(stage.color, index);
  const archived = Boolean(stage.archived_at);

  function loadPage(page: number, replace: boolean) {
    startTransition(async () => {
      const res = await loadStageLeads(stage.id, page);
      if (!res.ok) {
        setErrorCode(res.code);
        return;
      }
      setErrorCode(null);
      const merged = replace ? res.items : [...items, ...res.items];
      setItems(merged);
      setNextPage(page + 1);
      setHasMore(hasMoreLeads(merged.length, res.total, res.items.length, res.limit));
    });
  }

  return (
    <section
      aria-label={`${stage.name}, ${num(stage.lead_count)} leads`}
      className={`flex max-h-[70vh] w-[300px] flex-none flex-col rounded-[14px] border border-ink/10 bg-lavender/40 ${
        archived ? "opacity-60" : ""
      }`}
    >
      <header
        className="flex items-center gap-2 rounded-t-[14px] border-b px-3 py-2.5"
        style={{ borderColor: tint(accent, 0.25), background: tint(accent, 0.08) }}
      >
        <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: accent }} />
        <h3 className="m-0 flex-1 truncate text-[13px] font-semibold text-ink">
          {stage.stage_type === "won" ? "✓ " : ""}
          {stage.name}
        </h3>
        <span
          aria-label={`${num(stage.lead_count)} leads`}
          className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-muted"
        >
          {num(stage.lead_count)}
        </span>
      </header>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        {errorCode ? (
          <button
            onClick={() => loadPage(items.length ? nextPage : 1, items.length === 0)}
            disabled={pending}
            className="w-full cursor-pointer rounded-[10px] border border-danger/25 bg-danger/5 px-3 py-2 text-[12px] font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            {pending ? "Retrying…" : "Couldn't load — retry"}
          </button>
        ) : null}

        {items.map((lead) => (
          <LeadCard key={lead.id} lead={lead} />
        ))}

        {!errorCode && items.length === 0 ? (
          <div className="px-1 py-6 text-center font-mono text-[11px] text-muted">No leads</div>
        ) : null}

        {hasMore && !errorCode ? (
          <button
            onClick={() => loadPage(nextPage, false)}
            disabled={pending}
            className="mt-1 w-full cursor-pointer rounded-[10px] border border-ink/10 bg-white px-3 py-2 text-[12px] font-medium text-ink hover:bg-lavender disabled:opacity-50"
          >
            {pending ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
