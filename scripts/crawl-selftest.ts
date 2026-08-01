import assert from "node:assert/strict";
import { shouldFetchNextPage } from "../lib/olivia/crawl";

/** Drive a whole crawl through the helper and report what it collected. */
function crawl(
  pages: number[],
  total: number,
  { pageSize = 100, maxPages = 25 } = {},
): { fetched: number; pagesRead: number } {
  let fetched = 0;
  let pagesRead = 0;
  for (let page = 1; page <= maxPages; page++) {
    const received = pages[page - 1] ?? 0;
    fetched += received;
    pagesRead = page;
    if (!shouldFetchNextPage(fetched, { received, total, pageSize })) break;
  }
  return { fetched, pagesRead };
}

const MISSING = undefined as unknown as number; // upstream omits `total` despite its type

(() => {
  // ---- the bug this module exists to prevent ----
  // A short page mid-list is NOT the end. Before the fix this stopped at page 2 with 180 of 250
  // rows and no signal, so ~70 lead names silently vanished from the directory.
  assert.deepEqual(crawl([100, 80, 70], 250), { fetched: 250, pagesRead: 3 });
  // Even when the dropped rows are never recovered, the crawl must keep going rather than
  // stopping at the first short page.
  assert.equal(crawl([100, 80, 50], 250).fetched, 230);

  // ---- healthy list ----
  assert.deepEqual(crawl([100, 100, 50], 250), { fetched: 250, pagesRead: 3 });
  // Exact multiple: stop as soon as `total` is reached, don't fetch a speculative empty page.
  assert.deepEqual(crawl([100, 100], 200), { fetched: 200, pagesRead: 2 });

  // ---- `total` missing / non-finite: short page is the only end signal ----
  assert.deepEqual(crawl([100, 100, 40], MISSING), { fetched: 240, pagesRead: 3 });
  // Every page full and no `total` to bound it: the crawl keeps asking until a page comes back
  // empty (page 3 here), which is the only end signal available.
  assert.deepEqual(crawl([100, 100], MISSING), { fetched: 200, pagesRead: 3 });
  assert.equal(shouldFetchNextPage(100, { received: 100, total: NaN, pageSize: 100 }), true);
  assert.equal(shouldFetchNextPage(100, { received: 40, total: NaN, pageSize: 100 }), false);

  // ---- empty page always ends the crawl ----
  assert.deepEqual(crawl([0], 250), { fetched: 0, pagesRead: 1 }); // total overstates reality
  assert.deepEqual(crawl([], 0), { fetched: 0, pagesRead: 1 }); // genuinely empty window
  assert.equal(shouldFetchNextPage(0, { received: 0, total: MISSING, pageSize: 100 }), false);

  // ---- cap still bounds an over-stated total ----
  assert.equal(crawl(Array(30).fill(100), 99999).pagesRead, 25);

  console.log("crawl-selftest: all assertions passed");
})();
