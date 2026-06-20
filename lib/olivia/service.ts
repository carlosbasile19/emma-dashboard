import "server-only";
import { getSessionClientId } from "@/lib/auth";
import * as api from "./api";
import type { DateParams, LeadsParams, PageParams } from "./api";
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

export async function fetchCalls(
  params: DateParams & PageParams = {},
  opts: Opts = {},
): Promise<WithFreshness<ListResponse<Call>>> {
  const clientId = await getSessionClientId();
  return cachedFetch({
    clientId,
    endpoint: "calls",
    params: rec(params),
    tier: TIERS.calls,
    force: opts.force,
    fetcher: () => api.getCalls(clientId, params),
  });
}

export async function fetchConversations(
  params: DateParams & PageParams = {},
  opts: Opts = {},
): Promise<WithFreshness<ListResponse<Conversation>>> {
  const clientId = await getSessionClientId();
  return cachedFetch({
    clientId,
    endpoint: "conversations",
    params: rec(params),
    tier: TIERS.conversations,
    force: opts.force,
    fetcher: () => api.getConversations(clientId, params),
  });
}
