import { PipelineBoard } from "@/components/dashboard/pipeline/PipelineBoard";
import { ErrorState } from "@/components/ui/states/ErrorState";
import { ERROR_COPY } from "@/lib/copy";
import { OliviaError } from "@/lib/olivia/errors";
import { fetchPipelines } from "@/lib/olivia/service";
import { defaultPipelineId, visiblePipelines } from "@/lib/pipeline/board";
import { type PrefetchMap } from "@/lib/pipeline/types";
import { prefetchPipelineStageLeads } from "./prefetch";

export default async function PipelinePage() {
  let result;
  try {
    result = await fetchPipelines();
  } catch (e) {
    const forbidden = e instanceof OliviaError && e.code === "forbidden_scope";
    return (
      <ErrorState
        copy={
          forbidden
            ? {
                title: "Pipeline access isn't enabled",
                body: "This dashboard isn't permitted to read this client's pipeline. Contact your Hey Emma administrator.",
              }
            : ERROR_COPY.trends
        }
      />
    );
  }

  const pipelines = result.data;
  const activeId = defaultPipelineId(pipelines);
  const active = visiblePipelines(pipelines).find((p) => p.id === activeId) ?? null;
  const map: PrefetchMap = active ? await prefetchPipelineStageLeads(active) : {};

  return (
    <PipelineBoard
      initialPipelines={pipelines}
      initialMap={map}
      initialFetchedAt={result.freshness.fetchedAt}
      initialStale={result.freshness.stale}
    />
  );
}
