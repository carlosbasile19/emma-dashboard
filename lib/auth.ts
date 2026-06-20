import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { initials as toInitials } from "@/lib/format";
import type { Workspace, WorkspaceClient } from "@/lib/types";

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

export const PLATFORM_ADMIN_ROLE = "platform_admin";
export const ACTIVE_CLIENT_COOKIE = "emma-active-client";

// cache() dedupes these across all service calls within a single request render.
export const getSessionUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export interface SessionContext {
  userId: string;
  email: string | null;
  role: string;
  isAdmin: boolean;
  /** The client whose data the request is scoped to (members: their only client). */
  activeClientId: string;
  activeClientName: string;
  activeClientTimezone: string | null;
  /** Switchable clients (admins: all agency clients; members: just their own). */
  clients: WorkspaceClient[];
  userName: string;
}

/**
 * Resolves tenant scope for the request.
 *
 * - Members map to exactly ONE client; the active-client cookie is ignored entirely, so a
 *   member can never reach another client's data (isolation preserved).
 * - Platform admins (role = platform_admin) may switch across ALL agency clients. The set of
 *   allowed clients is read with the service role only AFTER the admin role is verified from
 *   the session; the active client is taken from a cookie and validated against that set
 *   (a tampered/foreign id falls back to the home client). The agency key only exposes its
 *   own clients, so even an admin can never reach a foreign agency's data.
 */
export const getSessionContext = cache(async (): Promise<SessionContext> => {
  const user = await getSessionUser();
  if (!user) throw new AuthError(401, "Not authenticated");

  const supabase = await createClient();
  const { data: member, error } = await supabase
    .from("workspace_members")
    .select("olivia_client_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new AuthError(403, "Unable to resolve workspace");
  if (!member) throw new AuthError(403, "No workspace mapping for this user");

  const role = (member.role as string | null) ?? "member";
  const homeClientId = member.olivia_client_id as string;
  const isAdmin = role === PLATFORM_ADMIN_ROLE;
  const userName =
    (user.user_metadata?.full_name as string | undefined) || user.email || "Member";

  let clients: Array<WorkspaceClient & { timezone: string | null }>;
  let activeClientId: string;

  if (isAdmin) {
    // Admin verified from the session → safe to list all agency clients via the service role.
    const admin = createAdminClient();
    const { data: all } = await admin
      .from("olivia_clients")
      .select("olivia_client_id, name, timezone")
      .order("name", { ascending: true });
    clients = (all ?? []).map((c) => ({
      id: c.olivia_client_id as string,
      name: (c.name as string | null) ?? (c.olivia_client_id as string),
      timezone: (c.timezone as string | null) ?? null,
    }));
    const cookieClient = (await cookies()).get(ACTIVE_CLIENT_COOKIE)?.value;
    activeClientId =
      cookieClient && clients.some((c) => c.id === cookieClient)
        ? cookieClient
        : clients.some((c) => c.id === homeClientId)
          ? homeClientId
          : (clients[0]?.id ?? homeClientId);
  } else {
    // Member: locked to their one client; the cookie is never consulted.
    const { data: client } = await supabase
      .from("olivia_clients")
      .select("olivia_client_id, name, timezone")
      .eq("olivia_client_id", homeClientId)
      .maybeSingle();
    clients = [
      {
        id: homeClientId,
        name: (client?.name as string | null) ?? homeClientId,
        timezone: (client?.timezone as string | null) ?? null,
      },
    ];
    activeClientId = homeClientId;
  }

  const active = clients.find((c) => c.id === activeClientId);
  return {
    userId: user.id,
    email: user.email ?? null,
    role,
    isAdmin,
    activeClientId,
    activeClientName: active?.name ?? activeClientId,
    activeClientTimezone: active?.timezone ?? null,
    clients: clients.map(({ id, name }) => ({ id, name })),
    userName,
  };
});

/**
 * The single source of tenant identity for data fetches. Returns the active client_id, which
 * is derived entirely from the session (and, for admins only, a server-validated cookie) —
 * never from anything the browser sends directly to an endpoint.
 */
export const getSessionClientId = cache(async (): Promise<string> => {
  return (await getSessionContext()).activeClientId;
});

/** Workspace shown in the dashboard chrome — derived from the active client. */
export const getWorkspace = cache(async (): Promise<Workspace> => {
  const ctx = await getSessionContext();
  return {
    clientId: ctx.activeClientId,
    name: ctx.activeClientName,
    timezone: ctx.activeClientTimezone,
    user: ctx.userName,
    initials: toInitials(ctx.activeClientName || ctx.userName),
    role: ctx.role,
    isAdmin: ctx.isAdmin,
    clients: ctx.clients,
  };
});
