"use server";
import { fetchLeads, fetchPipelines } from "@/lib/olivia/service";
import { visiblePipelines } from "@/lib/pipeline/board";
import {
  STAGE_PAGE_LIMIT,
  type PipelineLoadResult,
  type RefreshResult,
  type StageLeads,
} from "@/lib/pipeline/types";
import { errCode, prefetchPipelineStageLeads } from "./prefetch";

/** One more page of cards for a stage column. */
export async function loadStageLeads(stageId: string, page: number): Promise<StageLeads> {
  if (!stageId || page < 1) return { ok: false, code: "bad_request" };
  try {
    const res = await fetchLeads({ stage_id: stageId, page, limit: STAGE_PAGE_LIMIT });
    return { ok: true, items: res.data.items, total: res.data.total, limit: res.data.limit };
  } catch (e) {
    return { ok: false, code: errCode(e) };
  }
}

/** Lazily prefetch a pipeline's stage columns when its tab is first activated. */
export async function loadPipelineStages(pipelineId: string): Promise<PipelineLoadResult> {
  if (!pipelineId) return { ok: false, error: "bad_request" };
  try {
    const resp = await fetchPipelines();
    const pipeline = visiblePipelines(resp.data).find((p) => p.id === pipelineId);
    if (!pipeline) return { ok: true, map: {} };
    return { ok: true, map: await prefetchPipelineStageLeads(pipeline) };
  } catch (e) {
    return { ok: false, error: errCode(e) };
  }
}

/** Force-refresh: bypass the SWR fresh window for /pipelines AND the active pipeline's cards. */
export async function refreshBoard(pipelineId: string): Promise<RefreshResult> {
  try {
    const fresh = await fetchPipelines({ force: true });
    const visible = visiblePipelines(fresh.data);
    const active = visible.find((p) => p.id === pipelineId) ?? visible[0] ?? null;
    const map = active ? await prefetchPipelineStageLeads(active, { force: true }) : {};
    return {
      ok: true,
      pipelines: fresh.data,
      map,
      fetchedAt: fresh.freshness.fetchedAt,
      stale: fresh.freshness.stale,
    };
  } catch (e) {
    return { ok: false, error: errCode(e) };
  }
}
