/* Exact timestamps must render in the VIEWER's timezone, never the server's.
   Vercel functions run in UTC, and React 19 skips patching text under suppressHydrationWarning,
   so any time baked into the server HTML sticks until the next re-render ("UK time" bug).
   Run: npm run test:localtime */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { fmtDateTime } from "../lib/format";
import { LocalTime } from "../components/ui/LocalTime";

const iso = "2026-09-21T23:30:00Z";

// 1. Given an explicit timezone, the helper ignores the process TZ entirely.
assert.equal(fmtDateTime(iso, Date.now(), "Australia/Sydney"), "Sep 22, 9:30 AM");
assert.equal(fmtDateTime(iso, Date.now(), "America/New_York"), "Sep 21, 7:30 PM");
assert.equal(fmtDateTime(iso, Date.now(), "UTC"), "Sep 21, 11:30 PM");
console.log("  ✓ fmtDateTime honours an explicit timezone regardless of process TZ");

// 2. Server render never emits a formatted time — there is no viewer timezone on the server, so
//    nothing tz-dependent may be baked into the HTML. The machine-readable ISO value is kept.
const html = renderToString(createElement(LocalTime, { iso }));
assert.ok(html.toLowerCase().includes(`datetime="${iso.toLowerCase()}"`), `missing datetime attr: ${html}`);
for (const tzText of ["11:30", "12:30", "7:30", "9:30", "Sep 2"]) {
  assert.ok(!html.includes(tzText), `server HTML leaked a time (${tzText}): ${html}`);
}
console.log("  ✓ server HTML carries the ISO value but no timezone-dependent text");

// 3. An unparseable timestamp renders empty rather than "Invalid Date".
assert.equal(fmtDateTime("nope", Date.now(), "UTC"), "");
console.log("  ✓ bad input renders empty");
