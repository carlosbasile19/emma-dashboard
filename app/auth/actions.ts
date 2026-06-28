"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_CLIENT_COOKIE, getSessionContext } from "@/lib/auth";
import {
  type BriefWindow,
  briefWindowLabel,
  briefWindowToPeriod,
  DEFAULT_TZ,
} from "@/lib/filters";
import {
  fetchCampaigns,
  fetchOverview,
  type BriefSession,
  type ReportSession,
  endBriefing as svcEndBriefing,
  endReporting as svcEndReporting,
  startBriefing as svcStartBriefing,
  startReporting as svcStartReporting,
} from "@/lib/olivia/service";
import { buildBriefItems, type BriefItem } from "@/lib/overview";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface SignInState {
  error: string | null;
}

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Passwordless sign-in: email a one-click magic link. shouldCreateUser is false so only
 * provisioned users can sign in — we never auto-create accounts. When the email has no
 * account, GoTrue rejects the request with HTTP 422 / code "otp_disabled" ("Signups not
 * allowed for otp"); we surface that as an explicit "contact your administrator" message
 * rather than the generic send-failure copy.
 */
export async function sendMagicLink(
  email: string,
): Promise<{ error: string | null; code?: "no_account" }> {
  const e = email.trim().toLowerCase();
  if (!e) return { error: "Enter your email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: e,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${await requestOrigin()}/auth/callback`,
    },
  });
  if (error) {
    if (error.code === "otp_disabled") {
      return {
        error:
          "There’s no Hey Emma account for that email yet. Please contact your administrator to request access.",
        code: "no_account",
      };
    }
    return { error: "We couldn’t send that link. Check the email address, then try again." };
  }
  return { error: null };
}

/**
 * Password fallback sign-in (the UI is magic-link first; this is the "use a password instead"
 * path and an emergency route if email delivery is unavailable). Returns an error on failure;
 * on success the session cookie is set and the client navigates to /dashboard.
 */
export async function passwordSignIn(
  email: string,
  password: string,
): Promise<SignInState> {
  const e = email.trim().toLowerCase();
  if (!e || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: e, password });
  if (error) {
    return { error: "That didn’t match. Check your email and password, then try again." };
  }
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Platform-admin only: switch the active client (workspace). Verifies the caller is an admin
 * and that the target client exists in the agency before setting the cookie. Members can never
 * switch — the action returns early and getSessionContext ignores the cookie for them anyway.
 */
export async function setActiveClient(formData: FormData) {
  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) return;

  const ctx = await getSessionContext();
  if (!ctx.isAdmin) return; // non-admins cannot switch workspaces

  const admin = createAdminClient();
  const { data } = await admin
    .from("olivia_clients")
    .select("olivia_client_id")
    .eq("olivia_client_id", clientId)
    .maybeSingle();
  if (!data) return; // unknown client — ignore

  const jar = await cookies();
  jar.set(ACTIVE_CLIENT_COOKIE, clientId, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/dashboard");
}

/**
 * Re-scope the "Brief Emma" list for a date window picked in the modal (This week / 30 / 90 days
 * / Custom). Recomputes the brief from a fresh overview + campaigns for that window only — the
 * dashboard's KPI cards keep their own ?range= and are untouched. The window is resolved
 * server-side from the session's timezone; the browser only chooses the preset/dates.
 */
export async function fetchBriefWindow(
  window: BriefWindow,
): Promise<{ items: BriefItem[]; label: string }> {
  const ctx = await getSessionContext();
  const period = briefWindowToPeriod(window, ctx.activeClientTimezone ?? DEFAULT_TZ);
  const [ov, campaigns] = await Promise.all([
    fetchOverview(period),
    // Campaigns power the brief but shouldn't sink the whole window if they error.
    fetchCampaigns().catch(() => null),
  ]);
  return {
    items: buildBriefItems(ov.data, campaigns?.data ?? []),
    label: briefWindowLabel(window),
  };
}

/**
 * Start a briefing for the session's client over the chosen brief window. Returns a live
 * session (with realtime join creds) when the Olivia briefing bridge is enabled, otherwise a
 * { mode: "simulated" } result so the dashboard runs its local walkthrough.
 */
export async function beginBrief(window: BriefWindow, focus: string): Promise<BriefSession> {
  const ctx = await getSessionContext();
  const period = briefWindowToPeriod(window, ctx.activeClientTimezone ?? DEFAULT_TZ);
  return svcStartBriefing(period, focus);
}

export async function endBrief(briefingId: string): Promise<void> {
  await svcEndBriefing(briefingId);
}

/**
 * Start a read-only reporting walkthrough for the session's client over the chosen window. The
 * clientId is derived server-side from the session (never the browser), so a session can only ever
 * report on the client whose dashboard it was launched from. Returns a live session (Retell join
 * creds + summary) when the reporting bridge is enabled, otherwise { mode: "simulated" } so the
 * dashboard runs its local preview.
 */
export async function beginReport(
  window: BriefWindow,
  agentId?: string,
): Promise<ReportSession> {
  const ctx = await getSessionContext();
  const period = briefWindowToPeriod(window, ctx.activeClientTimezone ?? DEFAULT_TZ);
  return svcStartReporting(period, agentId);
}

export async function endReport(reportingId: string): Promise<void> {
  await svcEndReporting(reportingId);
}
