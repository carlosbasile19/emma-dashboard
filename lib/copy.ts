import type { NavKey } from "@/lib/design";
import type { EmptyCopy } from "@/components/ui/states/EmptyState";
import type { ErrorCopy } from "@/components/ui/states/ErrorState";

// Per-view empty/error copy (design `EMPTY` / `ERROR` maps). `logs` covers calls+conversations.
type CopyKey = Exclude<NavKey, "design">;

export const EMPTY_COPY: Record<CopyKey, EmptyCopy> = {
  overview: {
    title: "Nothing to report — yet",
    body: "Emma hasn’t placed a call on this workspace. The moment she does, your numbers land here.",
    cta: "View setup checklist",
  },
  trends: {
    title: "No pipeline to show",
    body: "This client has no active pipeline yet. Once a pipeline and its stages are set up in Olivia, leads appear here on the board.",
  },
  funnel: {
    title: "The funnel is empty",
    body: "No leads have entered a stage yet. Import a list or connect a source and Emma starts the climb.",
    cta: "Connect a source",
  },
  outcomes: {
    title: "No outcomes to break down",
    body: "Once calls complete, every disposition and booking result fans out into these charts.",
    cta: "See campaigns",
  },
  agents: {
    title: "No agents have dialled",
    body: "Your Emma agents are configured but quiet. Activate a campaign to put them to work.",
    cta: "View campaigns",
  },
  campaigns: {
    title: "No campaigns running",
    body: "Spin one up and Emma starts working the list — call, text, DM and email, until every lead replies.",
    cta: "Talk to your strategist",
  },
  leads: {
    title: "No leads match",
    body: "No leads fit these filters. Clear them, or import a fresh list to give Emma something to chase.",
    cta: "Clear filters",
  },
  logs: {
    title: "Quiet on the line",
    body: "No calls or conversations in this window. The log fills the instant Emma starts dialling.",
    cta: "Reset filters",
  },
};

export const ERROR_COPY: Record<CopyKey, ErrorCopy> = {
  overview: {
    title: "We couldn’t load your overview",
    body: "Emma’s fine — this is on us. The data service didn’t answer in time.",
  },
  trends: {
    title: "We couldn’t load the pipeline",
    body: "The pipeline service didn’t respond just now. Your data is safe — give it another go.",
  },
  funnel: {
    title: "Funnel failed to load",
    body: "Something tripped on our end pulling stage data. Retry in a moment.",
  },
  outcomes: {
    title: "Outcomes didn’t load",
    body: "We couldn’t reach the analytics service. No data was lost.",
  },
  agents: {
    title: "Agent stats didn’t load",
    body: "The agents service hiccuped. Refresh to try again.",
  },
  campaigns: {
    title: "Campaigns didn’t load",
    body: "We couldn’t fetch your campaigns just now. Retry shortly.",
  },
  leads: {
    title: "Leads didn’t load",
    body: "The leads service didn’t respond. Your records are untouched — try again.",
  },
  logs: {
    title: "The log didn’t load",
    body: "We couldn’t pull call & conversation history. Give it another go.",
  },
};

export const RANGE_LABELS: Record<string, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};
