// DM channel display helpers shared by the conversations tab, chat drawer and lead page.
// Channel codes are concrete networks (`fb` = facebook_messenger); unknown/future codes
// degrade to a generic "DM" label rather than breaking the row.

export const DM_CHANNEL_LABELS: Record<string, string> = {
  ig: "Instagram",
  fb: "Messenger",
  wa: "WhatsApp",
  tg: "Telegram",
  tt: "TikTok",
};

/** Accent per network, drawn from the existing badge/chart scale (no new colors). */
export const DM_CHANNEL_COLORS: Record<string, string> = {
  ig: "#B56BE0",
  fb: "#2E86F2",
  wa: "#2BB673",
  tg: "#0FB5AE",
  tt: "#1A2B2E",
};

export function dmChannelLabel(channel: string): string {
  return DM_CHANNEL_LABELS[channel] ?? "DM";
}

export function dmChannelColor(channel: string): string {
  return DM_CHANNEL_COLORS[channel] ?? "#5C6B6D";
}

/** Short badge code, e.g. "IG"; unknown codes render as-is, uppercased and clamped. */
export function dmChannelCode(channel: string): string {
  return (channel || "dm").slice(0, 3).toUpperCase();
}
