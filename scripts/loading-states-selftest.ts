import assert from "node:assert/strict";
import {
  GRACE_MS,
  SLOW_MS,
  STUCK_MS,
  nextPhaseChangeMs,
  phaseFor,
} from "../lib/pending-phase";

// The anti-flicker guarantee. A navigation that resolves faster than the grace period must
// never produce a visible state — otherwise every cached filter change flashes dim-and-restore,
// which reads as jank rather than as feedback.
(() => {
  assert.equal(phaseFor(null), "idle", "not pending is idle");
  assert.equal(phaseFor(0), "idle", "a just-started navigation is still idle");
  assert.equal(phaseFor(GRACE_MS - 1), "idle", "under the grace period stays idle");
  console.log("  ✓ grace period");
})();

// Boundaries are inclusive at the lower edge: at exactly GRACE_MS we are active.
(() => {
  assert.equal(phaseFor(GRACE_MS), "active");
  assert.equal(phaseFor(SLOW_MS - 1), "active");
  assert.equal(phaseFor(SLOW_MS), "slow");
  assert.equal(phaseFor(STUCK_MS - 1), "slow");
  assert.equal(phaseFor(STUCK_MS), "stuck");
  assert.equal(phaseFor(STUCK_MS * 10), "stuck", "stuck is terminal, never wraps");
  console.log("  ✓ phase boundaries");
})();

// The provider schedules ONE timer per phase off this, rather than polling. A wrong value here
// means the notice appears late or never.
(() => {
  assert.equal(nextPhaseChangeMs(null), null, "nothing pending, nothing to schedule");
  assert.equal(nextPhaseChangeMs(0), GRACE_MS);
  assert.equal(nextPhaseChangeMs(GRACE_MS), SLOW_MS - GRACE_MS);
  assert.equal(nextPhaseChangeMs(SLOW_MS), STUCK_MS - SLOW_MS);
  assert.equal(nextPhaseChangeMs(STUCK_MS), null, "stuck is terminal — stop scheduling");
  assert.equal(nextPhaseChangeMs(STUCK_MS + 5_000), null);
  console.log("  ✓ timer scheduling");
})();

// Superseded navigation: tapping 7d then 90d restarts elapsed time. The 90d wait must not
// inherit the 7d wait's age and jump straight to "slow".
(() => {
  const firstStartedAt = 1_000_000;
  const supersededAt = firstStartedAt + SLOW_MS + 500; // first nav was already "slow"
  const now = supersededAt + 10;

  assert.equal(phaseFor(now - firstStartedAt), "slow", "the abandoned nav had aged into slow");
  assert.equal(
    phaseFor(now - supersededAt),
    "idle",
    "the new nav restarts from zero and re-enters the grace period",
  );
  console.log("  ✓ superseded navigation restarts elapsed time");
})();

// Clearing pending returns to idle unconditionally. phaseFor is pure, so "which phase we were
// in" is not state it holds — what this pins is the contract the provider relies on: a null
// elapsed is idle no matter what, and idle-ness otherwise depends on nothing but the grace
// boundary.
(() => {
  assert.equal(phaseFor(null), "idle");
  for (const elapsed of [0, GRACE_MS, SLOW_MS, STUCK_MS, STUCK_MS * 4]) {
    assert.equal(
      phaseFor(elapsed) === "idle",
      elapsed < GRACE_MS,
      `elapsed=${elapsed}: idle-ness must depend only on the grace boundary`,
    );
  }
  console.log("  ✓ null elapsed is always idle");
})();

console.log("loading-states-selftest: all assertions passed");
