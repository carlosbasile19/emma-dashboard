import assert from "node:assert/strict";
import {
  bucketByMonth,
  cell,
  centsToMoneyExact,
  centsToUsd,
  historyCsvRows,
  periodCsvRows,
  csvRow,
  lastCompleteMonth,
  monthBounds,
  monthLabel,
  mergeDaily,
  monthsBetween,
  monthTotals,
  padWindow,
  reportSpan,
  resolveUsagePeriod,
  shiftDay,
  seriesMatchesWindow,
  sumRange,
  toCsv,
  usageCsv,
  USAGE_CSV_HEADERS,
  windowDays,
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

  // ---- centsToMoneyExact: the house centsToMoney rounds to whole dollars ($667), which is
  // fine for a KPI card and wrong for an invoice line. ----
  assert.equal(centsToMoneyExact(66652), "$666.52");
  assert.equal(centsToMoneyExact(3928), "$39.28");
  assert.equal(centsToMoneyExact(0), "$0.00");
  assert.equal(centsToMoneyExact(123456789), "$1,234,567.89"); // grouped, still exact
  assert.equal(centsToMoneyExact(-250), "-$2.50");
  // A non-USD amount must never render as a bare number with no currency on a billing screen.
  assert.equal(centsToMoneyExact(100, "eur"), "1.00 EUR");

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

  // ---- shiftDay / padWindow: the UTC-filter vs tz-label mismatch ----
  // Upstream filters from/to on UTC days but labels timeseries buckets on the client's tz
  // (guide §8). Brisbane's 1 Jul starts at 30 Jun 14:00 UTC, so a window starting 2026-07-01
  // returns a TRUNCATED 2026-07-01 bucket — $11.39 short for SOLVI, observed live. Padding the
  // request by a day on each side makes every day inside the wanted span complete.
  assert.equal(shiftDay("2026-07-01", -1), "2026-06-30");
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDay("2024-03-01", -1), "2024-02-29"); // leap
  assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftDay("2026-01-01", -1), "2025-12-31");
  assert.deepEqual(padWindow({ from: "2026-07-01", to: "2026-07-31" }), {
    from: "2026-06-30",
    to: "2026-08-01",
  });
  // One day covers every IANA offset — the extremes are UTC-12 to UTC+14.
  assert.equal(windowDays(padWindow({ from: "2026-07-01", to: "2026-07-01" })), 3);

  // ---- mergeDaily: a year-chunk boundary splits one local day across two responses ----
  // Chunk 1 ends 2025-12-31 UTC and chunk 2 starts 2026-01-01 UTC, but Brisbane's 2026-01-01
  // straddles that instant — so the same local date comes back twice, each partial. They must
  // SUM: keeping either one alone silently loses money on New Year's Day.
  assert.deepEqual(
    mergeDaily([
      { date: "2026-01-01", spendCents: 400 },
      { date: "2025-12-31", spendCents: 100 },
      { date: "2026-01-01", spendCents: 700 },
    ]),
    [
      { date: "2025-12-31", spendCents: 100 },
      { date: "2026-01-01", spendCents: 1100 },
    ],
  );
  assert.deepEqual(mergeDaily([]), []);
  // Merging must not change the total.
  const merged = mergeDaily(SERIES);
  assert.equal(
    merged.reduce((a, d) => a + d.spendCents, 0),
    SERIES.reduce((a, d) => a + d.spendCents, 0),
  );

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

  // ---- resolveUsagePeriod: search params are user input and drive what gets invoiced ----
  const TODAY = "2026-08-01";
  // Default is the last CLOSED month — never the current one, which is still accruing.
  assert.deepEqual(resolveUsagePeriod({}, TODAY), {
    from: "2026-07-01",
    to: "2026-07-31",
    month: "2026-07",
    label: "Jul 2026",
  });
  assert.deepEqual(resolveUsagePeriod({ month: "2026-06" }, TODAY), {
    from: "2026-06-01",
    to: "2026-06-30",
    month: "2026-06",
    label: "Jun 2026",
  });
  // Garbage falls back to the default rather than throwing or querying a nonsense window.
  assert.equal(resolveUsagePeriod({ month: "nope" }, TODAY).month, "2026-07");
  assert.equal(resolveUsagePeriod({ month: "2026-13" }, TODAY).month, "2026-07");
  assert.equal(resolveUsagePeriod({ from: "2026-07-01" }, TODAY).month, "2026-07"); // half a range
  assert.equal(resolveUsagePeriod({ from: "x", to: "y" }, TODAY).month, "2026-07");

  // A custom span — the 15th-14th cycle they're reconciling against.
  assert.deepEqual(resolveUsagePeriod({ from: "2026-07-15", to: "2026-08-14" }, TODAY), {
    from: "2026-07-15",
    to: "2026-08-14",
    month: null,
    label: "15 Jul 2026 – 14 Aug 2026",
  });
  // Reversed input is tolerated, not rejected.
  assert.equal(resolveUsagePeriod({ from: "2026-08-14", to: "2026-07-15" }, TODAY).from, "2026-07-15");
  // A custom span that happens to be exactly one month is recognised as that month, so a
  // shared URL highlights the right pill and labels the CSV consistently.
  assert.equal(resolveUsagePeriod({ from: "2026-07-01", to: "2026-07-31" }, TODAY).month, "2026-07");
  // `month` wins over from/to when both are present.
  assert.equal(resolveUsagePeriod({ month: "2026-06", from: "2026-01-01", to: "2026-01-31" }, TODAY).month, "2026-06");
  // A pathological start is clamped: 126 year-chunks per client is a self-inflicted outage.
  assert.equal(resolveUsagePeriod({ from: "1900-01-01", to: "2026-08-01" }, TODAY).from, "2021-08-01");
  // The current month is selectable (month-to-date) — `to` may sit in the future.
  assert.deepEqual(resolveUsagePeriod({ month: "2026-08" }, TODAY), {
    from: "2026-08-01",
    to: "2026-08-31",
    month: "2026-08",
    label: "Aug 2026",
  });

  // ---- reportSpan: history must always reach the current month ----
  // Tying the fetch span to the selected period drops later months from the matrix: viewing
  // July hid August, so SOLVI's row read $161.54 + $677.91 against a $931.25 lifetime. Columns
  // that don't reconcile with their own row total are unusable for a true-up.
  const OPENINGS = ["2026-06-11", "2026-06-04", "2026-07-20"];
  assert.deepEqual(
    reportSpan({ from: "2026-07-01", to: "2026-07-31" }, OPENINGS, "2026-08-01"),
    { from: "2026-06-04", to: "2026-08-01" },
  );
  // Selecting the CURRENT month keeps its future-dated end (month-to-date is intentional).
  assert.deepEqual(
    reportSpan({ from: "2026-08-01", to: "2026-08-31" }, OPENINGS, "2026-08-01"),
    { from: "2026-06-04", to: "2026-08-31" },
  );
  // A custom range reaching back before any opening widens the span rather than being clipped.
  assert.deepEqual(
    reportSpan({ from: "2026-01-15", to: "2026-02-15" }, OPENINGS, "2026-08-01"),
    { from: "2026-01-15", to: "2026-08-01" },
  );
  // No known openings: fall back to the requested window, still through today.
  assert.deepEqual(reportSpan({ from: "2026-07-01", to: "2026-07-31" }, [], "2026-08-01"), {
    from: "2026-07-01",
    to: "2026-08-01",
  });

  // ---- periodCsvRows / historyCsvRows: what the export route actually writes ----
  const META = { currency: "usd", basis: "billed_voice" };
  const VIEW_MONTHS = ["2026-06", "2026-07", "2026-08"];
  const VIEW_ROWS = [
    {
      id: "solvi",
      name: "001. SOLVI",
      tz: "Australia/Brisbane",
      periodCents: 67791,
      lifetimeCents: 93125,
      monthCells: [
        { kind: "value", cents: 16154 },
        { kind: "value", cents: 67791 },
        { kind: "value", cents: 9180 },
      ],
    },
    {
      id: "fbc",
      name: "002. Freedom Boat Club",
      tz: "Australia/Sydney",
      periodCents: 3928,
      lifetimeCents: 4414,
      // Opened in July — June predates the workspace.
      monthCells: [
        { kind: "before-open" },
        { kind: "value", cents: 3928 },
        { kind: "value", cents: 486 },
      ],
    },
    {
      id: "broken",
      name: "003. Unreachable",
      tz: "UTC",
      periodCents: null,
      lifetimeCents: null,
      monthCells: [{ kind: "unavailable" }, { kind: "unavailable" }, { kind: "unavailable" }],
    },
  ] as const;

  const periodRows = periodCsvRows(
    VIEW_ROWS as never,
    { from: "2026-07-01", to: "2026-07-31", month: "2026-07", label: "Jul 2026" },
    META,
  );
  assert.equal(periodRows.length, 3); // one per client, including the unreachable one
  assert.equal(periodRows[0]?.period, "2026-07-01..2026-07-31");
  assert.equal(periodRows[2]?.cents, null); // unreachable exports blank, not 0

  const historyRows = historyCsvRows(VIEW_ROWS as never, VIEW_MONTHS, META);
  // 3 SOLVI + 2 FBC (June is before it opened, so no row at all) + 3 unreachable = 8
  assert.equal(historyRows.length, 8);
  assert.ok(
    !historyRows.some((r) => r.clientId === "fbc" && r.period === "2026-06"),
    "a month before the workspace opened must produce NO row — an empty one implies a billable period",
  );
  // Each history row carries that month's real bounds, not the selected period's.
  const july = historyRows.find((r) => r.clientId === "solvi" && r.period === "2026-07");
  assert.deepEqual(
    { from: july?.from, to: july?.to, cents: july?.cents },
    { from: "2026-07-01", to: "2026-07-31", cents: 67791 },
  );
  const june = historyRows.find((r) => r.clientId === "solvi" && r.period === "2026-06");
  assert.equal(june?.to, "2026-06-30"); // 30 days, not 31
  // Unreachable months still get rows, so their absence is visible rather than silent.
  assert.equal(historyRows.filter((r) => r.clientId === "broken").length, 3);
  assert.ok(historyRows.filter((r) => r.clientId === "broken").every((r) => r.cents === null));
  // And the rendered file never shows a zero for them.
  const historyCsvText = usageCsv(historyRows);
  assert.ok(historyCsvText.includes("003. Unreachable,broken,2026-07,2026-07-01,2026-07-31,UTC,usd,billed_voice,\r\n")
    || historyCsvText.endsWith("003. Unreachable,broken,2026-08,2026-08-01,2026-08-31,UTC,usd,billed_voice,"));

  // ---- usageCsv: an unavailable client must export blank, never 0.00 ----
  const csv = usageCsv([
    {
      clientName: "001. SOLVI",
      clientId: "9c6d445a",
      period: "2026-07",
      from: "2026-07-01",
      to: "2026-07-31",
      tz: "Australia/Brisbane",
      currency: "usd",
      basis: "billed_voice",
      cents: 66652,
    },
    {
      clientName: "002. Freedom Boat Club",
      clientId: "0e01011c",
      period: "2026-07",
      from: "2026-07-01",
      to: "2026-07-31",
      tz: "Australia/Sydney",
      currency: "usd",
      basis: "billed_voice",
      cents: null,
    },
  ]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], USAGE_CSV_HEADERS.join(","));
  assert.equal(
    lines[1],
    "001. SOLVI,9c6d445a,2026-07,2026-07-01,2026-07-31,Australia/Brisbane,usd,billed_voice,666.52",
  );
  // Trailing empty field: the row exists, the number does not. Never "0.00".
  assert.equal(
    lines[2],
    "002. Freedom Boat Club,0e01011c,2026-07,2026-07-01,2026-07-31,Australia/Sydney,usd,billed_voice,",
  );
  assert.ok(!csv.includes("0.00"), "an unloadable client must never export as a zero amount");
  // No totals row — it breaks SUM() over the column and corrupts pivots.
  assert.equal(lines.length, 3);

  console.log("usage-selftest: all assertions passed");
})();
