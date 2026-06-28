import "server-only";
import { getSessionClientId } from "@/lib/auth";
import * as api from "./api";
import type {
  BriefRealtime,
  DateParams,
  LeadsParams,
  PageParams,
  ReportPeriod,
  ReportRealtime,
  ReportSummary,
  ReportingResponse,
  ReportingStatusResponse,
} from "./api";
import { OliviaError } from "./errors";
import { cachedFetch, TIERS } from "./cache";
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
  WithFreshness,
} from "@/lib/types";

/**
 * Session-scoped Olivia access — the ONLY surface the frontend should use.
 * Every call derives client_id from the authenticated session (getSessionClientId());
 * a browser can never influence which client's data is fetched. Each call flows through
 * the SWR cache + single-flight + shared rate governor and returns a freshness signal.
 */

interface Opts {
  /** Manual refresh: bypass the fresh window (still subject to the governor). */
  force?: boolean;
}

const rec = (o: object) => o as Record<string, unknown>;

export async function fetchOverview(
  params: DateParams = {},
  opts: Opts = {},
): Promise<WithFreshness<Overview>> {
  const clientId = await getSessionClientId();
  return cachedFetch({
    clientId,
    endpoint: "overview",
    params: rec(params),
    tier: TIERS.overview,
    force: opts.force,
    fetcher: () => api.getOverview(clientId, params),
  });
}

export async function fetchTimeseries(
  params: DateParams = {},
  opts: Opts = {},
): Promise<WithFreshness<Timeseries>> {
  const clientId = await getSessionClientId();
  return cachedFetch({
    clientId,
    endpoint: "timeseries",
    params: rec(params),
    tier: TIERS.timeseries,
    force: opts.force,
    fetcher: () => api.getTimeseries(clientId, params),
  });
}

export async function fetchOutcomes(
  params: DateParams = {},
  opts: Opts = {},
): Promise<WithFreshness<Outcomes>> {
  const clientId = await getSessionClientId();
  return cachedFetch({
    clientId,
    endpoint: "outcomes",
    params: rec(params),
    tier: TIERS.outcomes,
    force: opts.force,
    fetcher: () => api.getOutcomes(clientId, params),
  });
}

export async function fetchFunnel(
  params: DateParams = {},
  opts: Opts = {},
): Promise<WithFreshness<Funnel>> {
  const clientId = await getSessionClientId();
  return cachedFetch({
    clientId,
    endpoint: "funnel",
    params: rec(params),
    tier: TIERS.funnel,
    force: opts.force,
    fetcher: () => api.getFunnel(clientId, params),
  });
}

export async function fetchAgents(
  params: DateParams = {},
  opts: Opts = {},
): Promise<WithFreshness<Agent[]>> {
  const clientId = await getSessionClientId();
  return cachedFetch({
    clientId,
    endpoint: "agents",
    params: rec(params),
    tier: TIERS.agents,
    force: opts.force,
    fetcher: () => api.getAgents(clientId, params),
  });
}

export async function fetchCampaigns(opts: Opts = {}): Promise<WithFreshness<Campaign[]>> {
  const clientId = await getSessionClientId();
  return cachedFetch({
    clientId,
    endpoint: "campaigns",
    params: {},
    tier: TIERS.campaigns,
    force: opts.force,
    fetcher: () => api.getCampaigns(clientId),
  });
}

export async function fetchPipelines(
  opts: Opts = {},
): Promise<WithFreshness<PipelinesResponse>> {
  const clientId = await getSessionClientId();
  return cachedFetch({
    clientId,
    endpoint: "pipelines",
    params: {},
    tier: TIERS.pipelines,
    force: opts.force,
    fetcher: () => api.getPipelines(clientId),
  });
}

export async function fetchLeads(
  params: LeadsParams = {},
  opts: Opts = {},
): Promise<WithFreshness<ListResponse<Lead>>> {
  const clientId = await getSessionClientId();
  return cachedFetch({
    clientId,
    endpoint: "leads",
    params: rec(params),
    tier: TIERS.leads,
    force: opts.force,
    fetcher: () => api.getLeads(clientId, params),
  });
}

/**
 * lead_id → display name directory for the session's client. Calls/conversations carry only
 * `lead_id`; this resolves names from /leads so rows can show a person instead of a UUID.
 * Cached separately (stable, long fresh window) and shared across the calls + conversations views.
 */
async function leadDirectory(
  clientId: string,
  opts: Opts = {},
): Promise<Record<string, string>> {
  const res = await cachedFetch({
    clientId,
    endpoint: "lead-directory",
    params: {},
    tier: TIERS.leadDirectory,
    force: opts.force,
    fetcher: () => api.getLeadDirectory(clientId),
  });
  return res.data;
}

/** Fill each row's `.lead` from the directory, leaving the lead_id fallback when unresolved. */
function withLeadNames<T extends { lead_id: string; lead?: string | null }>(
  items: T[],
  dir: Record<string, string>,
): T[] {
  return items.map((item) =>
    item.lead == null && dir[item.lead_id] ? { ...item, lead: dir[item.lead_id] } : item,
  );
}

export async function fetchCalls(
  params: DateParams & PageParams = {},
  opts: Opts = {},
): Promise<WithFreshness<ListResponse<Call>>> {
  const clientId = await getSessionClientId();
  const [res, dir] = await Promise.all([
    cachedFetch({
      clientId,
      endpoint: "calls",
      params: rec(params),
      tier: TIERS.calls,
      force: opts.force,
      fetcher: () => api.getCalls(clientId, params),
    }),
    // Name resolution is best-effort — never let it break the call log.
    leadDirectory(clientId, opts).catch(() => ({}) as Record<string, string>),
  ]);
  return {
    ...res,
    data: { ...res.data, items: withLeadNames(res.data.items, dir) },
  };
}

export async function fetchConversations(
  params: DateParams & PageParams = {},
  opts: Opts = {},
): Promise<WithFreshness<ListResponse<Conversation>>> {
  const clientId = await getSessionClientId();
  const [res, dir] = await Promise.all([
    cachedFetch({
      clientId,
      endpoint: "conversations",
      params: rec(params),
      tier: TIERS.conversations,
      force: opts.force,
      fetcher: () => api.getConversations(clientId, params),
    }),
    leadDirectory(clientId, opts).catch(() => ({}) as Record<string, string>),
  ]);
  return {
    ...res,
    data: { ...res.data, items: withLeadNames(res.data.items, dir) },
  };
}

// ---- Briefing bridge ----
// Flag-gated and graceful: until OLIVIA_BRIEFING_ENABLED=true AND the backend ships the
// endpoint, this returns { mode: "simulated" } and the dashboard runs its local walkthrough.
// The moment the backend is live, flip the flag and live realtime creds flow through.
export interface BriefSession {
  mode: "live" | "simulated";
  briefingId?: string;
  realtime?: BriefRealtime;
}

// Trim: env values set via `echo` can carry a trailing newline ("true\n" !== "true").
const briefingEnabled = () => process.env.OLIVIA_BRIEFING_ENABLED?.trim() === "true";

export async function startBriefing(
  params: DateParams,
  focus: string,
): Promise<BriefSession> {
  // TEMP diagnostics (remove once prod briefing is verified): reveal why we fall back to sim.
  console.warn(
    "[brief] start enabled=%s flagRaw=%s",
    briefingEnabled(),
    JSON.stringify(process.env.OLIVIA_BRIEFING_ENABLED),
  );
  if (!briefingEnabled()) return { mode: "simulated" };
  const clientId = await getSessionClientId();
  try {
    const r = await api.startBriefing(clientId, { ...params, focus, voice: true });
    console.warn(
      "[brief] live ok briefing_id=%s hasRealtime=%s tokenField=%s",
      r.briefing_id,
      !!r.realtime,
      r.realtime ? (r.realtime.access_token ? "access_token" : r.realtime.token ? "token" : "none") : "n/a",
    );
    return { mode: "live", briefingId: r.briefing_id, realtime: r.realtime };
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string };
    console.warn(
      "[brief] api.startBriefing FAILED status=%s code=%s msg=%s",
      err?.status,
      err?.code,
      err?.message,
    );
    // backend not ready / errored → fall back to the simulated walkthrough
    return { mode: "simulated" };
  }
}

export async function endBriefing(briefingId: string): Promise<void> {
  if (!briefingEnabled() || !briefingId) return;
  try {
    const clientId = await getSessionClientId();
    await api.endBriefing(clientId, briefingId);
  } catch {
    /* best effort */
  }
}

// ---- Reporting bridge ----
// Same flag-gated, graceful pattern as briefing: until OLIVIA_REPORTING_ENABLED=true AND the
// backend ships the endpoint (with the key carrying `dashboard:report`), startReporting returns
// { mode: "simulated" } and the dashboard runs a local preview walkthrough. The clientId is ALWAYS
// derived from the session here — the browser can never influence which client is reported on.
export interface ReportSession {
  mode: "live" | "simulated";
  reportingId?: string;
  realtime?: ReportRealtime;
  period?: ReportingResponse["period"];
  summary?: ReportSummary;
  /** Surfaced when a recognizable Olivia error blocks the live session (e.g. 429/403), so the UI
   *  can show the right message + Retry-After. Other failures fall back silently to simulated. */
  error?: { code: string; message: string; retryAfterSeconds?: number };
}

const reportingEnabled = () => process.env.OLIVIA_REPORTING_ENABLED?.trim() === "true";

export async function startReporting(
  period: ReportPeriod,
  agentId?: string,
): Promise<ReportSession> {
  if (!reportingEnabled()) return { mode: "simulated" };
  const clientId = await getSessionClientId();
  try {
    const r = await api.startReporting(clientId, {
      ...period,
      ...(agentId ? { agent_id: agentId } : {}),
    });
    return {
      mode: "live",
      reportingId: r.reporting_id,
      realtime: r.realtime,
      period: r.period,
      summary: r.summary,
    };
  } catch (e) {
    if (e instanceof OliviaError) {
      // Capacity / scope problems are actionable — surface them (still degrade to the preview so
      // the modal stays usable). Backend-not-ready / network errors degrade silently like briefing.
      const surface =
        e.code === "reporting_concurrency_limit" ||
        e.code === "rate_limited" ||
        e.code === "forbidden_scope";
      return {
        mode: "simulated",
        ...(surface
          ? { error: { code: e.code, message: e.message, retryAfterSeconds: e.retryAfterSeconds } }
          : {}),
      };
    }
    return { mode: "simulated" };
  }
}

export async function endReporting(reportingId: string): Promise<void> {
  if (!reportingEnabled() || !reportingId) return;
  try {
    const clientId = await getSessionClientId();
    await api.endReporting(clientId, reportingId);
  } catch {
    /* best effort — idempotent on the backend */
  }
}

/** Session-scoped status (polling fallback). Throws AuthError if unauthenticated. */
export async function reportingStatus(reportingId: string): Promise<ReportingStatusResponse> {
  const clientId = await getSessionClientId();
  return api.getReportingStatus(clientId, reportingId);
}

/** Session-scoped live transcript stream (raw upstream Response). Throws AuthError if unauth. */
export async function streamReporting(
  reportingId: string,
  signal?: AbortSignal,
): Promise<Response> {
  const clientId = await getSessionClientId();
  return api.streamReporting(clientId, reportingId, signal);
}
