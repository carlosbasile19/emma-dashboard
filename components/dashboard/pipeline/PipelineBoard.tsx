"use client";
import { useCallback, useMemo, useState, useTransition } from "react";
import { loadPipelineStages, refreshBoard } from "@/app/dashboard/trends/actions";
import { StageColumn } from "@/components/dashboard/pipeline/StageColumn";
import { FreshnessNote } from "@/components/ui/FreshnessNote";
import { EmptyState } from "@/components/ui/states/EmptyState";
import { EMPTY_COPY } from "@/lib/copy";
import { relTime } from "@/lib/format";
import {
  defaultPipelineId,
  sortStagesForBoard,
  stageKey,
  visiblePipelines,
} from "@/lib/pipeline/board";
import { type PrefetchMap } from "@/lib/pipeline/types";
import type { PipelinesResponse } from "@/lib/types";

export function PipelineBoard({
  initialPipelines,
  initialMap,
  initialFetchedAt,
  initialStale,
}: {
  initialPipelines: PipelinesResponse;
  initialMap: PrefetchMap;
  initialFetchedAt: number;
  initialStale: boolean;
}) {
  const [pipelines, setPipelines] = useState(initialPipelines);
  const [activeId, setActiveId] = useState<string | null>(() => defaultPipelineId(initialPipelines));
  const [map, setMap] = useState<PrefetchMap>(initialMap);
  const [fetchedAt, setFetchedAt] = useState(initialFetchedAt);
  const [stale, setStale] = useState(initialStale);
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set(activeId ? [activeId] : []));
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => visiblePipelines(pipelines), [pipelines]);
  const active = visible.find((p) => p.id === activeId) ?? visible[0] ?? null;

  const activateTab = useCallback(
    (id: string) => {
      setActiveId(id);
      if (!loaded.has(id)) {
        setLoaded((prev) => new Set(prev).add(id));
        startTransition(async () => {
          const res = await loadPipelineStages(id);
          if (res.ok) setMap((m) => ({ ...m, ...res.map }));
        });
      }
    },
    [loaded],
  );

  const onRefresh = useCallback(() => {
    if (!active) return;
    const id = active.id;
    startTransition(async () => {
      const res = await refreshBoard(id);
      if (res.ok) {
        setPipelines(res.pipelines);
        setMap(res.map);
        setFetchedAt(res.fetchedAt);
        setStale(res.stale);
        setLoaded(new Set([id]));
      }
    });
  }, [active]);

  if (visible.length === 0) {
    return <EmptyState copy={EMPTY_COPY.trends} />;
  }

  const stages = active ? sortStagesForBoard(active.stages) : [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {visible.length > 1
            ? visible.map((p) => (
                <button
                  key={p.id}
                  onClick={() => activateTab(p.id)}
                  className={`cursor-pointer rounded-[10px] px-3 py-1.5 text-[13px] font-medium ${
                    p.id === active?.id
                      ? "bg-ink text-white"
                      : "border border-ink/10 bg-white text-muted hover:bg-lavender"
                  }`}
                >
                  {p.name}
                </button>
              ))
            : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[12px] text-muted" suppressHydrationWarning>
            updated {relTime(new Date(fetchedAt).toISOString())}
          </span>
          <button
            onClick={onRefresh}
            disabled={pending}
            className="cursor-pointer rounded-[10px] border border-ink/10 bg-white px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-lavender disabled:opacity-50"
          >
            {pending ? "Refreshing…" : "⟳ Refresh"}
          </button>
        </div>
      </div>

      <FreshnessNote freshness={{ fetchedAt, stale }} />

      {stages.length === 0 ? (
        <EmptyState
          copy={{
            title: "This pipeline has no stages",
            body: "There are no active stages in this pipeline yet.",
          }}
        />
      ) : (
        <div role="group" aria-label="Pipeline stages" tabIndex={0} className="flex gap-3 overflow-x-auto pb-3">
          {stages.map((stage, i) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              index={i}
              initial={active ? map[stageKey(active.id, stage.id)] : undefined}
            />
          ))}
        </div>
      )}
    </>
  );
}
