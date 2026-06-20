import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import * as api from "./api";

// ───────────────────────────────────────────────────────────────────────────
// Phase 8 — snapshot seam. SCAFFOLDED BUT INACTIVE.
// Nothing here runs unless SNAPSHOTS_ENABLED=true (checked in the cron route).
// It is structured so a future "history from snapshots + today live" read path can
// be composed without refactoring the views.
// ───────────────────────────────────────────────────────────────────────────

export interface DailySnapshotPayload {
  capturedAt: string;
  overview: unknown;
  funnel: unknown;
  outcomes: unknown;
  timeseries: unknown;
}

/**
 * Capture one client's aggregates for a single day and upsert the snapshot row.
 * Only *today's* row is ever (re)written; past days were captured on their own day and
 * are never touched again — i.e. closed days are immutable.
 */
export async function captureDailySnapshot(clientId: string, date: string, tz: string) {
  const params = { from: date, to: date, tz };
  const [overview, funnel, outcomes, timeseries] = await Promise.all([
    api.getOverview(clientId, params),
    api.getFunnel(clientId, params),
    api.getOutcomes(clientId, params),
    api.getTimeseries(clientId, params),
  ]);
  const payload: DailySnapshotPayload = {
    capturedAt: new Date().toISOString(),
    overview,
    funnel,
    outcomes,
    timeseries,
  };
  const admin = createAdminClient();
  await admin
    .from("daily_snapshots")
    .upsert({ client_id: clientId, date, payload }, { onConflict: "client_id,date" });
  return { clientId, date };
}

/** Capture today's snapshot for every known client. Called only when snapshots are enabled. */
export async function runDailySnapshots() {
  const admin = createAdminClient();
  const { data: clients } = await admin
    .from("olivia_clients")
    .select("olivia_client_id, timezone");
  const today = new Date().toISOString().slice(0, 10); // UTC day
  const results: Array<{ clientId: string; date?: string; error?: string }> = [];
  for (const c of clients ?? []) {
    try {
      results.push(
        await captureDailySnapshot(
          c.olivia_client_id as string,
          today,
          (c.timezone as string | null) ?? "America/New_York",
        ),
      );
    } catch (e) {
      results.push({ clientId: c.olivia_client_id as string, error: (e as Error).message });
    }
  }
  return { day: today, captured: results.length, results };
}

/**
 * Read seam (inactive): closed days from daily_snapshots. The future composition merges this
 * with today's live value (the existing cachedFetch path) — both use the same domain types, so
 * views won't need refactoring. Not wired into any view in v1.
 */
export async function getSnapshotHistory(clientId: string, from: string, to: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("daily_snapshots")
    .select("date, payload")
    .eq("client_id", clientId)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true });
  return data ?? [];
}
