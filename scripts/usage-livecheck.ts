/* Live check (not part of `npm test:*` — needs network + credentials).
   Exercises the real fetch path against production and proves the month totals are COMPLETE.

   The proof is convergence, not a hardcoded number: upstream filters on UTC days but labels
   buckets on the client's timezone, so a month total is only trustworthy once widening the
   requested window stops changing it. If a 1-day pad and a 6-day pad agree, the boundary
   spend is fully captured. */
import assert from "node:assert/strict";
import { discoverClients } from "../lib/olivia/api";
import { getUsageSeries } from "../lib/olivia/usage";
import {
  bucketByMonth,
  centsToMoneyExact,
  shiftDay,
  sumRange,
  usageCsv,
  type UsageCsvRow,
} from "../lib/usage";

const TODAY = "2026-08-01";

(async () => {
  const clients = await discoverClients({ limit: 100 });
  console.log(`discovered ${clients.length} clients\n`);
  const csvRows: UsageCsvRow[] = [];

  for (const c of clients) {
    const tz = c.timezone?.trim() || "UTC";
    const opened = String(c.created_at ?? "2026-01-01").slice(0, 10);

    // What the app actually does (pads by 1 day internally).
    const series = await getUsageSeries(c.id, tz, opened, TODAY);
    assert.ok(series, `series must load for ${c.name}`);

    // The same span asked for far more widely — must agree if the edges are complete.
    const wide = await getUsageSeries(c.id, tz, shiftDay(opened, -5), shiftDay(TODAY, 5));
    assert.ok(wide, `wide series must load for ${c.name}`);

    const july = sumRange(series.daily, "2026-07-01", "2026-07-31");
    const julyWide = sumRange(wide.daily, "2026-07-01", "2026-07-31");
    const lifetime = series.daily.reduce((a, d) => a + d.spendCents, 0);
    const buckets = bucketByMonth(series.daily);

    console.log(`${c.name}  (tz ${tz}, opened ${opened})`);
    console.log(`  days=${series.daily.length}  basis=${series.basis}  currency=${series.currency}`);
    console.log(`  July  ${centsToMoneyExact(july)}   (wider fetch: ${centsToMoneyExact(julyWide)})`);
    for (const [m, cents] of Object.entries(buckets).sort()) {
      console.log(`      ${m}  ${centsToMoneyExact(cents)}`);
    }
    console.log(`  lifetime (from opening)  ${centsToMoneyExact(lifetime)}`);
    console.log(
      `  15 Jul–14 Aug (upstream cycle)  ${centsToMoneyExact(sumRange(series.daily, "2026-07-15", "2026-08-14"))}\n`,
    );

    // The month total must not move when the window widens — that is what "complete" means.
    assert.equal(
      july,
      julyWide,
      `${c.name}: July changed when the fetch window widened — the month edge is truncated`,
    );
    // One row per local date after merging: a duplicate would mean chunks weren't summed.
    assert.equal(
      new Set(series.daily.map((d) => d.date)).size,
      series.daily.length,
      `${c.name}: duplicate dates survived mergeDaily`,
    );
    // Months must reconcile to the lifetime total — no cent lost or duplicated.
    assert.equal(
      Object.values(buckets).reduce((a, n) => a + n, 0),
      lifetime,
      `${c.name}: month buckets must sum to the lifetime total`,
    );

    csvRows.push({
      clientName: c.name,
      clientId: c.id,
      period: "2026-07",
      from: "2026-07-01",
      to: "2026-07-31",
      tz,
      currency: series.currency,
      basis: series.basis,
      cents: july,
    });
  }

  console.log("--- CSV (period view, July 2026) ---");
  console.log(usageCsv(csvRows));
  console.log("\nusage-livecheck: all assertions passed");
})();
