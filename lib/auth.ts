import "server-only";
import { createClient } from "@/lib/supabase/server";
import { initials as toInitials } from "@/lib/format";
import type { Workspace } from "@/lib/types";

// Thrown when the request has no valid session (401) or no workspace mapping (403).
export class AuthError extends Error {
  constructor(
    public status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export async function getSessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * The single source of tenant identity. Validates the session server-side, looks up the
 * caller's workspace_members row, and returns their Olivia client_id. The client_id is
 * NEVER taken from anything the browser sends — only from the authenticated session.
 */
export async function getSessionClientId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AuthError(401, "Not authenticated");

  const { data, error } = await supabase
    .from("workspace_members")
    .select("olivia_client_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new AuthError(403, "Unable to resolve workspace");
  if (!data) throw new AuthError(403, "No workspace mapping for this user");
  return data.olivia_client_id as string;
}

/** Workspace shown in the dashboard chrome — derived from the session's client mapping. */
export async function getWorkspace(): Promise<Workspace> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AuthError(401, "Not authenticated");

  const { data: member } = await supabase
    .from("workspace_members")
    .select("olivia_client_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) throw new AuthError(403, "No workspace mapping for this user");

  const clientId = member.olivia_client_id as string;
  const { data: client } = await supabase
    .from("olivia_clients")
    .select("olivia_client_id, name, slug, status, industry, timezone")
    .eq("olivia_client_id", clientId)
    .maybeSingle();

  const userName =
    (user.user_metadata?.full_name as string | undefined) || user.email || "Member";
  const wsName = client?.name || "Workspace";

  return {
    clientId,
    name: wsName,
    slug: client?.slug ?? null,
    status: client?.status ?? null,
    industry: client?.industry ?? null,
    timezone: client?.timezone ?? null,
    user: userName,
    initials: toInitials(client?.name || userName),
    role: (member.role as string | null) ?? "member",
  };
}
