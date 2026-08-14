import "server-only";
import { oliviaFetch, oliviaStream, type OliviaFetchOptions, type QueryParams } from "./client";
import { fullName } from "@/lib/format";
import { byRecencyDesc } from "@/lib/threads";
import { hasMorePages } from "@/lib/leads-search";
import { shouldFetchNextPage } from "./crawl";
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
  ThreadMessage,
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
  let fetched = 0;
  let lastTotal: number | undefined;

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
    fetched += items.length;
    lastTotal = total;
    const pageSize = limit || LEAD_DIR_PAGE_SIZE;
    // Termination lives in `shouldFetchNextPage` so a short page mid-list no longer reads as
    // the end of the list. It used to: a 250-lead client whose second page came back with 80
    // rows stopped at 180, and the ~70 missing names showed as raw lead ids in the call and
    // conversation logs with nothing explaining why.
    if (!shouldFetchNextPage(fetched, { received: items.length, total, pageSize })) break;
    if (page === LEAD_DIR_MAX_PAGES) {
      console.warn(
        "[olivia] lead directory hit the %d-page cap at %d leads (total=%d) — older rows fall back to lead_id",
        LEAD_DIR_MAX_PAGES,
        fetched,
        total,
      );
    }
  }

  // Ending short of a known total means rows were dropped upstream. The directory degrades
  // gracefully (callers fall back to the lead_id), but it should not do so silently.
  if (Number.isFinite(lastTotal) && fetched < (lastTotal as number)) {
    console.warn(
      "[olivia] lead directory incomplete: collected %d of %d leads — those rows fall back to lead_id",
      fetched,
      lastTotal,
    );
  }

  return dir;
}

const LEAD_CORPUS_PAGE_SIZE = 100; // API max per page
const LEAD_CORPUS_MAX_PAGES = 25; // safety cap (~2500 leads); overflow is reported, not hidden

/**
 * Every lead in the window, for in-app search. Upstream /leads has no search parameter
 * (guide §5), so the list is paged in full and filtered locally. `status`/`source` ride
 * along so a filtered search crawls less. `truncated` is true when the crawl did not cover
 * the whole list — callers MUST surface that rather than imply a complete result. It has
 * three causes with very different sizes (page cap hit, `total` missing, fewer rows
 * collected than `total` claimed), so `searched` reports how many rows were ACTUALLY
 * collected: a caller that assumes the cap (2,500) would overstate coverage in the other
 * two cases, which can be a single short page or even zero rows.
 */
export async function getLeadsCorpus(
  clientId: string,
  params: LeadsParams,
  h: Hints = {},
): Promise<{ items: Lead[]; truncated: boolean; searched: number }> {
  const items: Lead[] = [];
  let truncated = false;
  let lastTotal: number | undefined;

  for (let page = 1; page <= LEAD_CORPUS_MAX_PAGES; page++) {
    const res = await getLeads(
      clientId,
      { ...params, page, limit: LEAD_CORPUS_PAGE_SIZE },
      h,
    );
    items.push(...res.items);
    lastTotal = res.total;
    const pageSize = res.limit || LEAD_CORPUS_PAGE_SIZE;
    if (!hasMorePages(items.length, res.total, res.items.length, pageSize)) break;
    if (page === LEAD_CORPUS_MAX_PAGES) {
      truncated = true;
      console.warn(
        "[olivia] lead search corpus truncated at %d leads (total=%d) — search covers newest rows only",
        items.length,
        res.total,
      );
    }
  }

  // `hasMorePages` reading a short last page as "the end" is only valid if the crawl actually
  // reached the true end of the list. Two situations look identical to a short page but are NOT
  // completion: (1) some locked/PII-gated responses omit `total` entirely despite its `number`
  // type, so `fetched < total` silently evaluates to `false` and the crawl stops after page one;
  // and (2) upstream can return a short page mid-list (a hiccup, dedup, or post-pagination
  // filtering) while `total` says more rows exist. Neither may be read as "done" — a missing/
  // non-finite total means the size is simply unknown, and a collected count short of a known
  // total means rows were dropped. Both must mark the corpus truncated so a partial result is
  // never cached and searched as if it were the whole list. Do not simplify this back to
  // "short page = complete".
  if (!Number.isFinite(lastTotal)) {
    truncated = true;
  } else if (items.length < (lastTotal as number)) {
    truncated = true;
  }

  return { items, truncated, searched: items.length };
}

const CALL_CORPUS_PAGE_SIZE = 100; // API max per page
const CALL_CORPUS_MAX_PAGES = 25; // safety cap (~2500 calls); overflow is reported, not hidden
// Pages after the first are fetched in parallel batches. Measured on a real 10,664-call month:
// the sequential crawl took 47s — past a comfortable margin under this route's 60s maxDuration
// — while batches of 6 bring it into single digits. Kept well under the 500 req/min governor
// (lib/olivia/governor.ts), which still serializes anything over the limit.
const CALL_CORPUS_CONCURRENCY = 6;

/**
 * Every call in the window, for in-app search. Same caveats as `getLeadsCorpus`: upstream
 * /calls has no search parameter, and (unlike /conversations) it ignores a `lead_id` filter —
 * see `fetchCallDetail` — so the only way to find a lead's calls is to page the list in full and
 * filter locally. `truncated` is true when the crawl did not cover the whole list, and
 * `searched` reports how many rows were ACTUALLY collected, because the three causes (page cap
 * hit, `total` missing, fewer rows than `total` claimed) have very different sizes and a caller
 * that assumed the cap would overstate coverage.
 *
 * Unlike the leads crawl this pages in PARALLEL, which is safe here only because page 1 reports
 * `total`: the page count is known up front rather than discovered one request at a time. When
 * `total` is missing the parallel phase is skipped entirely and the result is marked truncated,
 * since there is then no safe way to know how many pages to ask for.
 */
export async function getCallsCorpus(
  clientId: string,
  params: DateParams,
  h: Hints = {},
): Promise<{ items: Call[]; truncated: boolean; searched: number }> {
  const page = (p: number) =>
    getCalls(clientId, { ...params, page: p, limit: CALL_CORPUS_PAGE_SIZE }, h);

  const first = await page(1);
  const items: Call[] = [...first.items];
  const total = first.total;
  const pageSize = first.limit || CALL_CORPUS_PAGE_SIZE;
  let truncated = false;

  // `hasMorePages` also encodes "a short first page means we're done", so it still gates the
  // parallel phase — a 40-row page 1 must not spawn 24 pointless requests.
  if (Number.isFinite(total) && hasMorePages(items.length, total, first.items.length, pageSize)) {
    const wanted = Math.ceil(total / pageSize);
    const lastPage = Math.min(wanted, CALL_CORPUS_MAX_PAGES);
    if (wanted > CALL_CORPUS_MAX_PAGES) {
      truncated = true;
      console.warn(
        "[olivia] call search corpus truncated at %d pages (total=%d) — search covers newest rows only",
        CALL_CORPUS_MAX_PAGES,
        total,
      );
    }
    for (let start = 2; start <= lastPage; start += CALL_CORPUS_CONCURRENCY) {
      const batch: number[] = [];
      for (let p = start; p < start + CALL_CORPUS_CONCURRENCY && p <= lastPage; p++) batch.push(p);
      const results = await Promise.all(batch.map(page));
      for (const r of results) items.push(...r.items);
    }
  }

  // Identical reasoning to getLeadsCorpus: a short page is only "the end" if the crawl really
  // reached it. A missing/non-finite `total` means the size is unknown, and a collected count
  // short of a known total means rows were dropped — neither may be cached and searched as if
  // it were the whole list. Do not simplify this back to "short page = complete".
  if (!Number.isFinite(total)) {
    truncated = true;
  } else if (items.length < total) {
    truncated = true;
  }

  return { items, truncated, searched: items.length };
}

/** `lead_id` returns the lead's WHOLE history — the from/to window is not applied when set. */
export type ConversationsParams = DateParams &
  PageParams & { channel?: string; lead_id?: string };

export async function getConversations(
  clientId: string,
  params: ConversationsParams,
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
    last_message: flatText(c.last_message),
  }));
  return { items, total: r.total, page: r.page, limit: r.limit };
}

// ---- Calendar (bookings month view) ----
// `date`/`time` in the response are ALREADY client-timezone local strings — pass through
// untouched. `upcoming` is the next N scheduled/confirmed across any month (default 5, max 25).
export function getCalendar(
  clientId: string,
  params: { month: string; upcoming_limit?: number },
  h: Hints = {},
) {
  return oliviaFetch<CalendarResponse>(`${ANALYTICS}/clients/${cid(clientId)}/calendar`, {
    params: params as QueryParams,
    ...h,
  });
}

// ---- Lead detail (drill-down page) ----
export async function getLeadDetail(
  clientId: string,
  leadId: string,
  h: Hints = {},
): Promise<LeadDetail> {
  const r = await oliviaFetch<LeadDetail>(
    `${ANALYTICS}/clients/${cid(clientId)}/leads/${encodeURIComponent(leadId)}`,
    { ...h },
  );
  // Same {raw}-wrapper hardening as the calls/conversations lists.
  const leadName = fullName(r.lead?.first_name, r.lead?.last_name);
  return {
    ...r,
    lead: {
      ...r.lead,
      notes: flatText(r.lead?.notes),
      lead_context: flatText(r.lead?.lead_context),
    },
    // The embedded sublist is a SLIM call shape — live API sends only {id, direction, status,
    // disposition, started_at, duration_seconds, agent}: no lead_id, recording_url or transcript.
    // Stamp the lead identity so drawers can render a name + working lead link; the full row
    // (recording/transcript) comes from fetchCallDetail on demand.
    calls: (r.calls ?? []).map((c) => ({
      ...c,
      lead_id: c.lead_id ?? leadId,
      lead: c.lead ?? leadName,
      transcript: flatText(c.transcript),
      callback_notes: flatText(c.callback_notes),
    })),
    bookings: r.bookings ?? [],
    // Every message-bearing channel (sms, chat/DM, email, imessage); voice is excluded
    // upstream. Newest activity first so the page can preview the live thread without
    // depending on upstream ordering.
    conversations: (r.conversations ?? [])
      .map((c) => ({ ...c, last_message: flatText((c as { last_message?: unknown }).last_message) }))
      .sort((a, b) => byRecencyDesc(a.last_message_at, b.last_message_at)),
  };
}

/** Requires the `dashboard:notes` scope — a 403 means notes are read-only for this key.
 *  ≤20 000 chars; empty string clears. Last-write-wins: replace local state with the response. */
export function putLeadNotes(
  clientId: string,
  leadId: string,
  notes: string,
  h: Hints = {},
) {
  return oliviaFetch<{ notes: string; updated_at: string }>(
    `${ANALYTICS}/clients/${cid(clientId)}/leads/${encodeURIComponent(leadId)}/notes`,
    { method: "PUT", body: { notes }, maxRetries: 0, ...h },
  );
}

export interface DoNotContactResult {
  do_not_contact: boolean;
  updated_at: string;
  /** Workflow runs killed by this write. 0 when the value was already set (idempotent). */
  cancelled_runs: number;
}

/**
 * Suppress (or un-suppress) every outbound channel for a lead. Scope `dashboard:notes` on top
 * of `dashboard:read` — a 403 `forbidden_scope` means the key can't write. The body must be
 * EXACTLY `{ do_not_contact: <boolean> }`; anything else is rejected 400 `invalid_request`.
 *
 * Idempotent, so unlike putLeadNotes this keeps the client's 429 retry. That's safe for
 * `cancelled_runs` specifically because a 429 is a *rejection* — the write never executed, so
 * the retry that lands is the one that does the cancelling and reports the true count. (A
 * response lost in flight after execution would under-report, but that surfaces as a failure,
 * not a wrong number.)
 *
 * Turning the flag back off does NOT restart the runs this cancelled — the cancellation is
 * one-way.
 */
export function putLeadDoNotContact(
  clientId: string,
  leadId: string,
  doNotContact: boolean,
  h: Hints = {},
) {
  return oliviaFetch<DoNotContactResult>(
    `${ANALYTICS}/clients/${cid(clientId)}/leads/${encodeURIComponent(leadId)}/do-not-contact`,
    { method: "PUT", body: { do_not_contact: doNotContact }, ...h },
  );
}

// ---- DM threads (conversations tab) ----
export async function getDmThreads(
  clientId: string,
  params: PageParams & { lead_id?: string },
  h: Hints = {},
): Promise<ListResponse<DmThread>> {
  const r = await oliviaFetch<{
    threads?: Array<Record<string, unknown>>;
    dm_threads?: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
  }>(`${ANALYTICS}/clients/${cid(clientId)}/dm-threads`, {
    params: params as QueryParams,
    ...h,
  });
  const rows = r.threads ?? r.dm_threads ?? [];
  const items: DmThread[] = rows.map((t) => ({
    ...(t as unknown as DmThread),
    last_message: flatText(t.last_message),
  }));
  return { items, total: r.total, page: r.page, limit: r.limit };
}

/**
 * Full thread for ANY channel including SMS — `/dm-threads` is the DM-only surface, this is not.
 * Messages come back oldest-first (latest N; default 100, max 500). `before` is an ISO-8601
 * cursor: pass the oldest timestamp you hold to page backwards (unparseable → 400
 * invalid_request). When the key lacks dashboard:pii, `messages` is `[]` with `locked: true`
 * and `total`/`has_more` are OMITTED — absent means unknown, not zero, so they stay undefined
 * here rather than being defaulted.
 */
export async function getConversationThread(
  clientId: string,
  conversationId: string,
  params: { limit?: number; before?: string } = {},
  h: Hints = {},
): Promise<ConversationThread> {
  const r = await oliviaFetch<ConversationThread & { messages?: Array<Record<string, unknown>> }>(
    `${ANALYTICS}/clients/${cid(clientId)}/conversations/${encodeURIComponent(conversationId)}`,
    { params: params as QueryParams, ...h },
  );
  const messages = (r.messages ?? []).map((m) => ({
    ...(m as unknown as ThreadMessage),
    text: flatText(m.text) ?? "",
    // `from` is the shipped field; derive it from `direction` if a future revision drops it.
    from:
      (m.from as "agent" | "lead" | undefined) ??
      (m.direction === "inbound" ? "lead" : "agent"),
  }));
  return { ...r, messages };
}

// ---- Agency clients cost (console) ----
// {agencyId} must be the key's own agency (else 404 agency_not_found). Money is integer cents;
// maintenance is flat monthly ($0 for paused/archived, NOT prorated). Use the server `totals`
// verbatim — never re-sum client-side.
export interface AgencyClientCostRecord {
  id: string;
  name: string;
  status: string;
  timezone?: string | null;
  spend_cents: number;
  maintenance_cents: number;
  total_cost_cents: number;
}

export interface AgencyClientCostsResponse {
  agency_id: string;
  range?: string;
  clients: AgencyClientCostRecord[];
  totals: { spend_cents: number; maintenance_cents: number; total_cost_cents: number };
}

export function getAgencyClientCosts(
  agencyId: string,
  params: { range?: string; from?: string; to?: string; tz?: string; client_id?: string },
  h: Hints = {},
) {
  return oliviaFetch<AgencyClientCostsResponse>(
    `${ANALYTICS}/agencies/${encodeURIComponent(agencyId)}/clients`,
    { params: params as QueryParams, ...h },
  );
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
