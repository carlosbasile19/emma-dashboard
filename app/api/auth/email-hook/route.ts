import { Webhook } from "standardwebhooks";
import { sendEmail } from "@/lib/email/send";
import { buildVerifyUrl, magicLink, type SupabaseEmailData } from "@/lib/email/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HookPayload {
  user: { email: string };
  email_data: SupabaseEmailData;
}

/**
 * Supabase "Send Email" auth hook. GoTrue POSTs the auth-email payload here whenever it would
 * send a magic-link / OTP email; we render the branded template and send it via Resend. With this
 * hook registered, both the login link and the post-accept sign-in link become branded.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET;
  if (!secret) {
    return Response.json(
      { error: { http_code: 500, message: "Email hook not configured" } },
      { status: 500 },
    );
  }

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);

  let body: HookPayload;
  try {
    const wh = new Webhook(secret.replace("v1,whsec_", ""));
    body = wh.verify(payload, headers) as HookPayload;
  } catch {
    return Response.json(
      { error: { http_code: 401, message: "Invalid signature" } },
      { status: 401 },
    );
  }

  const { user, email_data } = body;

  // Only link-bearing auth emails carry a token_hash. Notification-type hooks (not enabled in
  // this app) have none — acknowledge without sending rather than mailing a broken link.
  if (!email_data?.token_hash) return Response.json({}, { status: 200 });

  const { subject, html, text } = magicLink({
    verifyUrl: buildVerifyUrl(email_data),
    code: email_data.token,
  });
  const { error } = await sendEmail({ to: user.email, subject, html, text });
  if (error) {
    return Response.json({ error: { http_code: 502, message: error } }, { status: 502 });
  }
  return Response.json({}, { status: 200 });
}
