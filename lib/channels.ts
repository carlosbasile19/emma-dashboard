// Channel display helpers shared by the conversations tab, chat drawer and lead page.
//
// Two different vocabularies arrive on `channel` and both land here:
//   • /dm-threads  → network codes: `ig`, `fb` (= facebook_messenger), `wa`, `tg`, `tt`
//   • /conversations, lead-detail `conversations[]` → the API channel enum: `sms`, `email`,
//     `chat`, `imessage` (`voice` never appears — voice carries no message rows)
// Unknown/future codes degrade to a generic "Message" label rather than breaking the row.
//
// NOTE: do NOT identify SMS by `platform === null` — SMS sends `platform: "sms"`, and only
// voice sends null. Branch on `channel` alone.

export const CHANNEL_LABELS: Record<string, string> = {
  sms: "SMS",
  imessage: "iMessage",
  email: "Email",
  chat: "Web chat",
  ig: "Instagram",
  fb: "Messenger",
  wa: "WhatsApp",
  tg: "Telegram",
  tt: "TikTok",
};

/** Accent per channel, drawn from the existing badge/chart scale (no new colors). */
export const CHANNEL_COLORS: Record<string, string> = {
  sms: "#6D4AFF",
  imessage: "#F2724B",
  email: "#E8A33D",
  chat: "#5C6B6D",
  ig: "#B56BE0",
  fb: "#2E86F2",
  wa: "#2BB673",
  tg: "#0FB5AE",
  tt: "#1A2B2E",
};

/** Short badge code. Explicit per channel — slicing would render "email" as "EMA". */
const CHANNEL_CODES: Record<string, string> = {
  sms: "SMS",
  imessage: "IMSG",
  email: "MAIL",
  chat: "CHAT",
  ig: "IG",
  fb: "FB",
  wa: "WA",
  tg: "TG",
  tt: "TT",
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? "Message";
}

export function channelColor(channel: string): string {
  return CHANNEL_COLORS[channel] ?? "#5C6B6D";
}

export function channelCode(channel: string): string {
  return CHANNEL_CODES[channel] ?? (channel || "msg").slice(0, 4).toUpperCase();
}

/**
 * Upstream agent names are internal routing identifiers — e.g.
 * "007. Emma Re-activation Nurse/Midwife (SMS)". Strip the leading sequence number and the
 * trailing channel suffix so the chat header reads as a person, not a config row. Anything
 * unrecognizable falls back to "Emma" (the only agent name this dashboard ever shows).
 */
export function agentLabel(agent?: string | null): string {
  if (!agent) return "Emma";
  const cleaned = agent
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/\s*\((?:sms|email|chat|voice|imessage|dm)\)\s*$/i, "")
    .trim();
  return cleaned || "Emma";
}
