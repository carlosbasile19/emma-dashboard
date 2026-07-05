import assert from "node:assert/strict";
import {
  apiRowForDisplay,
  cellAlpha,
  cellOpacity,
  cellTitle,
  HEATMAP_DAYS_MON_FIRST,
  hourLabel,
} from "../lib/best-times";

(() => {
  // Day mapping — API row 0 = Sunday; display order Mon→Sun.
  assert.equal(HEATMAP_DAYS_MON_FIRST[0], "Mon");
  assert.equal(apiRowForDisplay(0), 1); // Mon is API row 1
  assert.equal(apiRowForDisplay(5), 6); // Sat is API row 6
  assert.equal(apiRowForDisplay(6), 0); // Sun is API row 0
  // Bijective over 0..6
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6].map(apiRowForDisplay).sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6],
  );

  // Alpha ramp — monotonic, clamped, floored above zero so 0% ≠ no-data.
  assert.ok(cellAlpha(0) > 0);
  assert.ok(cellAlpha(0.5) > cellAlpha(0.1));
  assert.equal(cellAlpha(1), 0.82);
  assert.equal(cellAlpha(2), cellAlpha(1)); // clamp
  assert.equal(cellAlpha(-1), cellAlpha(0)); // clamp

  // Opacity — ∝ min(1, calls/5), floored for perceptibility, 1 when unknown.
  assert.equal(cellOpacity(undefined), 1);
  assert.equal(cellOpacity(5), 1);
  assert.equal(cellOpacity(50), 1);
  assert.equal(cellOpacity(2), 0.4);
  assert.equal(cellOpacity(0), 0.15); // floor
  assert.equal(cellOpacity(1), 0.2);

  // Hour labels
  assert.equal(hourLabel(0), "12am");
  assert.equal(hourLabel(9), "9am");
  assert.equal(hourLabel(12), "12pm");
  assert.equal(hourLabel(13), "1pm");
  assert.equal(hourLabel(23), "11pm");

  // Tooltips — null is "no data", never 0%.
  assert.equal(cellTitle("Mon", 13, null, 0), "Mon 1pm — no data");
  assert.equal(cellTitle("Mon", 13, 0.62, 3), "Mon 1pm — 62% pickup · 3 calls");
  assert.equal(cellTitle("Sun", 0, 0, 1), "Sun 12am — 0% pickup · 1 call");
  assert.equal(cellTitle("Fri", 9, 0.5, undefined), "Fri 9am — 50% pickup");

  console.log("best-times-selftest: all assertions passed");
})();
