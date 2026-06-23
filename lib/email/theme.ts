// Brand tokens for transactional emails. Email-safe: hex colors, web-safe font stacks,
// and an image-free gradient header (solid-violet fallback for Outlook).
export const APP_NAME = "Hey Emma";

export const C = {
  warm: "#F7F5F2",
  ink: "#1A2B2E",
  muted: "#5C6B6D",
  violet: "#6D4AFF",
  pink: "#FF3D77",
  lavender: "#ECEAF7",
  white: "#FFFFFF",
} as const;

export const GRADIENT = "linear-gradient(100deg, #6D4AFF 0%, #FF3D77 100%)";

export const FONT_DISPLAY =
  "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const FONT_MONO =
  "'Space Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";

export const FOOTER_SECURITY = "Secured by Supabase · One workspace, your data only";
export const FOOTER_IGNORE =
  "If you weren't expecting this email, you can safely ignore it — replies reach a real person.";
