// Pure helpers for the cross-window cache fallback. Deliberately NOT "server-only":
// nothing here touches secrets, and keeping it import-safe lets the selftest exercise
// the matching logic directly (scripts/cache-fallback-selftest.ts).

/** Params keys that define the requested date window. Only these may differ in a fallback. */
const WINDOW_KEYS = new Set(["from", "to"]);

/**
 * How far back a cross-window fallback may reach. Exact-key stale-on-error has no cap
 * (last-known-good for the same window is always better than an error), but serving a
 * *different* window gets less truthful with age, so cap it.
 */
export const FALLBACK_MAX_AGE_SEC = 7 * 24 * 3600;

export interface FallbackCandidate {
  cache_key: string;
  payload: unknown;
  fetched_at: string;
}

export function stableStringify(obj: Record<string, unknown>): string {
  const clean = Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      const v = obj[k];
      if (v !== undefined && v !== null && v !== "") acc[k] = v;
      return acc;
    }, {});
  return JSON.stringify(clean);
}

/** Fingerprint of everything except the date window — filters, tz, etc. must match exactly. */
function windowFreeFingerprint(params: Record<string, unknown>): string {
  const rest = Object.keys(params).reduce<Record<string, unknown>>((acc, k) => {
    if (!WINDOW_KEYS.has(k)) acc[k] = params[k];
    return acc;
  }, {});
  return stableStringify(rest);
}

/**
 * Newest cached row usable as a stand-in for `params` when the exact window has no cache
 * yet (date windows roll daily, so an upstream outage right after rollover would otherwise
 * error even though yesterday's window is sitting in the cache). A row qualifies only if it
 * belongs to the same client + endpoint AND every non-window param matches — a different
 * tz or filter set is different data, not a fallback. `rows` must be newest-first.
 */
export function pickFallbackRow(
  rows: FallbackCandidate[],
  clientId: string,
  endpoint: string,
  params: Record<string, unknown>,
  nowMs: number,
): FallbackCandidate | null {
  const prefix = `${clientId}::${endpoint}::`;
  const want = windowFreeFingerprint(params);
  for (const row of rows) {
    if (!row.cache_key.startsWith(prefix)) continue;
    if ((nowMs - new Date(row.fetched_at).getTime()) / 1000 > FALLBACK_MAX_AGE_SEC) continue;
    let rowParams: Record<string, unknown>;
    try {
      rowParams = JSON.parse(row.cache_key.slice(prefix.length));
    } catch {
      continue;
    }
    if (windowFreeFingerprint(rowParams) === want) return row;
  }
  return null;
}
