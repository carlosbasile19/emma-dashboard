import assert from "node:assert/strict";
import {
  bucketByMonth,
  cell,
  centsToUsd,
  csvRow,
  lastCompleteMonth,
  monthBounds,
  monthLabel,
  monthsBetween,
  monthTotals,
  seriesMatchesWindow,
  sumRange,
  toCsv,
  yearChunks,
  type DailySpend,
} from "../lib/usage";

const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY + 1;

/** A tiny series: 1c on the 1st, 2c on the 15th, 4c on the last day of each month. */
const SERIES: DailySpend[] = [
  { date: "2026-06-01", spendCents: 1 },
  { date: "2026-06-15", spendCents: 2 },
  { date: "2026-06-30", spendCents: 4 },
  { date: "2026-07-01", spendCents: 10 },
  { date: "2026-07-15", spendCents: 20 },
  { date: "2026-07-31", spendCents: 40 },
  { date: "2026-08-01", spendCents: 100 },
];

(() => {
  // ---- monthsBetween: the columns of the history matrix ----
  assert.deepEqual(monthsBetween("2026-06-04", "2026-08-01"), ["2026-06", "2026-07", "2026-08"]);
  assert.deepEqual(monthsBetween("2026-07-01", "2026-07-31"), ["2026-07"]);
  assert.deepEqual(monthsBetween("2026-07-14", "2026-07-14"), ["2026-07"]);
  // Crossing a year boundary must not reorder or skip.
  assert.deepEqual(monthsBetween("2025-11-20", "2026-02-03"), [
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
  ]);
  // A reversed range is tolerated rather than throwing (search params are user input).
  assert.deepEqual(monthsBetween("2026-08-01", "2026-06-04"), ["2026-06", "2026-07", "2026-08"]);

  // ---- monthBounds: month key -> the window we ask upstream for ----
  assert.deepEqual(monthBounds("2026-07"), { from: "2026-07-01", to: "2026-07-31" });
  assert.deepEqual(monthBounds("2026-06"), { from: "2026-06-01", to: "2026-06-30" });
  assert.deepEqual(monthBounds("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthBounds("2024-02"), { from: "2024-02-01", to: "2024-02-29" }); // leap
  assert.deepEqual(monthBounds("2026-12"), { from: "2026-12-01", to: "2026-12-31" });

  // ---- monthLabel ----
  assert.equal(monthLabel("2026-07"), "Jul 2026");
  assert.equal(monthLabel("2026-01"), "Jan 2026");

  // ---- lastCompleteMonth: the invoice-run default ----
  assert.equal(lastCompleteMonth("2026-08-01"), "2026-07");
  assert.equal(lastCompleteMonth("2026-08-31"), "2026-07");
  assert.equal(lastCompleteMonth("2026-01-15"), "2025-12"); // rolls back across the year

  // ---- sumRange: inclusive of BOTH endpoints ----
  assert.equal(sumRange(SERIES, "2026-07-01", "2026-07-31"), 70);
  assert.equal(sumRange(SERIES, "2026-07-15", "2026-07-15"), 20); // single day
  assert.equal(sumRange(SERIES, "2026-07-02", "2026-07-30"), 20); // endpoints excluded from window
  assert.equal(sumRange(SERIES, "2026-07-15", "2026-08-14"), 160); // the 15th-14th cycle
  assert.equal(sumRange(SERIES, "2026-01-01", "2026-01-31"), 0); // window with no rows
  assert.equal(sumRange([], "2026-07-01", "2026-07-31"), 0);

  // ---- bucketByMonth: months must reconcile to the lifetime total ----
  const buckets = bucketByMonth(SERIES);
  assert.equal(buckets["2026-06"], 7);
  assert.equal(buckets["2026-07"], 70);
  assert.equal(buckets["2026-08"], 100);
  const lifetime = SERIES.reduce((a, d) => a + d.spendCents, 0);
  assert.equal(
    Object.values(buckets).reduce((a, n) => a + n, 0),
    lifetime,
    "month totals must sum to the lifetime total — a billing report cannot lose or duplicate cents",
  );

  // ---- monthTotals / cell: a failed fetch is NEVER a zero ----
  const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08"];
  // Client opened in June: May predates them, so it is blank, not $0.00.
  assert.deepEqual(monthTotals(SERIES, MONTHS, "2026-06"), [
    { kind: "before-open" },
    { kind: "value", cents: 7 },
    { kind: "value", cents: 70 },
    { kind: "value", cents: 100 },
  ]);
  // Fetch failed: every month is unavailable. Rendering 0 here would under-invoice silently.
  assert.deepEqual(monthTotals(null, MONTHS, "2026-06"), [
    { kind: "unavailable" },
    { kind: "unavailable" },
    { kind: "unavailable" },
    { kind: "unavailable" },
  ]);
  // A genuine zero month is a value, distinct from both of the above.
  assert.deepEqual(monthTotals([], ["2026-07"], "2026-06"), [{ kind: "value", cents: 0 }]);
  // Unknown opening date must not blank real data.
  assert.deepEqual(monthTotals(SERIES, ["2026-07"], null), [{ kind: "value", cents: 70 }]);
  assert.deepEqual(cell(null), { kind: "unavailable" });
  assert.deepEqual(cell(0), { kind: "value", cents: 0 });

  // ---- centsToUsd: formatted from integers, no float drift ----
  assert.equal(centsToUsd(66652), "666.52");
  assert.equal(centsToUsd(3928), "39.28");
  assert.equal(centsToUsd(0), "0.00");
  assert.equal(centsToUsd(5), "0.05");
  assert.equal(centsToUsd(100), "1.00");
  assert.equal(centsToUsd(-250), "-2.50");
  // 0.1 + 0.2 style drift must be impossible: sum the cents, format once.
  assert.equal(centsToUsd([1010, 2020, 3030].reduce((a, n) => a + n, 0)), "60.60");

  // ---- yearChunks: never exceed the upstream 366-day cap, never gap or overlap ----
  assert.deepEqual(yearChunks("2026-06-04", "2026-08-01"), [
    { from: "2026-06-04", to: "2026-08-01" },
  ]);
  assert.deepEqual(yearChunks("2025-06-04", "2026-08-01"), [
    { from: "2025-06-04", to: "2025-12-31" },
    { from: "2026-01-01", to: "2026-08-01" },
  ]);
  assert.deepEqual(yearChunks("2024-11-30", "2026-01-02"), [
    { from: "2024-11-30", to: "2024-12-31" },
    { from: "2025-01-01", to: "2025-12-31" },
    { from: "2026-01-01", to: "2026-01-02" },
  ]);
  assert.deepEqual(yearChunks("2026-07-14", "2026-07-14"), [
    { from: "2026-07-14", to: "2026-07-14" },
  ]);
  // Every chunk fits the cap, and the chunks tile the span exactly.
  const span = yearChunks("2023-03-07", "2026-08-01");
  for (const c of span) {
    assert.ok(days(c.from, c.to) <= 366, `chunk ${c.from}..${c.to} exceeds the 366-day cap`);
  }
  const first = span[0];
  const last = span[span.length - 1];
  assert.ok(first && last);
  assert.equal(first.from, "2023-03-07");
  assert.equal(last.to, "2026-08-01");
  for (let i = 1; i < span.length; i++) {
    const prev = span[i - 1];
    const cur = span[i];
    assert.ok(prev && cur);
    assert.equal(
      days(prev.to, cur.from),
      2,
      "chunks must be contiguous — a gap loses days, an overlap double-bills them",
    );
  }
  // A leap year is a full chunk and still inside the cap.
  const leap = yearChunks("2024-01-01", "2024-12-31");
  assert.deepEqual(leap, [{ from: "2024-01-01", to: "2024-12-31" }]);
  const leapChunk = leap[0];
  assert.ok(leapChunk);
  assert.equal(days(leapChunk.from, leapChunk.to), 366);

  // ---- seriesMatchesWindow: the cross-window cache fallback must never reach a bill ----
  // cachedFetch serves the CLOSEST cached window (up to 7 days old) when upstream fails and the
  // exact key is cold. For a KPI card that is a good degradation; for an invoice it would show
  // June's spend labelled as July. Upstream echoes the window it actually served, so we check it.
  const WANT = { from: "2026-07-01", to: "2026-07-31", tz: "Australia/Sydney" };
  assert.equal(seriesMatchesWindow({ ...WANT }, WANT), true);
  assert.equal(seriesMatchesWindow({ ...WANT, extra: 1 } as never, WANT), true);
  assert.equal(seriesMatchesWindow({ ...WANT, from: "2026-06-01" }, WANT), false);
  assert.equal(seriesMatchesWindow({ ...WANT, to: "2026-07-30" }, WANT), false);
  assert.equal(seriesMatchesWindow({ ...WANT, tz: "UTC" }, WANT), false); // wrong day boundaries
  // No echoed period at all: unverifiable, so untrusted. Never optimistically accepted.
  assert.equal(seriesMatchesWindow(undefined, WANT), false);
  assert.equal(seriesMatchesWindow({}, WANT), false);

  // ---- CSV encoding ----
  assert.equal(csvRow(["a", "b"]), "a,b");
  assert.equal(csvRow(["Acme, Inc."]), '"Acme, Inc."'); // comma
  assert.equal(csvRow(['He said "hi"']), '"He said ""hi"""'); // quote doubling
  assert.equal(csvRow(["line1\nline2"]), '"line1\nline2"'); // newline
  assert.equal(csvRow([""]), "");
  // Only RFC 4180's characters force quoting — nothing else should widen the rule.
  assert.equal(csvRow(["Acme * Co"]), "Acme * Co");
  assert.equal(csvRow(["a'b"]), "a'b");
  // Formula injection: a client name must never execute in Excel or Sheets. The rule is
  // "neutralise with a leading apostrophe, then apply standard quoting only if needed".
  assert.equal(csvRow(["=cmd|'/c calc'!A1"]), "'=cmd|'/c calc'!A1");
  assert.equal(csvRow(["+1 555 0100"]), "'+1 555 0100");
  assert.equal(csvRow(["@handle"]), "'@handle");
  assert.equal(csvRow(["=a,b"]), `"'=a,b"`); // guarded AND quoted, because of the comma
  // ...but a negative money value must stay a number, not become text.
  assert.equal(csvRow(["-2.50"]), "-2.50");
  assert.equal(csvRow(["39.28"]), "39.28");

  assert.equal(
    toCsv(["client", "spend_usd"], [["Acme, Inc.", "666.52"], ["=evil", "0.00"]]),
    'client,spend_usd\r\n"Acme, Inc.",666.52\r\n\'=evil,0.00',
  );
  assert.equal(toCsv(["client"], []), "client");

  console.log("usage-selftest: all assertions passed");
})();
