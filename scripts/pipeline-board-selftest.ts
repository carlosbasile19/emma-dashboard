import assert from "node:assert/strict";
import {
  defaultPipelineId,
  hasMoreLeads,
  isHexColor,
  isWithinWindow,
  leadCardLabel,
  leadStageSince,
  resolveStageColor,
  sortStagesForBoard,
  stageKey,
  visiblePipelines,
} from "../lib/pipeline/board";
import type { Pipeline, PipelineStage, PipelinesResponse } from "../lib/types";

function stage(p: Partial<PipelineStage>): PipelineStage {
  return {
    id: "s",
    name: "Stage",
    color: "#123456",
    stage_type: "open",
    order_index: 0,
    archived_at: null,
    lead_count: 0,
    ...p,
  };
}
function pipeline(p: Partial<Pipeline>): Pipeline {
  return {
    id: "p",
    name: "Pipeline",
    description: null,
    color: null,
    is_default: false,
    is_client_default: false,
    order_index: 0,
    archived_at: null,
    lead_count: 0,
    stages: [],
    ...p,
  };
}

(() => {
  // stageKey
  assert.equal(stageKey("p1", "s1"), "p1::s1");

  // isHexColor
  assert.equal(isHexColor("#AABBCC"), true);
  assert.equal(isHexColor("#abc"), false);
  assert.equal(isHexColor("red"), false);
  assert.equal(isHexColor(null), false);
  assert.equal(isHexColor(undefined), false);

  // resolveStageColor
  assert.equal(resolveStageColor("#0FB5AE", 0), "#0FB5AE");
  assert.equal(resolveStageColor("", 0), "#6D4AFF"); // CHART_PALETTE[0]
  assert.equal(resolveStageColor("nope", 1), "#2E86F2"); // CHART_PALETTE[1]
  assert.equal(typeof resolveStageColor(null, 99), "string"); // wraps, always a string

  // sortStagesForBoard: active by order_index, then archived-with-leads; archived-0 dropped
  const sorted = sortStagesForBoard([
    stage({ id: "b", order_index: 2 }),
    stage({ id: "a", order_index: 1 }),
    stage({ id: "arc0", order_index: 0, archived_at: "2026-01-01", lead_count: 0 }),
    stage({ id: "arc1", order_index: 5, archived_at: "2026-01-01", lead_count: 3 }),
  ]);
  assert.deepEqual(sorted.map((s) => s.id), ["a", "b", "arc1"]);

  // visiblePipelines: archived hidden; client-default first; then order_index
  const resp: PipelinesResponse = {
    client_id: "c",
    default_pipeline_id: "p2",
    pipelines: [
      pipeline({ id: "p1", order_index: 0 }),
      pipeline({ id: "arc", order_index: 1, archived_at: "2026-01-01" }),
      pipeline({ id: "p2", order_index: 2, is_client_default: true }),
    ],
  };
  assert.deepEqual(visiblePipelines(resp).map((p) => p.id), ["p2", "p1"]);

  // defaultPipelineId: client-default if visible
  assert.equal(defaultPipelineId(resp), "p2");
  // fallback to first visible when default missing
  assert.equal(
    defaultPipelineId({ client_id: "c", default_pipeline_id: null, pipelines: [pipeline({ id: "x", order_index: 4 }), pipeline({ id: "y", order_index: 1 })] }),
    "y",
  );
  // null when no visible pipelines
  assert.equal(
    defaultPipelineId({ client_id: "c", default_pipeline_id: "z", pipelines: [pipeline({ id: "z", archived_at: "2026-01-01" })] }),
    null,
  );

  // leadCardLabel
  assert.equal(leadCardLabel({ id: "bd61032d-1111", first_name: "Jane", last_name: "Doe" }), "Jane Doe");
  assert.equal(leadCardLabel({ id: "bd61032d-1111", first_name: null, last_name: null }), "Lead bd61032d");

  // leadStageSince (deterministic via fixed now)
  const now = Date.parse("2026-06-25T12:00:00Z");
  assert.equal(leadStageSince({ stage_entered_at: null }, now), null);
  assert.equal(leadStageSince({ stage_entered_at: undefined }, now), null);
  assert.equal(leadStageSince({ stage_entered_at: "2026-06-23T12:00:00Z" }, now), "2d ago");

  // hasMoreLeads
  assert.equal(hasMoreLeads(50, 120, 50, 50), true); // full page, more remain
  assert.equal(hasMoreLeads(120, 120, 20, 50), false); // reached total
  assert.equal(hasMoreLeads(30, 120, 30, 50), false); // short page → stop
  assert.equal(hasMoreLeads(0, 0, 0, 50), false); // empty stage

  // isWithinWindow (deterministic via fixed now)
  const wNow = Date.parse("2026-06-25T12:00:00Z");
  assert.equal(isWithinWindow(null, 30, wNow), false);
  assert.equal(isWithinWindow(undefined, 30, wNow), false);
  assert.equal(isWithinWindow("not-a-date", 30, wNow), false);
  assert.equal(isWithinWindow("2026-06-23T12:00:00Z", 7, wNow), true); // 2d ago, in 7d
  assert.equal(isWithinWindow("2026-06-10T12:00:00Z", 7, wNow), false); // 15d ago, out of 7d
  assert.equal(isWithinWindow("2026-06-10T12:00:00Z", 30, wNow), true); // 15d ago, in 30d
  assert.equal(isWithinWindow("2026-03-01T12:00:00Z", 90, wNow), false); // ~116d ago, out of 90d

  console.log("pipeline-board-selftest: OK");
})();
