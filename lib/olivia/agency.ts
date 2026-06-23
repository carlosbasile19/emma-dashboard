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

/** Latest olivia_clients sync time (for the console "Synced … ago" indicator). */
export async function getMirrorSyncedAt(): Promise<string | null> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin
    .from("olivia_clients")
    .select("synced_at")
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.synced_at as string | null) ?? null;
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

export interface InviteRow {
  id: string;
  token: string;
  clientId: string;
  clientName: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

/** All invites (pending + history), newest first, with workspace names resolved. */
export async function listInvites(): Promise<InviteRow[]> {
  await requireAdmin();
  const admin = createAdminClient();
  const [invitesRes, clients] = await Promise.all([
    admin
      .from("invites")
      .select("id, token, olivia_client_id, email, role, status, created_at, expires_at")
      .order("created_at", { ascending: false }),
    listAgencyClients(),
  ]);
  const nameById = new Map(clients.map((c) => [c.id, c.name]));
  return (invitesRes.data ?? []).map((i) => ({
    id: i.id as string,
    token: i.token as string,
    clientId: i.olivia_client_id as string,
    clientName: nameById.get(i.olivia_client_id as string) ?? (i.olivia_client_id as string),
    email: i.email as string,
    role: (i.role as string | null) ?? "member",
    status: (i.status as string | null) ?? "pending",
    createdAt: i.created_at as string,
    expiresAt: i.expires_at as string,
  }));
}

export interface MemberRow {
  userId: string;
  email: string | null;
  clientId: string;
  clientName: string;
  role: string;
}

/** Every workspace member across the agency, with emails + workspace names resolved. */
export async function listMembers(): Promise<MemberRow[]> {
  await requireAdmin();
  const admin = createAdminClient();
  const [membersRes, clients, usersRes] = await Promise.all([
    admin.from("workspace_members").select("user_id, olivia_client_id, role"),
    listAgencyClients(),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const nameById = new Map(clients.map((c) => [c.id, c.name]));
  const emailById = new Map(
    (usersRes.data?.users ?? []).map((u) => [u.id, u.email ?? null]),
  );
  return (membersRes.data ?? []).map((m) => {
    const clientId = m.olivia_client_id as string;
    return {
      userId: m.user_id as string,
      email: emailById.get(m.user_id as string) ?? null,
      clientId,
      clientName: nameById.get(clientId) ?? clientId,
      role: (m.role as string | null) ?? "member",
    };
  });
}

export interface TeamMember {
  userId: string;
  email: string | null;
  role: string;
}

/**
 * The agency team = platform admins (the people who can reach the console + every client).
 * Phase 3 reuses the existing role rather than a separate agency-membership model.
 */
export async function listAgencyTeam(): Promise<TeamMember[]> {
  await requireAdmin();
  const admin = createAdminClient();
  const [membersRes, usersRes] = await Promise.all([
    admin.from("workspace_members").select("user_id, role").eq("role", "platform_admin"),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const emailById = new Map(
    (usersRes.data?.users ?? []).map((u) => [u.id, u.email ?? null]),
  );
  return (membersRes.data ?? []).map((m) => ({
    userId: m.user_id as string,
    email: emailById.get(m.user_id as string) ?? null,
    role: (m.role as string | null) ?? "platform_admin",
  }));
}

export interface ClientDetail {
  client: AgencyClient;
  stats: { leads: number; calls: number; bookings: number; pickupRate: number };
  members: Array<{ userId: string; email: string | null; role: string }>;
}

/** One client's full detail for the console: roster row + period stats + members (with emails). */
export async function getClientDetail(
  clientId: string,
  params: DateParams,
): Promise<ClientDetail | null> {
  await requireAdmin();
  const base = await getAgencyClient(clientId);
  if (!base) return null;
  const admin = createAdminClient();

  const [ov, oc] = await Promise.all([
    clientOverview(clientId, params),
    clientOutcomes(clientId, params).catch(() => null),
  ]);
  const emails = await Promise.all(
    base.members.map((m) =>
      admin.auth.admin
        .getUserById(m.userId)
        .then((r) => r.data.user?.email ?? null)
        .catch(() => null),
    ),
  );
  const k = ov.data.kpis;
  return {
    client: base.client,
    stats: {
      leads: k.leads_total ?? 0,
      calls: k.calls_total ?? 0,
      bookings: sumBookings(oc?.data.outcomes.booking_outcomes),
      pickupRate: k.pickup_rate ?? 0,
    },
    members: base.members.map((m, i) => ({
      userId: m.userId,
      email: emails[i] ?? null,
      role: m.role,
    })),
  };
}
