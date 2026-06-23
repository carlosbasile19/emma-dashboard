"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const INVITE_TTL_DAYS = 7;

/**
 * Platform-admin only: create a single-use invite to a workspace for a specific email.
 * Generates a token; the shareable link is /invite/<token>. (Role is fixed to "member" in
 * Phase 2 — agency-admin invites come with the Phase 3 agency-team model.)
 */
export async function createInvite(formData: FormData) {
  const ctx = await requireAdmin();
  const clientId = String(formData.get("clientId") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!clientId || !email || !email.includes("@")) {
    redirect("/console/invites?error=missing");
  }

  const admin = createAdminClient();
  const { data: client } = await admin
    .from("olivia_clients")
    .select("olivia_client_id")
    .eq("olivia_client_id", clientId)
    .maybeSingle();
  if (!client) redirect("/console/invites?error=client");

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await admin.from("invites").insert({
    token,
    olivia_client_id: clientId,
    email,
    role: "member",
    invited_by: ctx.userId,
    expires_at: expiresAt,
  });

  redirect("/console/invites");
}

/** Platform-admin only: revoke a still-pending invite. */
export async function revokeInvite(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const admin = createAdminClient();
  await admin.from("invites").update({ status: "revoked" }).eq("id", id).eq("status", "pending");
  redirect(String(formData.get("returnTo") ?? "/console/invites"));
}

/**
 * Platform-admin only: invite a teammate to the agency itself. This grants platform_admin on
 * accept (full console + cross-client access), anchored to the inviter's current home client so
 * the user has a workspace_members row. Reuses the invites flow with role=platform_admin.
 */
export async function createTeamInvite(formData: FormData) {
  const ctx = await requireAdmin();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@")) redirect("/console/team?error=missing");

  const admin = createAdminClient();
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await admin.from("invites").insert({
    token,
    olivia_client_id: ctx.activeClientId, // anchor home client; admins switch across all
    email,
    role: "platform_admin",
    invited_by: ctx.userId,
    expires_at: expiresAt,
  });

  redirect("/console/team");
}
