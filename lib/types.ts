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
export interface Conversation {
  id: string;
  lead_id: string;
  channel: ConversationChannel;
  platform?: string | null;
  started_at: string;
  ended_at?: string | null;
  sentiment_score?: number | null;
  opted_out_at?: string | null;
  created_at: string;
  // PII
  summary?: string | null;
  // Display helpers
  lead?: string | null;
  agent?: string | null;
  status?: CallStatus | null;
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
