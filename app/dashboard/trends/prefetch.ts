import "server-only";
import { AuthError } from "@/lib/auth";
import { OliviaError } from "@/lib/olivia/errors";
import { fetchLeads } from "@/lib/olivia/service";
import { sortStagesForBoard, stageKey } from "@/lib/pipeline/board";
import { STAGE_PAGE_LIMIT, type PrefetchMap } from "@/lib/pipeline/types";
import type { Pipeline } from "@/lib/types";

export function errCode(e: unknown): string {
  if (e instanceof OliviaError) return e.code;
  if (e instanceof AuthError) return "unauthorized";
  return "error";
}

/** Page-1 leads for every board-visible stage of one pipeline; per-stage failures isolated. */
export async function prefetchPipelineStageLeads(
  pipeline: Pipeline,
  opts: { force?: boolean } = {},
): Promise<PrefetchMap> {
  const stages = sortStagesForBoard(pipeline.stages);
  const settled = await Promise.allSettled(
    stages.map((stage) =>
      fetchLeads(
        { stage_id: stage.id, page: 1, limit: STAGE_PAGE_LIMIT },
        { force: opts.force },
      ),
    ),
  );
  const map: PrefetchMap = {};
  stages.forEach((stage, i) => {
    const key = stageKey(pipeline.id, stage.id);
    const r = settled[i];
    if (r && r.status === "fulfilled") {
      map[key] = {
        ok: true,
        items: r.value.data.items,
        total: r.value.data.total,
        limit: r.value.data.limit,
      };
    } else {
      map[key] = { ok: false, code: errCode(r && r.status === "rejected" ? r.reason : undefined) };
    }
  });
  return map;
}
