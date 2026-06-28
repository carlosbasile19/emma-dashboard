import "server-only";
import { oliviaFetch, oliviaStream, type OliviaFetchOptions, type QueryParams } from "./client";
import { fullName } from "@/lib/format";
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
  PipelinesResponse,
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
export type LeadsParams = DateParams & PageParams & { status?: string; source?: string; stage_id?: string };

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

export function getPipelines(clientId: string, h: Hints = {}) {
  return oliviaFetch<PipelinesResponse>(
    `${ANALYTICS}/clients/${cid(clientId)}/pipelines`,
    { ...h },
  );
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

// ---- Lead-name directory ----
// The /calls and /conversations endpoints carry only `lead_id`, never a name. To show a name we
// resolve lead_id → "First Last" from /leads (the sole name source, PII-gated). There is no
// /leads/{id} or id filter, so we page the list and build a directory. The window is the widest
// the API allows (≤366 days; omitting from/to would default to just 30) to maximize coverage —
// leads older than this (or beyond the page cap) simply fall back to the lead_id in the UI.
const LEAD_DIR_PAGE_SIZE = 100; // API max per page
const LEAD_DIR_MAX_PAGES = 25; // safety cap (~2500 leads); overflow falls back to the lead_id

function ymdUTC(msFromNow = 0): string {
  return new Date(Date.now() + msFromNow).toISOString().slice(0, 10);
}

export async function getLeadDirectory(
  clientId: string,
  h: Hints = {},
): Promise<Record<string, string>> {
  const from = ymdUTC(-365 * 24 * 60 * 60 * 1000);
  const to = ymdUTC();
  const dir: Record<string, string> = {};
  for (let page = 1; page <= LEAD_DIR_MAX_PAGES; page++) {
    const { items, total, limit } = await getLeads(
      clientId,
      { from, to, page, limit: LEAD_DIR_PAGE_SIZE },
      h,
    );
    for (const lead of items) {
      const name = fullName(lead.first_name, lead.last_name);
      if (name) dir[lead.id] = name;
    }
    const pageSize = limit || LEAD_DIR_PAGE_SIZE;
    if (items.length < pageSize || page * pageSize >= total) break;
    if (page === LEAD_DIR_MAX_PAGES) {
      console.warn(
        "[olivia] lead directory truncated at %d leads (total=%d) — older rows fall back to lead_id",
        LEAD_DIR_MAX_PAGES * pageSize,
        total,
      );
    }
  }
  return dir;
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

// ---- Briefing bridge (server-to-server action; see docs/olivia-briefing-bridge.md) ----
// Realtime transport is Retell web calls (the backend already runs Olivia's voice on Retell).
export interface BriefRealtime {
  provider: string; // "retell"
  // Retell web call — the browser joins via the Retell Web SDK with this access token.
  access_token?: string;
  call_id?: string;
  sample_rate?: number;
  expires_at?: string;
  // Generic fallback fields, in case the transport is ever swapped:
  url?: string;
  token?: string;
  room?: string;
}
export interface BriefAgendaItem {
  id: string;
  category: string;
  title: string;
  detail?: string;
  priority?: number;
}
export interface BriefingResponse {
  briefing_id: string;
  client_id: string;
  status: string;
  agenda?: BriefAgendaItem[];
  realtime?: BriefRealtime;
}

export interface StartBriefingBody {
  from?: string;
  to?: string;
  tz?: string;
  focus?: string;
  voice?: boolean;
}

export function startBriefing(clientId: string, body: StartBriefingBody, h: Hints = {}) {
  return oliviaFetch<BriefingResponse>(`${ANALYTICS}/clients/${cid(clientId)}/briefings`, {
    method: "POST",
    body,
    ...h,
  });
}

export function endBriefing(clientId: string, briefingId: string, h: Hints = {}) {
  return oliviaFetch<{ status: string }>(
    `${ANALYTICS}/clients/${cid(clientId)}/briefings/${encodeURIComponent(briefingId)}/end`,
    { method: "POST", ...h },
  );
}

// ---- Reporting bridge (server-to-server action; see docs/olivia-reporting-bridge.md) ----
// Same shape as the briefing bridge — same x-api-key auth and Retell realtime join. The only
// differences from briefings: the path word is `reporting` and the agency key must carry the
// `dashboard:report` scope (optionally `dashboard:pii` to let Olivia speak lead names). Reporting
// is a strictly READ-ONLY spoken walkthrough scoped server-side to this one {clientId}.

/** Realtime join creds. Reporting emits the generic transport shape (url/token/room); we also
 *  accept the briefing-style fields (access_token/call_id) so either backend revision works. */
export interface ReportRealtime {
  provider: string; // "retell"
  url?: string; // "https://api.retellai.com"
  token?: string; // Retell web-call access token — the browser joins with this
  room?: string; // Retell call id
  expires_at?: string;
  // Briefing-style aliases, accepted for forward-compat:
  access_token?: string;
  call_id?: string;
  sample_rate?: number;
}

export interface ReportPeriod {
  from: string;
  to: string;
  tz: string;
}

export interface ReportSummary {
  schedule_count: number;
  loom_count: number;
}

export type ReportingStatusValue = "queued" | "connecting" | "live" | "ended" | "failed";

export interface ReportTranscriptEntry {
  role: "agent" | "user";
  text: string;
  at: string;
}

export interface ReportingResponse {
  reporting_id: string;
  client_id: string;
  status: ReportingStatusValue;
  period: ReportPeriod;
  summary?: ReportSummary;
  realtime?: ReportRealtime;
}

export interface ReportingStatusResponse {
  status: ReportingStatusValue;
  started_at?: string | null;
  ended_at?: string | null;
  transcript?: ReportTranscriptEntry[];
}

export interface StartReportingBody {
  from?: string;
  to?: string;
  tz?: string;
  /**
   * Optional voice drill-down into ONE agent. Forward-compat: the documented body is {from,to,tz},
   * so this is sent only when the user explicitly picks an agent — the default walkthrough body
   * stays exactly spec-compliant. Scoped server-side to the session's client like everything else.
   */
  agent_id?: string;
}

export function startReporting(clientId: string, body: StartReportingBody, h: Hints = {}) {
  return oliviaFetch<ReportingResponse>(`${ANALYTICS}/clients/${cid(clientId)}/reporting`, {
    method: "POST",
    body,
    // A concurrency-limit 429 should surface to the UI immediately (with Retry-After) rather than
    // blocking the start for 60s+ on auto-retry — the start is a user-initiated, one-shot action.
    maxRetries: 0,
    ...h,
  });
}

export function getReportingStatus(clientId: string, reportingId: string, h: Hints = {}) {
  return oliviaFetch<ReportingStatusResponse>(
    `${ANALYTICS}/clients/${cid(clientId)}/reporting/${encodeURIComponent(reportingId)}`,
    { ...h },
  );
}

export function endReporting(clientId: string, reportingId: string, h: Hints = {}) {
  return oliviaFetch<{ status: string }>(
    `${ANALYTICS}/clients/${cid(clientId)}/reporting/${encodeURIComponent(reportingId)}/end`,
    { method: "POST", ...h },
  );
}

/** Live transcript SSE — returns the raw upstream Response for a same-origin route to pipe. */
export function streamReporting(clientId: string, reportingId: string, signal?: AbortSignal) {
  return oliviaStream(
    `${ANALYTICS}/clients/${cid(clientId)}/reporting/${encodeURIComponent(reportingId)}/stream`,
    { signal },
  );
}
