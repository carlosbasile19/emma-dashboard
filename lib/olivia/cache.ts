import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { OliviaError } from "./errors";
import { pickFallbackRow, stableStringify, type FallbackCandidate } from "./fallback";
import { acquireLock, consumeToken, releaseLock } from "./governor";
import type { WithFreshness } from "@/lib/types";

type Admin = ReturnType<typeof createAdminClient>;

export interface Tier {
  /** Seconds the cached value is served without any upstream call. */
  fresh: number;
  /** Additional seconds a stale value may be served (contention / on-error). */
  stale: number;
}

// Per-endpoint freshness tiers (brief Phase 5).
export const TIERS = {
  overview: { fresh: 60, stale: 300 },
  timeseries: { fresh: 60, stale: 300 },
  funnel: { fresh: 60, stale: 300 },
  outcomes: { fresh: 60, stale: 300 },
  agents: { fresh: 120, stale: 600 },
  campaigns: { fresh: 120, stale: 600 },
  pipelines: { fresh: 30, stale: 120 },
  leads: { fresh: 30, stale: 60 },
  // lead_id → name directory used to enrich call/conversation rows. Names are stable, so a
  // long fresh window avoids re-paging the whole leads list on every log view.
  leadDirectory: { fresh: 300, stale: 1800 },
  // Full lead corpus backing in-app search. Paging the whole list is expensive, so the fresh
  // window is longer than `leads` — a search result up to ~2 min behind live is an acceptable
  // trade for not re-crawling on every keystroke.
  leadsCorpus: { fresh: 120, stale: 600 },
  calls: { fresh: 30, stale: 60 },
  // Full call corpus backing the log search. Same trade as `leadsCorpus`: paging the whole
  // window is expensive, so a search result up to ~2 min behind live beats re-crawling on
  // every keystroke.
  callsCorpus: { fresh: 120, stale: 600 },
  conversations: { fresh: 30, stale: 60 },
  calendar: { fresh: 60, stale: 300 },
  leadDetail: { fresh: 30, stale: 60 },
  dmThreads: { fresh: 30, stale: 60 },
  // Full message threads: short fresh window so an open drawer shows near-live messages.
  thread: { fresh: 15, stale: 60 },
  agencyCosts: { fresh: 120, stale: 600 },
  // Billing usage. Closed days never change, so a longer fresh window is safe and keeps the
  // history matrix (one chunk per client per year) from re-fetching on every filter change.
  usage: { fresh: 300, stale: 1800 },
  discovery: { fresh: 3600, stale: 86400 },
} as const satisfies Record<string, Tier>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How often a caller that lost the single-flight lock re-reads the key. */
const LOCK_POLL_MS = 180;
/** Floor: the pre-existing 6 × 180ms wait, kept for cheap tiers. */
const LOCK_WAIT_MIN_MS = 6 * LOCK_POLL_MS;
/** Ceiling: a holder that died must never stall a request longer than this. */
const LOCK_WAIT_MAX_MS = 10_000;

/**
 * How long to wait for the single-flight holder before doing the work ourselves, scaled to
 * the tier's fresh window as a proxy for how expensive a refresh is (`fresh` seconds × 60ms,
 * floored at the legacy ~1.1s and capped at 10s). This only matters when the exact key has
 * NO row at all: with nothing to serve, giving up early means running the holder's work a
 * second time. For the 25-page lead-corpus crawl (fresh 120 → ~7.2s) that duplication is
 * expensive — debounced typing commits several URLs while the key is still cold, so a short
 * wait turns one user's search into several concurrent crawls against a shared rate budget.
 */
function lockWaitMs(tier: Tier): number {
  return Math.min(Math.max(tier.fresh * 60, LOCK_WAIT_MIN_MS), LOCK_WAIT_MAX_MS);
}

/**
 * Cache key MUST include client_id + endpoint + every param. A cached value can never be
 * served to a different client_id (tenant isolation, not just optimization).
 */
export function cacheKey(
  clientId: string,
  endpoint: string,
  params: Record<string, unknown>,
): string {
  return `${clientId}::${endpoint}::${stableStringify(params)}`;
}

interface CacheRow {
  payload: unknown;
  fetched_at: string;
}

async function readCache(admin: Admin, key: string): Promise<CacheRow | null> {
  const { data } = await admin
    .from("response_cache")
    .select("payload, fetched_at")
    .eq("cache_key", key)
    .maybeSingle();
  return (data as CacheRow | null) ?? null;
}

/**
 * Last resort when the exact key has no row: the newest cached row for the same
 * client + endpoint whose non-window params match (see pickFallbackRow). Date windows
 * roll daily, so on the first request after rollover an upstream outage would otherwise
 * surface as a hard error even though yesterday's window is cached.
 */
async function readFallbackCache(
  admin: Admin,
  clientId: string,
  endpoint: string,
  params: Record<string, unknown>,
): Promise<CacheRow | null> {
  // Two reads on purpose. Choosing a row needs only the key + timestamp, so the listing must
  // NOT select `payload`: a `leads-corpus` row holds up to 2,500 leads with PII (~1MB) and
  // mints a new key per (window, filters) per day, which would make this listing pull tens of
  // megabytes — on exactly the path that runs when upstream is already failing.
  const { data } = await admin
    .from("response_cache")
    .select("cache_key, fetched_at")
    .eq("client_id", clientId)
    .eq("endpoint", endpoint)
    .order("fetched_at", { ascending: false })
    .limit(24);
  const pick = pickFallbackRow(
    (data as FallbackCandidate[] | null) ?? [],
    clientId,
    endpoint,
    params,
    Date.now(),
  );
  if (!pick) return null;
  // Fetch just the winner's payload, re-asserting the tenant guards on the row actually
  // returned (the key is already prefix-checked by pickFallbackRow; these make it explicit).
  const { data: full } = await admin
    .from("response_cache")
    .select("payload, fetched_at")
    .eq("cache_key", pick.cache_key)
    .eq("client_id", clientId)
    .eq("endpoint", endpoint)
    .maybeSingle();
  return (full as CacheRow | null) ?? null;
}

async function writeCache(
  admin: Admin,
  key: string,
  clientId: string,
  endpoint: string,
  payload: unknown,
): Promise<number> {
  const fetchedAt = new Date().toISOString();
  await admin
    .from("response_cache")
    .upsert(
      { cache_key: key, client_id: clientId, endpoint, payload, fetched_at: fetchedAt },
      { onConflict: "cache_key" },
    );
  return new Date(fetchedAt).getTime();
}

export interface CachedFetchArgs<T> {
  clientId: string;
  endpoint: string;
  params: Record<string, unknown>;
  tier: Tier;
  fetcher: () => Promise<T>;
  /** Manual refresh: bypass the fresh window (still subject to the governor). */
  force?: boolean;
  /** Test seam (selftest only): inject a fake admin client. */
  admin?: Admin;
}

/**
 * Stale-while-revalidate fetch with single-flight + a shared rate governor, all backed by
 * Supabase Postgres. Returns the data plus a freshness signal.
 *
 * - fresh (age < tier.fresh): served from cache, no upstream call.
 * - stale/expired/force: one caller refreshes under a single-flight lock + a rate token;
 *   concurrent callers serve the last-known-good (stale) or await the holder's result.
 * - on upstream error / governor block: serve last-known-good; if the exact key has no
 *   row yet (date windows roll daily), fall back to the newest compatible window before
 *   erroring.
 */
export async function cachedFetch<T>(args: CachedFetchArgs<T>): Promise<WithFreshness<T>> {
  const { clientId, endpoint, params, tier, fetcher, force } = args;
  const admin = args.admin ?? createAdminClient();
  const key = cacheKey(clientId, endpoint, params);
  const startedAt = Date.now();

  const row = await readCache(admin, key);
  const rowTime = row ? new Date(row.fetched_at).getTime() : 0;
  const ageSec = row ? (startedAt - rowTime) / 1000 : Infinity;

  const fresh = (data: T, fetchedAt: number): WithFreshness<T> => ({
    data,
    freshness: { fetchedAt, stale: false },
  });
  const stale = (): WithFreshness<T> | null =>
    row ? { data: row.payload as T, freshness: { fetchedAt: rowTime, stale: true } } : null;
  // Exact key first; else the newest compatible window (upstream outage right after a
  // daily window rollover should degrade to yesterday's data, not a hard error).
  const staleOrFallback = async (): Promise<WithFreshness<T> | null> => {
    const s = stale();
    if (s) return s;
    // Never let a failing fallback read mask the original upstream error.
    const fb = await readFallbackCache(admin, clientId, endpoint, params).catch(() => null);
    return fb
      ? {
          data: fb.payload as T,
          freshness: { fetchedAt: new Date(fb.fetched_at).getTime(), stale: true },
        }
      : null;
  };

  if (row && !force && ageSec < tier.fresh) {
    return fresh(row.payload as T, rowTime);
  }

  const acquired = await acquireLock(key, admin);
  try {
    if (!acquired) {
      // Another instance is refreshing this key. Await its result — but only as long as
      // giving up actually costs something. With a stale row in hand the exit is cheap
      // (serve last-known-good after the short legacy wait); with NO row we would instead
      // duplicate the holder's whole refresh, so an expensive tier waits proportionally
      // longer. See lockWaitMs.
      const deadline = Date.now() + (row ? LOCK_WAIT_MIN_MS : lockWaitMs(tier));
      while (Date.now() < deadline) {
        await sleep(LOCK_POLL_MS);
        const latest = await readCache(admin, key);
        if (latest && new Date(latest.fetched_at).getTime() > startedAt) {
          return fresh(latest.payload as T, new Date(latest.fetched_at).getTime());
        }
      }
      // …otherwise serve stale if we have it; if not, fall through and fetch ourselves.
      const s = stale();
      if (s) return s;
    }

    const allowed = await consumeToken(admin);
    if (!allowed) {
      const s = await staleOrFallback();
      if (s) return s; // governor over budget → serve last-known-good
      throw new OliviaError(
        429,
        "rate_limited",
        "Rate budget exhausted and no cached value available",
      );
    }

    const data = await fetcher();
    const fetchedAt = await writeCache(admin, key, clientId, endpoint, data);
    return fresh(data, fetchedAt);
  } catch (e) {
    const s = await staleOrFallback(); // stale-on-error
    if (s) return s;
    throw e;
  } finally {
    if (acquired) await releaseLock(key, admin);
  }
}

/**
 * Drop every cached row for `clientId` on the given endpoints, so the next read goes upstream.
 *
 * For write actions whose effect shows up on LIST views, where force-refreshing isn't an
 * option: those endpoints mint a key per (window × filters × page), and a write has no way to
 * know which of them the user will land on next. Deleting the endpoint's rows outright is the
 * only way to guarantee the change is visible — `leads-corpus` in particular is fresh for 120s
 * and stale-servable for 600s, so a stopped lead would otherwise keep rendering un-flagged in
 * search results for minutes after the write landed.
 *
 * Best-effort and tenant-scoped: the `client_id` equality is the isolation guard, and the LIKE
 * only narrows within it (endpoint names carry no `_`/`%`, so no wildcard can leak across
 * endpoints). A failure here costs staleness, never correctness — callers ignore it.
 */
export async function invalidateEndpoints(
  clientId: string,
  endpoints: string[],
  adminOverride?: Admin,
): Promise<void> {
  const admin = adminOverride ?? createAdminClient();
  await Promise.all(
    endpoints.map((endpoint) =>
      admin
        .from("response_cache")
        .delete()
        .eq("client_id", clientId)
        .eq("endpoint", endpoint)
        .like("cache_key", `${clientId}::${endpoint}::%`),
    ),
  );
}
