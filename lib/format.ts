// Pure presentation helpers shared across views.

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
