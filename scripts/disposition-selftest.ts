/* Display-disposition rules: short `not_interested` calls are answering machines, not refusals.
   Run: npm run test:disposition */
import assert from "node:assert/strict";
import {
  MACHINE_CALL_MAX_SECONDS,
  displayDisposition,
  isInferredVoicemail,
} from "../lib/format";
import type { Call, CallDisposition } from "../lib/types";

function call(disposition: CallDisposition, duration_seconds: number): Call {
  return {
    id: "c1",
    lead_id: "l1",
    direction: "outbound",
    status: "completed",
    disposition,
    started_at: "2026-08-07T10:00:00Z",
    created_at: "2026-08-07T10:00:00Z",
    duration_seconds,
  } as Call;
}

// The rows from the reported screenshot: 3–5s "Not interested" beside a genuine 5s Voicemail.
for (const s of [0, 2, 3, 4, 5, 7]) {
  assert.equal(displayDisposition(call("not_interested", s)), "voicemail_left", `${s}s`);
  assert.equal(isInferredVoicemail(call("not_interested", s)), true, `${s}s`);
}
console.log(`  ✓ not_interested under ${MACHINE_CALL_MAX_SECONDS}s shows as Voicemail`);

// The boundary is exclusive, and real conversations at 10s+ ("Hello? Hello?" / "From where,
// sorry?") must keep their upstream disposition — that is the whole point of the cutoff.
for (const s of [8, 9, 10, 11, 14, 30, 300]) {
  assert.equal(displayDisposition(call("not_interested", s)), "not_interested", `${s}s`);
  assert.equal(isInferredVoicemail(call("not_interested", s)), false, `${s}s`);
}
console.log(`  ✓ not_interested at ${MACHINE_CALL_MAX_SECONDS}s and above is left alone`);

// Only not_interested is reinterpreted. A 2s `interested` or `booked` is upstream's business.
for (const d of [
  "interested",
  "callback_requested",
  "wrong_number",
  "voicemail_left",
  "booked",
  "dnc",
  "no_disposition",
] as CallDisposition[]) {
  assert.equal(displayDisposition(call(d, 1)), d, d);
  assert.equal(isInferredVoicemail(call(d, 1)), false, d);
}
console.log("  ✓ every other disposition passes through untouched");

// The slim call shape from /leads/{id} can omit duration_seconds; absent must not read as 0
// and silently flip a row. Treat a missing duration as unknown → leave the row alone.
const noDuration = { disposition: "not_interested" } as unknown as Call;
assert.equal(displayDisposition(noDuration), "not_interested");
assert.equal(isInferredVoicemail(noDuration), false);
console.log("  ✓ a missing duration does not flip the row");

console.log("\ndisposition selftest passed");
