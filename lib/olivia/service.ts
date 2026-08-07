import "server-only";
import { getSessionClientId } from "@/lib/auth";
import * as api from "./api";
import type {
  BriefRealtime,
  ConversationsParams,
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
import { mergeThreadRows } from "@/lib/threads";
import { searchCorpus } from "@/lib/leads-search";
import { searchCallCorpus } from "@/lib/log-search";
import type {
  Agent,
  CalendarResponse,
  Call,
  Campaign,
  Conversation,
  ConversationThread,
  DmThread,
  Funnel,
  Lead,
  LeadDetail,
  ListResponse,
  Outcomes,
  Overview,
  PipelinesResponse,
  ThreadRow,
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

/** UTC `YYYY-MM-DD`, offset by `msFromNow`. Used for the widest-window thread sweep. */
function ymdUTC(msFromNow = 0): string {
  return new Date(Date.now() + msFromNow).toISOString().slice(0, 10);
}

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

export type LeadsSearchResult = ListResponse<Lead> & {
  /** The crawl did not cover the whole list — see api.getLeadsCorpus. */
  truncated: boolean;
  /** Rows the crawl actually collected and searched. Only meaningful with `truncated`. */
  searched: number;
};

/**
 * Search leads by name / phone / email / id across the whole window. Upstream has no search
 * param, so we cache the CORPUS (keyed on window + filters) and filter it in memory.
 * `q` is deliberately NOT part of the cache key — including it would write a cache entry
 * per keystroke.
 */
export async function searchLeads(
  params: LeadsParams & { q: string },
  opts: Opts = {},
): Promise<WithFreshness<LeadsSearchResult>> {
  const { q, page = 1, limit = 25, ...corpus } = params;
  const clientId = await getSessionClientId();
  const cached = await cachedFetch({
    clientId,
    endpoint: "leads-corpus",
    params: rec(corpus),
    tier: TIERS.leadsCorpus,
    force: opts.force,
    fetcher: () => api.getLeadsCorpus(clientId, corpus),
  });
  const { items, truncated } = cached.data;
  return {
    data: {
      ...searchCorpus(items, q, page, limit),
      truncated,
      // Derived from the corpus we hold rather than read off the payload: cache rows written
      // before `searched` existed would otherwise report `undefined` for their whole stale
      // window. Same number either way.
      searched: items.length,
    },
    freshness: cached.freshness,
  };
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

export type CallsSearchResult = ListResponse<Call> & {
  /** The crawl did not cover the whole window — see api.getCallsCorpus. */
  truncated: boolean;
  /** Rows the crawl actually collected and searched. Only meaningful with `truncated`. */
  searched: number;
};

/**
 * Search calls by lead name / phone / lead id across the whole window. Upstream has no search
 * param and ignores lead_id, so we cache the CORPUS (keyed on the window) and filter in memory.
 * `q` is deliberately NOT part of the cache key — including it would write a cache entry per
 * keystroke.
 *
 * Names are resolved BEFORE filtering: /calls carries only `lead_id`, so a search for "maria"
 * would match nothing if `withLeadNames` ran on the already-filtered page instead.
 */
export async function searchCalls(
  params: DateParams & PageParams & { q: string },
  opts: Opts = {},
): Promise<WithFreshness<CallsSearchResult>> {
  const { q, page = 1, limit = 25, ...corpus } = params;
  const clientId = await getSessionClientId();
  const [cached, dir] = await Promise.all([
    cachedFetch({
      clientId,
      endpoint: "calls-corpus",
      params: rec(corpus),
      tier: TIERS.callsCorpus,
      force: opts.force,
      fetcher: () => api.getCallsCorpus(clientId, corpus),
    }),
    // Best-effort, exactly as in fetchCalls: a dead directory degrades the search to
    // lead_id / phone matching rather than breaking the tab.
    leadDirectory(clientId, opts).catch(() => ({}) as Record<string, string>),
  ]);
  const { items, truncated } = cached.data;
  const named = withLeadNames(items, dir);
  return {
    data: {
      ...searchCallCorpus(named, q, page, limit),
      truncated,
      // Derived from the corpus we hold rather than read off the payload, so cache rows
      // written before `searched` existed don't report `undefined` for their stale window.
      searched: items.length,
    },
    freshness: cached.freshness,
  };
}

/**
 * Full call row (recording_url / transcript / callback_notes) for a single call. The lead-detail
 * endpoint embeds only a slim call shape, upstream has no per-call endpoint, and /calls ignores
 * a lead_id filter — so we page /calls over the call's UTC day (from/to are inclusive UTC days)
 * and match by id. Day pages flow through the normal calls cache tier, so repeated opens are cheap.
 */
const CALL_LOOKUP_PAGE_SIZE = 100; // API max per page
const CALL_LOOKUP_MAX_PAGES = 6; // safety cap (~600 calls/day) — beyond it we give up gracefully

export async function fetchCallDetail(
  callId: string,
  startedAt: string,
): Promise<Call | null> {
  // /calls from/to are inclusive UTC days — derive the UTC day through Date so a started_at
  // carrying a non-zero offset ("…T00:30+02:00" = previous UTC day) still hits the right window.
  const ms = Date.parse(startedAt);
  if (Number.isNaN(ms)) return null;
  const day = new Date(ms).toISOString().slice(0, 10);
  for (let page = 1; page <= CALL_LOOKUP_MAX_PAGES; page++) {
    const res = await fetchCalls({ from: day, to: day, page, limit: CALL_LOOKUP_PAGE_SIZE });
    const hit = res.data.items.find((c) => c.id === callId);
    if (hit) return hit;
    const pageSize = res.data.limit || CALL_LOOKUP_PAGE_SIZE;
    if (res.data.items.length < pageSize || page * pageSize >= res.data.total) break;
  }
  return null;
}

/** `channel` filters on the API enum; `lead_id` returns that lead's whole history
 *  (the from/to window is not applied when it is set). */
export async function fetchConversations(
  params: ConversationsParams = {},
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

// ---- Calendar ----
export async function fetchCalendar(
  params: { month: string; upcoming_limit?: number },
  opts: Opts = {},
): Promise<WithFreshness<CalendarResponse>> {
  const clientId = await getSessionClientId();
  return cachedFetch({
    clientId,
    endpoint: "calendar",
    params: rec(params),
    tier: TIERS.calendar,
    force: opts.force,
    fetcher: () => api.getCalendar(clientId, params),
  });
}

// ---- Lead detail + notes ----
export async function fetchLeadDetail(
  leadId: string,
  opts: Opts = {},
): Promise<WithFreshness<LeadDetail>> {
  const clientId = await getSessionClientId();
  return cachedFetch({
    clientId,
    endpoint: "lead-detail",
    params: { leadId },
    tier: TIERS.leadDetail,
    force: opts.force,
    fetcher: () => api.getLeadDetail(clientId, leadId),
  });
}

/**
 * Save a lead's notes (PUT, scope dashboard:notes — a 403 OliviaError means the key is
 * read-only for notes). Uncached write; afterwards the cached lead detail is force-refreshed
 * best-effort so the next page load doesn't serve the pre-save payload. The caller should
 * replace its local state with the returned { notes, updated_at } (last-write-wins).
 */
export async function saveLeadNotes(
  leadId: string,
  notes: string,
): Promise<{ notes: string; updated_at: string }> {
  const clientId = await getSessionClientId();
  const result = await api.putLeadNotes(clientId, leadId, notes);
  await fetchLeadDetail(leadId, { force: true }).catch(() => undefined);
  return result;
}

// ---- DM threads ----
export async function fetchDmThreads(
  params: PageParams & { lead_id?: string } = {},
  opts: Opts = {},
): Promise<WithFreshness<ListResponse<DmThread>>> {
  const clientId = await getSessionClientId();
  return cachedFetch({
    clientId,
    endpoint: "dm-threads",
    params: rec(params),
    tier: TIERS.dmThreads,
    force: opts.force,
    fetcher: () => api.getDmThreads(clientId, params),
  });
}

export async function fetchConversationThread(
  conversationId: string,
  limit?: number,
  opts: Opts & { before?: string } = {},
): Promise<WithFreshness<ConversationThread>> {
  const clientId = await getSessionClientId();
  const sub = {
    ...(limit ? { limit } : {}),
    ...(opts.before ? { before: opts.before } : {}),
  };
  return cachedFetch({
    clientId,
    endpoint: "thread",
    params: rec({ conversationId, ...sub }),
    tier: TIERS.thread,
    force: opts.force,
    fetcher: () => api.getConversationThread(clientId, conversationId, sub),
  });
}

/**
 * Every channel that carries message rows. `voice` is deliberately absent: voice conversations
 * hold no messages (transcripts live on `calls[].transcript`).
 *
 * These are queried PER CHANNEL rather than filtered client-side from one unfiltered page,
 * because voice dominates the log — a real client shows 7 205 voice conversations against 111
 * SMS, so an unfiltered page of 50 would contain almost no SMS at all. Fetching each channel
 * explicitly is what makes SMS visible; it is also what stops a future channel from being
 * silently swallowed the way SMS was.
 */
const MESSAGE_CHANNELS = ["sms", "chat", "email", "imessage"] as const;

/**
 * Conversations-tab rows: `/dm-threads` (DM networks — carries lead_name, preview text and
 * bot_active) merged with `/conversations` per message-bearing channel (carries the activity
 * counters, and the ONLY place SMS appears). Merged on conversation id, DM fields winning where
 * both describe the same thread, sorted by last activity.
 *
 * Deliberately NOT scoped to the page's date filter: threads are ranked by last activity, and a
 * months-old conversation that got a reply this morning must not fall out of the list. We ask
 * for the widest window the API allows (≤366 days) and cap the merged result.
 */
export async function fetchThreadRows(
  params: { limit?: number } = {},
  opts: Opts = {},
): Promise<WithFreshness<{ rows: ThreadRow[]; total: number; truncated: boolean }>> {
  const limit = params.limit ?? 50;
  const from = ymdUTC(-365 * 24 * 60 * 60 * 1000);
  const to = ymdUTC();

  const [dmRes, ...convRes] = await Promise.all([
    fetchDmThreads({ page: 1, limit }, opts).catch(() => null),
    ...MESSAGE_CHANNELS.map((channel) =>
      fetchConversations({ from, to, page: 1, limit, channel }, opts).catch(() => null),
    ),
  ]);
  const legs = [dmRes, ...convRes];
  // Partial failure is survivable — one dead channel must not blank the whole tab.
  if (legs.every((r) => r === null)) {
    throw new OliviaError(0, "network_error", "All thread sources failed");
  }

  const merged = mergeThreadRows(
    dmRes?.data.items ?? [],
    convRes.flatMap((r) => r?.data.items ?? []),
  );
  // Any leg that came back full, or a merge that overflows the cap, means there is more
  // behind the list — say so rather than implying the view is complete.
  const truncated =
    merged.length > limit || legs.some((r) => r !== null && r.data.items.length >= limit);
  // Freshness of the weakest leg — the list is only as current as its stalest source.
  const alive = legs.filter((r): r is NonNullable<typeof r> => r !== null);
  const freshness = alive.reduce((oldest, r) =>
    r.freshness.fetchedAt < oldest.freshness.fetchedAt ? r : oldest,
  ).freshness;

  const rows = merged.slice(0, limit);
  return { data: { rows, total: rows.length, truncated }, freshness };
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
