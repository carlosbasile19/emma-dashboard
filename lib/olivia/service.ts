import "server-only";
import { getSessionClientId } from "@/lib/auth";
import * as api from "./api";
import type { DateParams, LeadsParams, PageParams } from "./api";

/**
 * Session-scoped Olivia access — the ONLY surface the frontend should use.
 * Every call derives client_id from the authenticated session via getSessionClientId();
 * a browser can never influence which client's data is fetched.
 *
 * Phase 5 wraps these with caching, single-flight and the shared rate governor.
 */

export async function fetchOverview(params: DateParams = {}) {
  return api.getOverview(await getSessionClientId(), params);
}

export async function fetchTimeseries(params: DateParams = {}) {
  return api.getTimeseries(await getSessionClientId(), params);
}

export async function fetchOutcomes(params: DateParams = {}) {
  return api.getOutcomes(await getSessionClientId(), params);
}

export async function fetchFunnel(params: DateParams = {}) {
  return api.getFunnel(await getSessionClientId(), params);
}

export async function fetchAgents(params: DateParams = {}) {
  return api.getAgents(await getSessionClientId(), params);
}

export async function fetchCampaigns() {
  return api.getCampaigns(await getSessionClientId());
}

export async function fetchLeads(params: LeadsParams = {}) {
  return api.getLeads(await getSessionClientId(), params);
}

export async function fetchCalls(params: DateParams & PageParams = {}) {
  return api.getCalls(await getSessionClientId(), params);
}

export async function fetchConversations(params: DateParams & PageParams = {}) {
  return api.getConversations(await getSessionClientId(), params);
}
