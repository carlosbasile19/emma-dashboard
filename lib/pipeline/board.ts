// Pure board logic — no server-only imports, safe in client/server/tsx.
import { CHART_PALETTE } from "@/lib/design";
import { fullName, relTime, shortId } from "@/lib/format";
import type { Lead, Pipeline, PipelineStage, PipelinesResponse } from "@/lib/types";

/** Composite map key — stage ids are not guaranteed unique across pipelines. */
export function stageKey(pipelineId: string, stageId: string): string {
  return `${pipelineId}::${stageId}`;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export function isHexColor(value: string | null | undefined): value is string {
  return typeof value === "string" && HEX.test(value);
}

/** Valid accent color, falling back to the palette (by index) when the API value is bad. */
export function resolveStageColor(color: string | null | undefined, index: number): string {
  if (isHexColor(color)) return color;
  return CHART_PALETTE[index % CHART_PALETTE.length] ?? "#5C6B6D";
}

/** Board-ordered visible stages: active first by order_index, then archived-with-leads. */
export function sortStagesForBoard(stages: PipelineStage[]): PipelineStage[] {
  const byOrder = (a: PipelineStage, b: PipelineStage) => a.order_index - b.order_index;
  const active = stages.filter((s) => !s.archived_at).sort(byOrder);
  const archived = stages.filter((s) => s.archived_at && s.lead_count > 0).sort(byOrder);
  return [...active, ...archived];
}

/** Non-archived pipelines, client-default first, then by order_index. */
export function visiblePipelines(resp: PipelinesResponse): Pipeline[] {
  return resp.pipelines
    .filter((p) => !p.archived_at)
    .sort((a, b) => {
      if (a.is_client_default !== b.is_client_default) return a.is_client_default ? -1 : 1;
      return a.order_index - b.order_index;
    });
}

/** Default tab: client-default pipeline if visible, else first visible; null when none. */
export function defaultPipelineId(resp: PipelinesResponse): string | null {
  const visible = visiblePipelines(resp);
  if (visible.length === 0) return null;
  const preferred = visible.find((p) => p.id === resp.default_pipeline_id || p.is_client_default);
  return (preferred ?? visible[0]!).id;
}

/** Card label — real name when PII present, else a stable short id. */
export function leadCardLabel(lead: Pick<Lead, "id" | "first_name" | "last_name">): string {
  return fullName(lead.first_name, lead.last_name) ?? `Lead ${shortId(lead.id)}`;
}

/** "in stage since" suffix — null when absent (never feed relTime a null). */
export function leadStageSince(
  lead: Pick<Lead, "stage_entered_at">,
  now: number = Date.now(),
): string | null {
  if (!lead.stage_entered_at) return null;
  return relTime(lead.stage_entered_at, now) || null;
}

/** Whether a column has more pages to load. */
export function hasMoreLeads(
  loadedCount: number,
  total: number,
  lastPageCount: number,
  limit: number,
): boolean {
  return loadedCount < total && lastPageCount === limit;
}
