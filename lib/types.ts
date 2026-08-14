// Shared view-model + domain types for the Emma dashboard.
// These mirror the Olivia external API shapes (see docs/olivia-external-api.md §6–§7)
// so Phase 6 can map proxy responses into them with minimal transformation.

// ---- Enums (string unions per the guide §7) ----
export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "booked",
  "converted",
  "lost",
  "dnc",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = [
  "csv_import",
  "crm_sync",
  "manual",
  "api",
  "webhook",
  "sms_unknown",
  "direct_booking",
  "reactivation_campaign",
  "cliniko_sync",
  "hubspot_sync",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const CALL_STATUSES = [
  "queued",
  "ringing",
  "in_progress",
  "completed",
  "failed",
  "no_answer",
  "busy",
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const CALL_DISPOSITIONS = [
  "interested",
  "not_interested",
  "callback_requested",
  "wrong_number",
  "voicemail_left",
  "booked",
  "dnc",
  "no_disposition",
] as const;
export type CallDisposition = (typeof CALL_DISPOSITIONS)[number];

export const BOOKING_STATUSES = [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const CAMPAIGN_STATUSES = [
  "draft",
  "active",
  "paused",
  "completed",
  "archived",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CONVERSATION_CHANNELS = [
  "voice",
  "sms",
  "email",
  "chat",
  "imessage",
] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export type CallDirection = "inbound" | "outbound";

export type BadgeKind = "lead" | "call" | "disp" | "booking" | "campaign" | "source";

// ---- Workspace ----
export interface WorkspaceClient {
  id: string;
  name: string;
}

export interface Workspace {
  clientId: string;
  name: string;
  slug?: string | null;
  status?: string | null;
  industry?: string | null;
  timezone?: string | null;
  /** Display name of the signed-in user (from Supabase auth). */
  user?: string | null;
  /** Initials shown in the sidebar avatar. */
  initials?: string | null;
  role?: string | null;
  /** True for platform admins (can switch across all agency clients). */
  isAdmin?: boolean;
  /** Clients selectable in the workspace switcher (admins: all; members: just their own). */
  clients?: WorkspaceClient[];
}

// ---- Period / filters ----
export type RangePreset = "7d" | "30d" | "90d";

export interface Period {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  tz: string;
}

// ---- Overview ----
export interface Spend {
  total_cents: number;
  currency: string;
  basis: string;
}

export type StageCounts = Partial<Record<LeadStatus, number>>;

export interface OverviewKpis {
  leads_total: number;
  calls_total: number;
  pickup_rate: number; // 0..1
  avg_call_duration_sec: number;
  bookings_rate: number; // 0..1
  converted_count: number;
  spend: Spend;
  leads_by_stage: StageCounts;
}

export interface Overview {
  client_id: string;
  period: Period;
  kpis: OverviewKpis;
}

// ---- Timeseries ----
export interface TimeseriesPoint {
  date: string;
  calls: number;
  picked_up: number;
  bookings: number;
  spend_cents: number;
}

export interface Timeseries {
  client_id: string;
  period: Period;
  series: TimeseriesPoint[];
}

// ---- Outcomes ----
export interface Outcomes {
  client_id: string;
  period: Period;
  outcomes: {
    call_outcomes: Partial<Record<CallStatus, number>>;
    call_dispositions: Partial<Record<CallDisposition, number>>;
    booking_outcomes: Partial<Record<BookingStatus, number>>;
  };
  // Extended fields (optional so pre-extension cached payloads stay valid):
  /** One point per day, zero-filled across the window — chart directly. */
  daily_trend?: DailyTrendPoint[];
  /** [7][24] pickup likelihood; row 0 = Sunday; null = no data. */
  best_times?: BestTimesGrid;
  /** [7][24] sample size per cell — fade cells with few calls. */
  best_times_calls?: number[][];
}

// ---- Funnel ----
export interface Funnel {
  client_id: string;
  period: Period;
  funnel: StageCounts;
}

// ---- Agents ----
export interface Agent {
  agent_id: string;
  name: string;
  client_name?: string;
  total_leads: number;
  total_calls: number;
  pickup_rate: number; // 0..1
  overall_booking_rate: number; // 0..1
  call_to_booking_rate: number; // 0..1
  avg_call_duration_sec: number;
  total_conversion: number; // 0..1 (== overall_booking_rate)
}

// ---- Campaigns ----
export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  created_at: string;
  leads_total: number;
  leads_contacted: number;
  replies: number;
  opt_outs: number;
  appointments_booked: number;
  reply_rate: number; // 0..1
  opt_out_rate: number; // 0..1
}

// ---- Leads (PII-gated) ----
export interface Lead {
  id: string;
  status: LeadStatus;
  source: LeadSource;
  tags?: string[];
  industry?: string | null;
  timezone?: string | null;
  created_at: string;
  updated_at: string;
  last_call_at?: string | null;
  last_disposition?: CallDisposition | null;
  total_calls: number;
  stage_entered_at?: string | null;
  stage_id?: string | null;
  pipeline_id?: string | null;
  /**
   * Lead is suppressed: every outbound channel (voice, SMS, DM, reactivation enrolment,
   * workflow steps, warm-up sends) checks this before contacting. Returned on both the list
   * and the detail payload at any PII level. Distinct from `status: "dnc"` — a lead can be
   * suppressed while sitting in any pipeline stage. Optional so cache rows written before the
   * field existed still typecheck; treat `undefined` as false.
   */
  do_not_contact?: boolean;
  // PII (present only when the key carries dashboard:pii) — null-guarded.
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  instagram_handle?: string | null;
  // Optional display helper the design surfaces (assigned agent / latest activity).
  agent?: string | null;
  activity?: string | null;
  context?: string | null;
}

// ---- Calls (PII-gated) ----
export interface Call {
  id: string;
  lead_id: string;
  direction: CallDirection;
  status: CallStatus;
  disposition: CallDisposition;
  started_at: string;
  ended_at?: string | null;
  duration_seconds: number;
  created_at: string;
  // PII
  from_number?: string | null;
  to_number?: string | null;
  recording_url?: string | null;
  transcript?: string | null;
  callback_notes?: string | null;
  // Display helpers
  lead?: string | null;
  agent?: string | null;
}

// ---- Conversations (PII-gated) ----
/** Message delivery state. `read` only ever appears on DM platforms. */
export type MessageStatus = "sent" | "delivered" | "read" | "failed";
export type MessageDirection = "inbound" | "outbound";

export interface Conversation {
  id: string;
  lead_id: string;
  channel: ConversationChannel;
  /** `"sms"` for SMS — only `voice` sends null. Never use null to detect SMS. */
  platform?: string | null;
  started_at: string;
  ended_at?: string | null;
  sentiment_score?: number | null;
  opted_out_at?: string | null;
  created_at: string;
  // Activity counters — un-gated (structural, not PII).
  message_count?: number | null;
  unread?: number | null;
  last_message_at?: string | null;
  last_message_direction?: MessageDirection | null;
  // PII
  summary?: string | null;
  /** Preview text. NOT part of the shipped list contract (only the lead-detail stub
   *  promises it) — read opportunistically, always tolerate absence. */
  last_message?: string | null;
  // Display helpers
  lead?: string | null;
  agent?: string | null;
  status?: CallStatus | null;
}

// ---- Calendar (bookings month view) ----
// `date`/`time` are ALREADY client-timezone local strings ("YYYY-MM-DD" / "HH:mm") —
// never re-convert them through the browser timezone.
export const CALENDAR_EVENT_STATUSES = [
  "tentative", // was "scheduled" upstream — same slot in the color scale
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
] as const;
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];

export interface CalendarEvent {
  id: string;
  /** Omitted when the key lacks dashboard:pii — fall back to a service label. */
  title?: string | null;
  date: string; // YYYY-MM-DD, client-tz local
  time: string; // HH:mm, client-tz local
  duration_min?: number | null;
  lead_id?: string | null;
  status: CalendarEventStatus;
  locked?: boolean;
}

export interface CalendarResponse {
  client_id: string;
  month: string; // YYYY-MM echoed back
  events: CalendarEvent[];
  /** Next N scheduled/confirmed across ANY month (independent of `month`). */
  upcoming: CalendarEvent[];
  locked?: boolean;
}

// ---- Outcomes extensions (daily trend + best times) ----
export interface DailyTrendPoint {
  date: string;
  bookings: number;
  calls: number;
  picked_up: number;
}

/** [7][24] pickup likelihood 0–1; row 0 = SUNDAY; null = no data (never render as 0%). */
export type BestTimesGrid = Array<Array<number | null>>;

// ---- Lead detail (drill-down page) ----
export interface LeadSummary {
  total_spend_cents: number;
  currency: string;
  basis: string; // "billed"
  /** EXACT totals — the calls/bookings sublists cap at 50; always show these numbers. */
  calls: number;
  bookings: number;
  days_in_pipeline: number;
}

export interface LeadBooking {
  id: string;
  scheduled_at: string;
  status: BookingStatus;
  service?: string | null;
}

/**
 * Conversation stub on the lead page — links into the conversations view. Covers every
 * message-bearing channel (sms, chat/DM, email, imessage); `voice` is excluded upstream
 * because voice conversations carry no message rows (transcripts live on `calls[].transcript`).
 * A lead may hold MORE THAN ONE stub per channel — threads split when one is closed or a
 * campaign-scoped send opens its own. Never assume a single thread per lead.
 */
export interface ConversationStub {
  id: string;
  channel: string;
  platform?: string | null;
  status?: "active" | "ended" | null;
  /** Un-gated counters — present without `dashboard:pii`. */
  message_count?: number | null;
  unread?: number | null;
  last_message_at?: string | null;
  last_message_direction?: MessageDirection | null;
  /** PII-gated preview, 160 chars. */
  last_message?: string | null;
  opted_out_at?: string | null;
}

export interface LeadDetailPipeline {
  id: string;
  name: string;
  /** Current stage id — may be null (lead sits in an archived stage: highlight nothing). */
  stage: string | null;
  stages: Array<
    Pick<PipelineStage, "id" | "name" | "color" | "stage_type" | "order_index">
  >;
}

export interface LeadDetail {
  lead: Lead & {
    notes?: string | null; // always readable
    lead_context?: string | null; // PII-gated
    locked?: boolean;
  };
  /** Assigned rep display info (live API extra beyond the written contract). */
  sales_rep?: { id?: string; name?: string | null } | null;
  /** null → render the fixed status bar new→contacted→…→dnc from lead.status. */
  pipeline: LeadDetailPipeline | null;
  summary: LeadSummary;
  calls: Call[]; // newest-first, max 50
  bookings: LeadBooking[]; // newest-first, max 50; split upcoming/past client-side
  conversations: ConversationStub[];
}

// ---- DM threads (conversations tab) ----
/** Concrete networks; `fb` = facebook_messenger. Unknown codes render a generic DM icon. */
export const DM_CHANNELS = ["ig", "fb", "wa", "tg", "tt"] as const;
export type DmChannel = (typeof DM_CHANNELS)[number];

export interface DmThread {
  id: string;
  lead_id: string;
  lead_name?: string | null; // PII-gated
  channel: string; // DmChannel or an unknown future code
  platform?: string | null;
  status: "active" | "ended";
  bot_active?: boolean;
  last_message?: string | null; // PII-gated preview
  last_message_at?: string | null;
  /** Lead messages awaiting a reply (derived upstream — there is no mark-as-read). */
  unread: number;
  locked?: boolean;
}

export interface ThreadMessage {
  /** Stable id — absent on older rows, so never key a list on it alone. */
  id?: string | null;
  from: "agent" | "lead";
  direction?: MessageDirection | null;
  text: string;
  /** null for channels that report no delivery state. Failed sends ARE returned. */
  status?: MessageStatus | null;
  timestamp: string;
}

export interface ConversationThread {
  id: string;
  lead_id: string;
  channel: string;
  platform?: string | null;
  /** Display label for the agent bubble header — an internal routing name; run it
   *  through `agentLabel()` before showing it. */
  agent?: string | null;
  locked?: boolean;
  /**
   * Messages matching the CURRENT request — with `before` this is the remaining-older
   * count, not the thread size. Drive paging off `has_more`, not arithmetic on `total`.
   * Both are OMITTED when `locked` (thread size is unknown, which is not zero).
   */
  total?: number | null;
  has_more?: boolean | null;
  /** Oldest-first (latest N; default 100, max 500). Empty + locked when PII-gated. */
  messages: ThreadMessage[];
}

/**
 * Unified conversations-tab row. The list merges two upstream surfaces — `/dm-threads`
 * (DM networks; carries lead_name + preview text) and `/conversations` (every channel,
 * carries the activity counters) — into one shape sorted by last activity.
 */
export interface ThreadRow {
  id: string;
  lead_id: string;
  lead_name?: string | null;
  channel: string;
  platform?: string | null;
  status: "active" | "ended";
  bot_active?: boolean;
  last_message?: string | null;
  last_message_at?: string | null;
  last_message_direction?: MessageDirection | null;
  message_count?: number | null;
  unread: number;
  opted_out_at?: string | null;
  locked?: boolean;
}

// ---- List envelope (per the guide §5) ----
export interface ListResponse<T> {
  total: number;
  page: number;
  limit: number;
  items: T[];
}

// ---- Freshness signal attached to every proxied response (Phase 5) ----
export interface Freshness {
  /** ms epoch the underlying upstream value was fetched. */
  fetchedAt: number;
  /** true when served from cache past its fresh window (stale-while-revalidate / stale-on-error). */
  stale: boolean;
}

export interface WithFreshness<T> {
  data: T;
  freshness: Freshness;
}

// ---- Pipelines (board mirror) ----
export const STAGE_TYPES = ["open", "won", "lost"] as const;
export type StageType = (typeof STAGE_TYPES)[number];

export interface PipelineStage {
  id: string;
  name: string;
  color: string; // #RRGGBB — validate before use; the API value may be missing/invalid
  stage_type: StageType;
  order_index: number;
  archived_at: string | null; // non-null = archived column still holding leads
  lead_count: number; // LIVE count — authoritative badge source
}

export interface Pipeline {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  is_default: boolean; // agency-level default
  is_client_default: boolean; // == default_pipeline_id; show first
  order_index: number;
  archived_at: string | null;
  lead_count: number; // pipeline total
  stages: PipelineStage[];
}

export interface PipelinesResponse {
  client_id: string;
  default_pipeline_id: string | null;
  pipelines: Pipeline[];
}
