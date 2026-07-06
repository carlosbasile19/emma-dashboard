import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { OliviaError } from "./errors";
import { pickFallbackRow, stableStringify } from "./fallback";
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
  calls: { fresh: 30, stale: 60 },
  conversations: { fresh: 30, stale: 60 },
  calendar: { fresh: 60, stale: 300 },
  leadDetail: { fresh: 30, stale: 60 },
  dmThreads: { fresh: 30, stale: 60 },
  // Full message threads: short fresh window so an open drawer shows near-live messages.
  thread: { fresh: 15, stale: 60 },
  agencyCosts: { fresh: 120, stale: 600 },
  discovery: { fresh: 3600, stale: 86400 },
} as const satisfies Record<string, Tier>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const { data } = await admin
    .from("response_cache")
    .select("cache_key, payload, fetched_at")
    .eq("client_id", clientId)
    .eq("endpoint", endpoint)
    .order("fetched_at", { ascending: false })
    .limit(24);
  return pickFallbackRow(
    (data as (CacheRow & { cache_key: string })[] | null) ?? [],
    clientId,
    endpoint,
    params,
    Date.now(),
  );
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
      // Another instance is refreshing this key. Briefly await its result…
      for (let i = 0; i < 6; i++) {
        await sleep(180);
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
