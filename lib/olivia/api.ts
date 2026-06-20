import "server-only";
import { oliviaFetch, type OliviaFetchOptions, type QueryParams } from "./client";
import type {
  Agent,
  Call,
  Campaign,
  Conversation,
  Funnel,
  Lead,
  ListResponse,
  Outcomes,
  Overview,
  Timeseries,
} from "@/lib/types";

// Base trees (guide §3) — note the differing segment order.
const DISCOVERY = "/api/v1/external";
const ANALYTICS = "/api/external/v1";

export interface OliviaClientRecord {
  id: string;
  name: string;
  slug?: string;
  status?: string;
  industry?: string;
  website?: string;
  timezone?: string;
  created_at?: string;
}

export interface DateParams {
  from?: string;
  to?: string;
  tz?: string;
}
export interface PageParams {
  page?: number;
  limit?: number;
}
export type LeadsParams = DateParams & PageParams & { status?: string; source?: string };

type Hints = Pick<OliviaFetchOptions, "next" | "signal" | "maxRetries">;

const cid = (clientId: string) => encodeURIComponent(clientId);

// Some PII text fields (e.g. call transcript) arrive wrapped as `{ raw: "…" }` rather than a
// plain string. Normalize to a string|null so the UI never tries to render an object.
function flatText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && "raw" in (v as Record<string, unknown>)) {
    const raw = (v as { raw: unknown }).raw;
    return typeof raw === "string" ? raw : raw == null ? null : String(raw);
  }
  return String(v);
}

// ---- Discovery (scope clients:read) — not client-scoped ----
export async function discoverClients(
  opts: { page?: number; limit?: number } & Hints = {},
): Promise<OliviaClientRecord[]> {
  const res = await oliviaFetch<{
    clients: OliviaClientRecord[];
    total: number;
    page: number;
    limit: number;
  }>(`${DISCOVERY}/clients`, {
    params: { page: opts.page ?? 1, limit: opts.limit ?? 100 },
    next: opts.next,
    signal: opts.signal,
    maxRetries: opts.maxRetries,
  });
  return res.clients ?? [];
}

// ---- Analytics (scope dashboard:read) — {clientId} required ----
export function getOverview(clientId: string, params: DateParams, h: Hints = {}) {
  return oliviaFetch<Overview>(`${ANALYTICS}/clients/${cid(clientId)}/overview`, {
    params: params as QueryParams,
    ...h,
  });
}

export function getTimeseries(clientId: string, params: DateParams, h: Hints = {}) {
  return oliviaFetch<Timeseries>(`${ANALYTICS}/clients/${cid(clientId)}/timeseries`, {
    params: params as QueryParams,
    ...h,
  });
}

export function getOutcomes(clientId: string, params: DateParams, h: Hints = {}) {
  return oliviaFetch<Outcomes>(`${ANALYTICS}/clients/${cid(clientId)}/outcomes`, {
    params: params as QueryParams,
    ...h,
  });
}

export function getFunnel(clientId: string, params: DateParams, h: Hints = {}) {
  return oliviaFetch<Funnel>(`${ANALYTICS}/clients/${cid(clientId)}/funnel`, {
    params: params as QueryParams,
    ...h,
  });
}

export function getAgents(clientId: string, params: DateParams, h: Hints = {}) {
  return oliviaFetch<{ client_id: string; period: unknown; agents: Agent[] }>(
    `${ANALYTICS}/clients/${cid(clientId)}/agents`,
    { params: params as QueryParams, ...h },
  ).then((r) => r.agents ?? []);
}

// /campaigns is lifetime-to-date (no from/to slicing per guide §6.6).
export function getCampaigns(clientId: string, h: Hints = {}) {
  return oliviaFetch<{ client_id: string; campaigns: Campaign[]; total: number }>(
    `${ANALYTICS}/clients/${cid(clientId)}/campaigns`,
    { ...h },
  ).then((r) => r.campaigns ?? []);
}

export async function getLeads(
  clientId: string,
  params: LeadsParams,
  h: Hints = {},
): Promise<ListResponse<Lead>> {
  const r = await oliviaFetch<{
    leads: Lead[];
    total: number;
    page: number;
    limit: number;
  }>(`${ANALYTICS}/clients/${cid(clientId)}/leads`, { params: params as QueryParams, ...h });
  return { items: r.leads ?? [], total: r.total, page: r.page, limit: r.limit };
}

export async function getCalls(
  clientId: string,
  params: DateParams & PageParams,
  h: Hints = {},
): Promise<ListResponse<Call>> {
  const r = await oliviaFetch<{
    calls: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
  }>(`${ANALYTICS}/clients/${cid(clientId)}/calls`, { params: params as QueryParams, ...h });
  const items: Call[] = (r.calls ?? []).map((c) => ({
    ...(c as unknown as Call),
    transcript: flatText(c.transcript),
    callback_notes: flatText(c.callback_notes),
  }));
  return { items, total: r.total, page: r.page, limit: r.limit };
}

export async function getConversations(
  clientId: string,
  params: DateParams & PageParams,
  h: Hints = {},
): Promise<ListResponse<Conversation>> {
  const r = await oliviaFetch<{
    conversations: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
  }>(`${ANALYTICS}/clients/${cid(clientId)}/conversations`, { params: params as QueryParams, ...h });
  const items: Conversation[] = (r.conversations ?? []).map((c) => ({
    ...(c as unknown as Conversation),
    summary: flatText(c.summary),
  }));
  return { items, total: r.total, page: r.page, limit: r.limit };
}
