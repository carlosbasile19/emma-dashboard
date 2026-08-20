// Pure presentation helpers shared across views.

import type { Call, CallDisposition } from "@/lib/types";

const LABEL_OVERRIDES: Record<string, string> = {
  dnc: "DNC",
  no_answer: "No answer",
  in_progress: "In progress",
  no_disposition: "No disposition",
  not_interested: "Not interested",
  callback_requested: "Callback",
  wrong_number: "Wrong number",
  voicemail_left: "Voicemail",
  no_show: "No show",
  sms_unknown: "SMS (unknown)",
  csv_import: "CSV import",
  crm_sync: "CRM sync",
  reactivation_campaign: "Reactivation",
  direct_booking: "Direct booking",
  cliniko_sync: "Cliniko sync",
  hubspot_sync: "HubSpot sync",
};

/** Human-friendly label for an enum value (e.g. "no_answer" -> "No answer"). */
export function fmtEnum(value: string): string {
  if (LABEL_OVERRIDES[value]) return LABEL_OVERRIDES[value];
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

// ---- Disposition display ----
/**
 * Upper bound (exclusive) on a call that can only have been an answering machine.
 *
 * Chosen from the live corpus rather than by feel: of ~460 calls upstream itself dispositioned
 * `voicemail_left`, 99% ran under 8s and the count falls off a cliff there, while every
 * `not_interested` transcript at 10s+ is a real two-way exchange ("Hello? Hello?" / "From where,
 * sorry?"). Below 8s the transcripts are machine greetings — "This is Tanya's phone, please leave
 * a message" — that the upstream classifier reads as a refusal.
 */
export const MACHINE_CALL_MAX_SECONDS = 8;

/**
 * The disposition to SHOW for a call. Upstream marks a call `not_interested` whenever the lead
 * side declines, which sweeps in answering-machine greetings and makes a wall of voicemails read
 * as a wall of rejections. Too short to have held a conversation → show it as the voicemail it
 * was. Every other disposition passes through untouched.
 *
 * Display-only: this never changes what upstream stored, and aggregate endpoints (/outcomes
 * `call_dispositions`) still count these rows as `not_interested` — they ship no per-call
 * durations, so there is nothing to reclassify against.
 */
export function displayDisposition(
  call: Pick<Call, "disposition" | "duration_seconds">,
): CallDisposition {
  return isInferredVoicemail(call) ? "voicemail_left" : call.disposition;
}

/**
 * True when `displayDisposition` overrode upstream — used to caption the badge as inferred.
 *
 * A missing `duration_seconds` means UNKNOWN, never zero: the slim call shape embedded in
 * /leads/{id} can drop fields, and defaulting to 0 would relabel every one of those rows.
 */
export function isInferredVoicemail(
  call: Pick<Call, "disposition" | "duration_seconds">,
): boolean {
  return (
    call.disposition === "not_interested" &&
    typeof call.duration_seconds === "number" &&
    call.duration_seconds < MACHINE_CALL_MAX_SECONDS
  );
}

/** Hover caption for a reclassified badge, so the inference is never passed off as upstream truth. */
export const INFERRED_VOICEMAIL_HINT =
  `Shown as Voicemail: the call ran under ${MACHINE_CALL_MAX_SECONDS}s, too short to be a ` +
  `conversation. Emma logged it as “Not interested” because the answering machine picked up.`;

/** Integer with thousands separators. */
export function num(n: number): string {
  return n.toLocaleString("en-US");
}

/** A 0..1 rate as a percentage string, e.g. 0.473 -> "47.3%". */
export function pct(rate: number, digits = 1): string {
  return `${(rate * 100).toFixed(digits)}%`;
}

/** Seconds -> "m:ss", e.g. 161 -> "2:41". */
export function secToMMSS(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Cents -> "$1,234" (whole dollars) per spend.total_cents. */
export function centsToMoney(cents: number, currency = "usd"): string {
  const symbol = currency.toLowerCase() === "usd" ? "$" : "";
  return `${symbol}${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/** ISO timestamp -> compact relative time, e.g. "2h ago", "3d ago". */
export function relTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * ISO timestamp -> exact local date/time, e.g. "Aug 14, 3:42 PM". The year appears only when it
 * isn't the current one, so call-log cells stay compact. Renders in the viewer's timezone —
 * callers are client components (pair with suppressHydrationWarning where server-rendered).
 */
export function fmtDateTime(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Full name from PII parts, or null when redacted. */
export function fullName(
  first?: string | null,
  last?: string | null,
): string | null {
  const name = [first, last].filter(Boolean).join(" ").trim();
  return name.length ? name : null;
}

/** Compact reference form of a record id (first UUID group), e.g. "bd61032d". */
export function shortId(id: string): string {
  return id ? (id.split("-")[0] ?? id) : id;
}

/** Initials for an avatar from a display name. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

// ---- Transcript parsing ----
export type TranscriptSpeaker = "agent" | "lead";
export interface TranscriptTurn {
  speaker: TranscriptSpeaker;
  text: string;
}

const AGENT_SPEAKER = /^(agent|assistant|ai|bot|emma)$/i;
const LEAD_SPEAKER = /^(user|customer|caller|human|lead|client|prospect|contact)$/i;

/**
 * Split a "Speaker: line" transcript into attributed turns. Olivia returns one turn per line
 * prefixed with `Agent:` / `User:`. Lines without a recognized speaker prefix fold into the
 * previous turn (continuations); a colon inside dialogue won't trigger a false split because
 * only known speaker labels start a new turn.
 */
export function parseTranscript(raw: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z][\w .'-]{0,18}?):\s*(.*)$/);
    const label = m?.[1]?.trim() ?? "";
    const isAgent = AGENT_SPEAKER.test(label);
    const isLead = LEAD_SPEAKER.test(label);
    if (m && (isAgent || isLead)) {
      turns.push({ speaker: isAgent ? "agent" : "lead", text: (m[2] ?? "").trim() });
    } else {
      const last = turns[turns.length - 1];
      if (last) last.text = last.text ? `${last.text} ${line}` : line;
      else turns.push({ speaker: "lead", text: line });
    }
  }
  return turns.filter((t) => t.text);
}

/**
 * Render a call's transcript as plain text for copy/paste: one `Name: line` per turn, agent turns
 * labelled with the agent name (default "Emma") and lead turns with the lead name (default "Lead").
 * Returns "" when there is no transcript. Reuses parseTranscript so the splitting stays in one place.
 */
export function formatTranscript(
  call: Pick<Call, "transcript" | "agent" | "lead">,
): string {
  if (!call.transcript) return "";
  const agentName = call.agent ?? "Emma";
  const leadName = call.lead ?? "Lead";
  return parseTranscript(call.transcript)
    .map((t) => `${t.speaker === "agent" ? agentName : leadName}: ${t.text}`)
    .join("\n");
}
