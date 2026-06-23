import "server-only";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import * as api from "./api";
import type { DateParams } from "./api";
import { cachedFetch, TIERS } from "./cache";

/**
 * Agency-level data for the admin console. Every export is behind requireAdmin(); client ids
 * always come from the agency mirror (olivia_clients) or Olivia discovery — never from the
 * browser — so an admin can read across their agency's clients but never a foreign agency's.
 */

export interface AgencyClient {
  id: string;
  name: string;
  status: string | null;
  industry: string | null;
  timezone: string | null;
  memberCount: number;
}

export interface AgencyClientStats extends AgencyClient {
  leads: number;
  calls: number;
  bookings: number; // appointments booked in the period (sum of Olivia booking_outcomes)
  pickupRate: number; // 0..1
}

/** The agency client roster (mirror of Olivia discovery) joined with Supabase member counts. */
export async function listAgencyClients(): Promise<AgencyClient[]> {
  await requireAdmin();
  const admin = createAdminClient();
  const [clientsRes, membersRes] = await Promise.all([
    admin
      .from("olivia_clients")
      .select("olivia_client_id, name, status, industry, timezone")
      .order("name", { ascending: true }),
    admin.from("workspace_members").select("olivia_client_id"),
  ]);

  const counts = new Map<string, number>();
  for (const m of membersRes.data ?? []) {
    const id = m.olivia_client_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return (clientsRes.data ?? []).map((c) => {
    const id = c.olivia_client_id as string;
    return {
      id,
      name: (c.name as string | null) ?? id,
      status: (c.status as string | null) ?? null,
      industry: (c.industry as string | null) ?? null,
      timezone: (c.timezone as string | null) ?? null,
      memberCount: counts.get(id) ?? 0,
    };
  });
}

/** One agency client + its members (emails/roles) for the client-detail view. */
export async function getAgencyClient(clientId: string): Promise<{
  client: AgencyClient;
  members: Array<{ userId: string; role: string }>;
} | null> {
  await requireAdmin();
  const all = await listAgencyClients();
  const client = all.find((c) => c.id === clientId);
  if (!client) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("workspace_members")
    .select("user_id, role")
    .eq("olivia_client_id", clientId);
  const members = (data ?? []).map((m) => ({
    userId: m.user_id as string,
    role: (m.role as string | null) ?? "member",
  }));
  return { client, members };
}

/**
 * Refresh the olivia_clients mirror from Olivia discovery. Skips the upstream call when the
 * mirror was synced within maxAgeSec (default 10 min) so it's cheap to call on every load.
 * Best-effort; returns rows synced (0 when skipped).
 */
export async function refreshAgencyClients(maxAgeSec = 600): Promise<number> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data: latest } = await admin
    .from("olivia_clients")
    .select("synced_at")
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest?.synced_at) {
    const ageSec = (Date.now() - new Date(latest.synced_at as string).getTime()) / 1000;
    if (ageSec < maxAgeSec) return 0;
  }
  const records = await api.discoverClients({ limit: 100 });
  if (!records.length) return 0;
  const rows = records.map((c) => ({
    olivia_client_id: c.id,
    name: c.name ?? null,
    slug: c.slug ?? null,
    status: c.status ?? null,
    industry: c.industry ?? null,
    timezone: c.timezone ?? null,
    synced_at: new Date().toISOString(),
  }));
  await admin.from("olivia_clients").upsert(rows, { onConflict: "olivia_client_id" });
  return rows.length;
}

// Per-client overview — admin-scoped. clientId originates from the agency mirror, and the SWR
// cache + governor are shared with the per-client dashboard (same endpoint/key), so the console
// rarely adds upstream load.
function clientOverview(clientId: string, params: DateParams) {
  return cachedFetch({
    clientId,
    endpoint: "overview",
    params: params as Record<string, unknown>,
    tier: TIERS.overview,
    fetcher: () => api.getOverview(clientId, params),
  });
}

function clientOutcomes(clientId: string, params: DateParams) {
  return cachedFetch({
    clientId,
    endpoint: "outcomes",
    params: params as Record<string, unknown>,
    tier: TIERS.outcomes,
    fetcher: () => api.getOutcomes(clientId, params),
  });
}

function sumBookings(outcomes: Partial<Record<string, number>> | undefined): number {
  if (!outcomes) return 0;
  let total = 0;
  for (const n of Object.values(outcomes)) total += n ?? 0;
  return total;
}

export interface AgencyOverview {
  totals: { clients: number; active: number; leads: number; calls: number; bookings: number };
  perClient: AgencyClientStats[];
  leaderboard: AgencyClientStats[]; // top by bookings, desc
}

/** Aggregate every agency client's Olivia overview into totals + a leaderboard. */
export async function getAgencyOverview(params: DateParams): Promise<AgencyOverview> {
  const clients = await listAgencyClients();
  const perClient = await Promise.all(
    clients.map(async (c): Promise<AgencyClientStats> => {
      try {
        const [ov, oc] = await Promise.all([
          clientOverview(c.id, params),
          clientOutcomes(c.id, params).catch(() => null),
        ]);
        const k = ov.data.kpis;
        return {
          ...c,
          leads: k.leads_total ?? 0,
          calls: k.calls_total ?? 0,
          bookings: sumBookings(oc?.data.outcomes.booking_outcomes),
          pickupRate: k.pickup_rate ?? 0,
        };
      } catch {
        // One client failing must not blank the whole console.
        return { ...c, leads: 0, calls: 0, bookings: 0, pickupRate: 0 };
      }
    }),
  );

  const totals = perClient.reduce(
    (acc, s) => ({
      clients: acc.clients,
      active: acc.active + (s.calls > 0 ? 1 : 0),
      leads: acc.leads + s.leads,
      calls: acc.calls + s.calls,
      bookings: acc.bookings + s.bookings,
    }),
    { clients: perClient.length, active: 0, leads: 0, calls: 0, bookings: 0 },
  );

  const leaderboard = [...perClient].sort((a, b) => b.bookings - a.bookings);
  return { totals, perClient, leaderboard };
}
