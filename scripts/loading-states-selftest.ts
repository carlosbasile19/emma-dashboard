import assert from "node:assert/strict";
import { parseContentDispositionFilename } from "../lib/content-disposition";
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

// ExportButton reads the download filename straight from this header. Get it wrong and the user
// either gets a misleadingly-named file or, with the inline regex this was extracted from, a
// filename with a trailing header parameter baked in.
(() => {
  assert.equal(
    parseContentDispositionFilename('attachment; filename="report.csv"'),
    "report.csv",
    "quoted filename",
  );
  console.log("  ✓ content-disposition: quoted filename");
})();

// The bug this module was extracted to fix: the old inline regex `/filename="?([^"]+)"?/` had no
// upper bound on an unquoted match, so a trailing parameter leaked into the "filename" —
// `attachment; filename=a.csv; size=1` produced `a.csv; size=1`.
(() => {
  assert.equal(
    parseContentDispositionFilename("attachment; filename=a.csv; size=1"),
    "a.csv",
    "unquoted filename stops at the next parameter, not at end of string",
  );
  console.log("  ✓ content-disposition: unquoted filename followed by another parameter");
})();

// A missing or empty header is routine — any response without Content-Disposition, or a proxy
// that strips it — and must fall back silently, never throw.
(() => {
  assert.equal(parseContentDispositionFilename(null), "usage.csv", "missing header (null)");
  assert.equal(
    parseContentDispositionFilename(undefined),
    "usage.csv",
    "missing header (undefined)",
  );
  assert.equal(parseContentDispositionFilename(""), "usage.csv", "empty header");
  assert.equal(
    parseContentDispositionFilename("attachment"),
    "usage.csv",
    "header present but no filename param at all",
  );
  assert.equal(
    parseContentDispositionFilename("bogus", "fallback.csv"),
    "fallback.csv",
    "a caller-supplied fallback is honored, not just the default",
  );
  console.log("  ✓ content-disposition: missing/empty header falls back without throwing");
})();

// RFC 5987 extended notation (`filename*=charset'lang'value`). Decided behavior: prefer it over
// a plain `filename` when both are present — it's the form that can carry non-ASCII names, and
// RFC 6266 says extended wins — and percent-decode the value.
(() => {
  assert.equal(
    parseContentDispositionFilename("attachment; filename*=UTF-8''emma-usage-2026-08.csv"),
    "emma-usage-2026-08.csv",
    "RFC 5987 form with an empty language tag",
  );
  assert.equal(
    parseContentDispositionFilename("attachment; filename*=UTF-8''emma%20usage.csv"),
    "emma usage.csv",
    "percent-encoded octets are decoded",
  );
  assert.equal(
    parseContentDispositionFilename(
      "attachment; filename=\"fallback.csv\"; filename*=UTF-8''real%20name.csv",
    ),
    "real name.csv",
    "the extended form wins when both are present",
  );
  console.log("  ✓ content-disposition: RFC 5987 filename* form");
})();

console.log("loading-states-selftest: all assertions passed");
