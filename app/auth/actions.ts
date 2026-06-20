"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_CLIENT_COOKIE, getSessionContext } from "@/lib/auth";
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
 * provisioned users can sign in (and we don't reveal which emails exist).
 */
export async function sendMagicLink(email: string): Promise<{ error: string | null }> {
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
    return { error: "We couldn’t send that link. Check the email address, then try again." };
  }
  return { error: null };
}

export async function signIn(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
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
