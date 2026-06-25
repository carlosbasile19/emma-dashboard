import type { Lead, PipelinesResponse } from "@/lib/types";

/** Page size for each stage column's lead fetch. */
export const STAGE_PAGE_LIMIT = 50;

/** Serializable per-stage lead payload returned by the board's actions/prefetch. */
export type StageLeads =
  | { ok: true; items: Lead[]; total: number; limit: number }
  | { ok: false; code: string };

/** stageKey(pipelineId, stageId) → StageLeads */
export type PrefetchMap = Record<string, StageLeads>;

export type PipelineLoadResult =
  | { ok: true; map: PrefetchMap }
  | { ok: false; error: string };

export type RefreshResult =
  | { ok: true; pipelines: PipelinesResponse; map: PrefetchMap; fetchedAt: number; stale: boolean }
  | { ok: false; error: string };
