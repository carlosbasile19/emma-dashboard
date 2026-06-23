"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getRequestOrigin } from "@/lib/origin";

export interface AcceptState {
  ok?: boolean;
  error?: string;
  email?: string;
}

/**
 * Public (token-gated): accept a workspace invitation. The token is the bearer credential —
 * we validate it's pending + unexpired, then provision the invite's email as a Supabase user
 * (service role), map them into the workspace, mark the invite used, and email a magic link.
 * The invitee can only finish by receiving that link, so they must control the invited email.
 */
export async function acceptInvite(
  _prev: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const token = String(formData.get("token") ?? "");
  if (!token) return { error: "Missing invitation token." };

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("invites")
    .select("id, olivia_client_id, email, role, status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!invite || invite.status !== "pending") {
    return { error: "This invitation is no longer valid." };
  }
  if (new Date(invite.expires_at as string).getTime() < Date.now()) {
    await admin.from("invites").update({ status: "revoked" }).eq("id", invite.id);
    return { error: "This invitation has expired. Ask your administrator for a new one." };
  }

  const email = (invite.email as string).toLowerCase();

  // Create or find the auth user (service role; mirrors the provisioning seed).
  let userId: string | null = null;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    userId = list?.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
  } else {
    userId = created.data.user.id;
  }
  if (!userId) {
    return { error: "We couldn't set up your account. Please contact your administrator." };
  }

  // Map into the workspace (one client per user).
  const { error: mapErr } = await admin
    .from("workspace_members")
    .upsert(
      { user_id: userId, olivia_client_id: invite.olivia_client_id, role: invite.role },
      { onConflict: "user_id" },
    );
  if (mapErr) return { error: "We couldn't add you to the workspace. Contact your administrator." };

  await admin
    .from("invites")
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
      accepted_user_id: userId,
    })
    .eq("id", invite.id);

  // Email a sign-in link (the account now exists, so shouldCreateUser:false succeeds).
  const origin = await getRequestOrigin();
  const supabase = await createClient();
  await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback` },
  });

  return { ok: true, email };
}
