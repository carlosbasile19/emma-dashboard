import Link from "next/link";
import { AcceptInvite } from "@/components/invite/AcceptInvite";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("invites")
    .select("olivia_client_id, email, role, status, expires_at")
    .eq("token", token)
    .maybeSingle();

  let clientName = "";
  if (invite) {
    const { data: c } = await admin
      .from("olivia_clients")
      .select("name")
      .eq("olivia_client_id", invite.olivia_client_id)
      .maybeSingle();
    clientName = (c?.name as string | null) ?? (invite.olivia_client_id as string);
  }

  const expired =
    invite && new Date(invite.expires_at as string).getTime() < Date.now();
  const valid = Boolean(invite && invite.status === "pending" && !expired);
  const reason = !invite
    ? "This invitation link isn’t valid."
    : invite.status === "accepted"
      ? "This invitation has already been used."
      : invite.status === "revoked"
        ? "This invitation was revoked."
        : expired
          ? "This invitation has expired."
          : "This invitation isn’t valid.";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-warm px-6">
      <div className="pointer-events-none absolute -right-40 -top-44 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.18),transparent_64%)]" />
      <div className="pointer-events-none absolute -bottom-52 -left-36 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(255,61,119,0.12),transparent_64%)]" />
      <div className="relative w-full max-w-[420px] rounded-[20px] border border-ink/10 bg-white p-8 shadow-[0_12px_32px_rgba(26,43,46,0.12)]">
        {valid && invite ? (
          <AcceptInvite
            token={token}
            clientName={clientName}
            email={invite.email as string}
            isTeam={(invite.role as string | null) === "platform_admin"}
          />
        ) : (
          <div className="text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-lavender-deep bg-lavender text-violet">
              <svg width="26" height="26" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
                <rect x="4" y="9" width="12" height="8" rx="2" />
                <path d="M7 9V6a3 3 0 016 0v3" />
              </svg>
            </div>
            <h1 className="text-[20px] font-bold tracking-[-0.01em]">Invitation unavailable</h1>
            <p className="mt-2 text-[14px] leading-[1.55] text-muted">{reason}</p>
            <Link
              href="/login"
              className="mt-6 inline-block font-display text-[13px] font-medium text-violet hover:underline"
            >
              Go to sign in →
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
