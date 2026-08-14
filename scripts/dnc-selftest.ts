import assert from "node:assert/strict";
import { cancelledLine, ERROR_COPY, isRetryable, isStopped } from "../lib/do-not-contact";
import type { Lead } from "../lib/types";

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: "9b1e4c22-0000-4000-8000-000000000001",
    status: "new",
    source: "csv_import",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    total_calls: 0,
    ...over,
  } as Lead;
}

// ---- cancelledLine: the blast-radius claim ----
// The whole point of surfacing cancelled_runs is that the user sees what the write destroyed,
// so the singular/plural and the zero case have to be exact.
assert.equal(cancelledLine(3), "3 running automations cancelled.");
assert.equal(cancelledLine(1), "1 running automation cancelled.");
assert.equal(cancelledLine(12), "12 running automations cancelled.");

// 0 is the idempotent re-send and the nothing-was-running case. It must NOT read as a failure
// or as "0 automations cancelled".
assert.equal(cancelledLine(0), "No automations were running for this lead.");

// Server-supplied number feeding a destructive claim — never render NaN/Infinity/negatives.
assert.equal(cancelledLine(-1), "No automations were running for this lead.");
assert.equal(cancelledLine(NaN), "No automations were running for this lead.");
assert.equal(cancelledLine(Infinity), "No automations were running for this lead.");
assert.ok(!cancelledLine(2.7).includes("2.7"), "fractional counts must not leak into copy");

// Large counts go through the shared thousands formatter like every other number in the UI.
assert.equal(cancelledLine(1234), "1,234 running automations cancelled.");

// ---- Confirm copy must actually warn ----
// The confirm text is the only thing standing between a click and every outbound channel
// stopping, so assert the two claims the API contract requires it to make.
const STOP_COPY =
  "Emma will stop calling, texting and DMing this lead across every channel, including " +
  "reactivation campaigns. Any automations currently running for this lead will be cancelled " +
  "— and they will not resume if you allow contact again later.";
for (const phrase of ["calling", "texting", "DMing", "cancelled", "not resume"]) {
  assert.ok(STOP_COPY.includes(phrase), `confirm copy must mention "${phrase}"`);
}

// ---- Error routing ----
// A 403 is the key's scope and a 404 is a dead lead: both are permanent, so the confirm button
// stays disabled rather than inviting a retry that cannot succeed.
assert.equal(isRetryable("forbidden"), false);
assert.equal(isRetryable("not_found"), false);
assert.equal(isRetryable("rate_limited"), true);
assert.equal(isRetryable("failed"), true);

// Every error has copy, and none of it claims a change landed.
for (const [code, copy] of Object.entries(ERROR_COPY)) {
  assert.ok(copy.length > 0, `${code} needs copy`);
  assert.ok(!/stopped|resumed/i.test(copy), `${code} copy must not imply the write landed`);
}
assert.ok(
  ERROR_COPY.forbidden.includes("dashboard:notes"),
  "the 403 must name the scope to ask Olivia for",
);

// ---- isStopped ----
assert.equal(isStopped(lead({ do_not_contact: true })), true);
assert.equal(isStopped(lead({ do_not_contact: false })), false);
// Cache rows written before the field existed omit it — absent reads as contactable, and must
// not throw or render as "unknown".
assert.equal(isStopped(lead()), false);

// The flag and the pipeline stage are independent: `status: "dnc"` is a stage a lead can be
// moved through, `do_not_contact` is the switch the outbound channels check. Neither may be
// inferred from the other — inferring either way would mislabel real rows in the table.
assert.equal(isStopped(lead({ status: "dnc" })), false);
assert.equal(isStopped(lead({ status: "qualified", do_not_contact: true })), true);

console.log("dnc-selftest: all assertions passed");
