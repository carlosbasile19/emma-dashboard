// Design constants extracted from the imported "Emma Dashboard" design.
// Data-driven colors (badges, chart segments) are applied as inline styles because
// the value->color mapping is dynamic; static chrome uses Tailwind token utilities.

import type { BadgeKind } from "@/lib/types";

/** Per-enum badge accent colors (design `BADGE` map). */
export const BADGE_COLORS: Record<Exclude<BadgeKind, "source">, Record<string, string>> = {
  lead: {
    new: "#5C6B6D",
    contacted: "#2E86F2",
    qualified: "#6D4AFF",
    booked: "#E8A33D",
    converted: "#2BB673",
    lost: "#E5484D",
    dnc: "#1A2B2E",
  },
  call: {
    queued: "#5C6B6D",
    ringing: "#2E86F2",
    in_progress: "#6D4AFF",
    completed: "#2BB673",
    failed: "#E5484D",
    no_answer: "#E8A33D",
    busy: "#F2724B",
  },
  disp: {
    interested: "#2BB673",
    not_interested: "#E5484D",
    callback_requested: "#2E86F2",
    wrong_number: "#5C6B6D",
    voicemail_left: "#6D4AFF",
    booked: "#0FB5AE",
    dnc: "#1A2B2E",
    no_disposition: "#5C6B6D",
  },
  booking: {
    scheduled: "#2E86F2",
    confirmed: "#6D4AFF",
    completed: "#2BB673",
    cancelled: "#E5484D",
    no_show: "#E8A33D",
  },
  campaign: {
    draft: "#5C6B6D",
    active: "#2BB673",
    paused: "#E8A33D",
    completed: "#6D4AFF",
    archived: "#1A2B2E",
  },
};

/** Lead-stage colors, reused by overview "leads by stage" and the funnel. */
export const STAGE_COLORS: Record<string, string> = BADGE_COLORS.lead;

/** Categorical chart palette (color-blind aware). */
export const CHART_PALETTE = [
  "#6D4AFF",
  "#2E86F2",
  "#0FB5AE",
  "#2BB673",
  "#E8A33D",
  "#F2724B",
  "#B56BE0",
  "#5C6B6D",
] as const;

/** rgba() from a #hex + alpha. */
export function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function badgeColor(kind: BadgeKind, value: string): string {
  if (kind === "source") return "#5C6B6D";
  return BADGE_COLORS[kind]?.[value] ?? "#5C6B6D";
}

// ---- Navigation ----
export type NavKey =
  | "overview"
  | "trends"
  | "funnel"
  | "outcomes"
  | "agents"
  | "campaigns"
  | "leads"
  | "logs"
  | "design";

export interface NavItem {
  key: NavKey;
  label: string;
  href: string;
  group: "Analytics" | "Performance" | "Records" | "Reference";
}

export const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "Overview", href: "/dashboard", group: "Analytics" },
  { key: "trends", label: "Trends", href: "/dashboard/trends", group: "Analytics" },
  { key: "funnel", label: "Funnel", href: "/dashboard/funnel", group: "Analytics" },
  { key: "outcomes", label: "Outcomes", href: "/dashboard/outcomes", group: "Analytics" },
  { key: "agents", label: "Agents", href: "/dashboard/agents", group: "Performance" },
  { key: "campaigns", label: "Campaigns", href: "/dashboard/campaigns", group: "Performance" },
  { key: "leads", label: "Leads", href: "/dashboard/leads", group: "Records" },
  { key: "logs", label: "Calls & Conversations", href: "/dashboard/log", group: "Records" },
  { key: "design", label: "Design System", href: "/dashboard/design", group: "Reference" },
];

export const NAV_GROUPS = ["Analytics", "Performance", "Records", "Reference"] as const;

/** Per-route header titles. */
export const SCREEN_TITLES: Record<NavKey, string> = {
  overview: "Overview",
  trends: "Trends",
  funnel: "Lead funnel",
  outcomes: "Outcomes",
  agents: "Agents",
  campaigns: "Campaigns",
  leads: "Leads",
  logs: "Calls & Conversations",
  design: "Design System",
};
