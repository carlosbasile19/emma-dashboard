/**
 * Pagination termination for Olivia list crawls. Pure and dependency-free (no `server-only`,
 * no I/O) so it can be exercised by `scripts/crawl-selftest.ts`.
 */

/** What one page of a paged crawl came back with. */
export interface CrawlPage {
  /** Rows this page actually returned. */
  received: number;
  /** Upstream's claimed total. Typed `number`, but some responses omit it — treat as unknown. */
  total: number;
  /** Rows this page asked for. */
  pageSize: number;
}

/**
 * Should the crawl request another page, given `fetched` rows collected so far?
 *
 * The subtle rule is that a SHORT page is not proof the list ended. Upstream can return fewer
 * rows than asked for mid-list (a hiccup, dedup, or post-pagination filtering) while `total`
 * still says more exist. Stopping there silently drops rows — for the lead directory that means
 * names go missing and the UI falls back to raw lead ids with no explanation. So when `total` is
 * known, keep paging until it is reached; page N+1 is a fixed offset, so continuing past a short
 * page still recovers the rows beyond it.
 *
 * When `total` is missing or non-finite the size is simply unknown, and a short page is the only
 * end signal available — so there, and only there, it stops the crawl.
 *
 * An empty page always ends the crawl: it is the one unambiguous end-of-list signal, and without
 * this guard a `total` that overstates reality would spin to the page cap.
 */
export function shouldFetchNextPage(fetched: number, page: CrawlPage): boolean {
  if (page.received === 0) return false;
  if (Number.isFinite(page.total)) return fetched < page.total;
  return page.received >= page.pageSize;
}
