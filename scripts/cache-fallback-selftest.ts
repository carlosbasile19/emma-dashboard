import assert from "node:assert/strict";
import {
  FALLBACK_MAX_AGE_SEC,
  pickFallbackRow,
  type FallbackCandidate,
} from "../lib/olivia/fallback";
import { cachedFetch, cacheKey, TIERS } from "../lib/olivia/cache";
import type { createAdminClient } from "../lib/supabase/admin";
import { OliviaError } from "../lib/olivia/errors";

type Admin = ReturnType<typeof createAdminClient>;

interface Row {
  cache_key: string;
  client_id: string;
  endpoint: string;
  payload: unknown;
  fetched_at: string;
}

// Minimal stand-in for the two supabase-js query shapes cache.ts uses:
// exact read (.eq("cache_key").maybeSingle()) and the fallback listing
// (.eq("client_id").eq("endpoint").order().limit() awaited directly).
class FakeQuery {
  private filters: Record<string, unknown> = {};
  constructor(private rows: Row[]) {}
  select() {
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters[col] = val;
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    return Promise.resolve({ data: this.apply().slice(0, n), error: null });
  }
  maybeSingle() {
    return Promise.resolve({ data: this.apply()[0] ?? null, error: null });
  }
  private apply(): Row[] {
    return this.rows
      .filter((r) =>
        Object.entries(this.filters).every(([k, v]) => r[k as keyof Row] === v),
      )
      .sort((a, b) => (a.fetched_at < b.fetched_at ? 1 : -1));
  }
}

function fakeAdmin(rows: Row[], opts: { allowTokens?: boolean } = {}): Admin {
  const admin = {
    from(table: string) {
      assert.equal(table, "response_cache");
      return Object.assign(new FakeQuery(rows), {
        upsert: async (row: Row) => {
          rows.push(row);
          return { error: null };
        },
      });
    },
    rpc: async (name: string) => {
      if (name === "consume_rate_token") {
        return { data: opts.allowTokens ?? true, error: null };
      }
      return { data: true, error: null }; // try_acquire_lock / release_lock
    },
  };
  return admin as unknown as Admin;
}

const CID = "9c6d445a-4d4a-465b-aca7-b8108083e529";
const OTHER_CID = "01b1fb8e-2b65-4330-8f0d-ed631afa03bf";
const PARAMS = { from: "2026-06-07", to: "2026-07-06", tz: "Australia/Brisbane" };
const OLD_WINDOW = { from: "2026-06-06", to: "2026-07-05", tz: "Australia/Brisbane" };

const agoIso = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();

function row(
  clientId: string,
  endpoint: string,
  params: Record<string, unknown>,
  payload: unknown,
  ageSec: number,
): Row {
  return {
    cache_key: cacheKey(clientId, endpoint, params),
    client_id: clientId,
    endpoint,
    payload,
    fetched_at: agoIso(ageSec),
  };
}

const failingFetcher = () => Promise.reject(new OliviaError(500, "internal_error", "boom"));

async function main() {
  let checks = 0;
  const ok = (label: string) => {
    checks++;
    console.log(`  ✓ ${label}`);
  };

  // ---- pickFallbackRow (pure matcher) ----

  {
    const rows: FallbackCandidate[] = [
      row(CID, "overview", OLD_WINDOW, { v: "old-window" }, 20 * 3600),
      row(CID, "overview", { ...OLD_WINDOW, from: "2026-05-01", to: "2026-05-30" }, { v: "older" }, 40 * 3600),
    ];
    const hit = pickFallbackRow(rows, CID, "overview", PARAMS, Date.now());
    assert.deepEqual(hit?.payload, { v: "old-window" });
    ok("picks the newest row whose non-window params match");
  }

  {
    const rows: FallbackCandidate[] = [
      row(CID, "overview", { ...OLD_WINDOW, tz: "America/New_York" }, { v: "wrong-tz" }, 3600),
    ];
    assert.equal(pickFallbackRow(rows, CID, "overview", PARAMS, Date.now()), null);
    ok("rejects rows whose non-window params differ (tz)");
  }

  {
    const rows: FallbackCandidate[] = [
      row(OTHER_CID, "overview", OLD_WINDOW, { v: "other-client" }, 3600),
    ];
    assert.equal(pickFallbackRow(rows, CID, "overview", PARAMS, Date.now()), null);
    ok("never crosses a client boundary");
  }

  {
    const rows: FallbackCandidate[] = [
      row(CID, "overview", OLD_WINDOW, { v: "ancient" }, FALLBACK_MAX_AGE_SEC + 3600),
    ];
    assert.equal(pickFallbackRow(rows, CID, "overview", PARAMS, Date.now()), null);
    ok("rejects rows older than the fallback cap");
  }

  {
    const rows: FallbackCandidate[] = [
      {
        cache_key: `${CID}::overview::not-json`,
        payload: { v: "bad" },
        fetched_at: agoIso(3600),
      },
      row(CID, "overview", OLD_WINDOW, { v: "good" }, 7200),
    ];
    const hit = pickFallbackRow(rows, CID, "overview", PARAMS, Date.now());
    assert.deepEqual(hit?.payload, { v: "good" });
    ok("skips malformed cache keys");
  }

  // ---- cachedFetch integration (fake admin) ----

  const base = { clientId: CID, endpoint: "overview", params: PARAMS, tier: TIERS.overview };

  {
    const rows = [row(CID, "overview", PARAMS, { v: "exact-stale" }, 2 * 3600)];
    const res = await cachedFetch({ ...base, admin: fakeAdmin(rows), fetcher: failingFetcher });
    assert.deepEqual(res.data, { v: "exact-stale" });
    assert.equal(res.freshness.stale, true);
    ok("stale-on-error still serves the exact key first");
  }

  {
    const rows = [row(CID, "overview", OLD_WINDOW, { v: "fallback" }, 20 * 3600)];
    const res = await cachedFetch({ ...base, admin: fakeAdmin(rows), fetcher: failingFetcher });
    assert.deepEqual(res.data, { v: "fallback" });
    assert.equal(res.freshness.stale, true);
    assert.ok(Date.now() - res.freshness.fetchedAt > 19 * 3600 * 1000);
    ok("upstream error + empty exact key falls back to the newest compatible window");
  }

  {
    const rows = [
      row(CID, "overview", { ...OLD_WINDOW, tz: "America/New_York" }, { v: "wrong-tz" }, 3600),
    ];
    await assert.rejects(
      cachedFetch({ ...base, admin: fakeAdmin(rows), fetcher: failingFetcher }),
      (e: unknown) => e instanceof OliviaError && e.code === "internal_error",
    );
    ok("still surfaces the upstream error when nothing compatible is cached");
  }

  {
    const rows = [row(CID, "overview", OLD_WINDOW, { v: "fallback" }, 20 * 3600)];
    const res = await cachedFetch({
      ...base,
      admin: fakeAdmin(rows, { allowTokens: false }),
      fetcher: () => Promise.resolve({ v: "never-called" }),
    });
    assert.deepEqual(res.data, { v: "fallback" });
    assert.equal(res.freshness.stale, true);
    ok("governor block serves the fallback instead of erroring");
  }

  {
    const rows: Row[] = [];
    const res = await cachedFetch({
      ...base,
      admin: fakeAdmin(rows),
      fetcher: () => Promise.resolve({ v: "live" }),
    });
    assert.deepEqual(res.data, { v: "live" });
    assert.equal(res.freshness.stale, false);
    assert.equal(rows.length, 1);
    ok("happy path unchanged: live fetch, cache written");
  }

  console.log(`\ncache-fallback selftest: all ${checks} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
