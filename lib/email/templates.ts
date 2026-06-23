import { renderShell } from "./layout";

const MAGIC_HELP =
  "When you accept, we'll email you a one-click magic link to sign in — no password needed.";

export interface WorkspaceInviteArgs {
  inviterName: string;
  clientName: string;
  email: string;
  acceptUrl: string;
  expiresInDays: number;
}

export function workspaceInvite(
  a: WorkspaceInviteArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `${a.inviterName} added you to the ${a.clientName} workspace on Hey Emma.`,
    eyebrow: "Workspace invitation",
    heading: "You've been invited to Hey Emma",
    bodyParagraphs: [
      `${a.inviterName} invited you to the ${a.clientName} workspace on Hey Emma — your read-only view of leads, calls, campaigns and outcomes from Olivia.`,
    ],
    cta: { label: "Accept your invitation", url: a.acceptUrl },
    notes: [`This invite is just for ${a.email} and expires in ${a.expiresInDays} days.`, MAGIC_HELP],
  });
  return { subject: `You're invited to ${a.clientName} on Hey Emma`, html, text };
}

export interface TeamInviteArgs {
  inviterName: string;
  email: string;
  acceptUrl: string;
  expiresInDays: number;
}

export function teamInvite(
  a: TeamInviteArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: `${a.inviterName} invited you to the Hey Emma console as an admin.`,
    eyebrow: "Team invitation",
    heading: "You've been invited to the agency team",
    bodyParagraphs: [
      `${a.inviterName} invited you to join the Hey Emma agency team as an admin — full console access: every client workspace, team management and invites.`,
    ],
    cta: { label: "Join the team", url: a.acceptUrl },
    notes: [`This invite is just for ${a.email} and expires in ${a.expiresInDays} days.`, MAGIC_HELP],
  });
  return { subject: "You're invited to the Hey Emma agency team", html, text };
}

export interface MagicLinkArgs {
  verifyUrl: string;
  code: string;
}

export function magicLink(
  a: MagicLinkArgs,
): { subject: string; html: string; text: string } {
  const { html, text } = renderShell({
    preheader: "Your one-click link to sign in to Hey Emma.",
    eyebrow: "Sign in",
    heading: "Here's your magic link",
    bodyParagraphs: ["Click below to sign in to Hey Emma. This link works once and expires soon."],
    cta: { label: "Sign in to Hey Emma", url: a.verifyUrl },
    notes: [
      `Prefer to type it? Enter this code: ${a.code}`,
      "If you didn't request this, you can safely ignore this email.",
    ],
  });
  return { subject: "Your Hey Emma sign-in link", html, text };
}

export interface SupabaseEmailData {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
}

/**
 * Build the verification link that lands on /auth/callback (which calls verifyOtp with
 * { type, token_hash }). Uses the redirect_to Supabase passes (already our callback URL);
 * falls back to site_url + /auth/callback if redirect_to is empty.
 */
export function buildVerifyUrl(d: SupabaseEmailData): string {
  const base = d.redirect_to && d.redirect_to.length > 0 ? d.redirect_to : `${d.site_url}/auth/callback`;
  const u = new URL(base);
  u.searchParams.set("token_hash", d.token_hash);
  u.searchParams.set("type", d.email_action_type);
  return u.toString();
}
