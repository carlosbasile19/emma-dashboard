import { Resend } from "resend";

const FROM = "Hey Emma <no-reply@heyemma.io>";

export interface SendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Send one email via Resend. Never throws — returns an error string instead, so callers can
 * fail soft. Reads RESEND_API_KEY and EMAIL_REPLY_TO from the environment at call time.
 */
export async function sendEmail(
  input: SendInput,
): Promise<{ id: string | null; error: string | null }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { id: null, error: "RESEND_API_KEY is not set" };
  const replyTo = process.env.EMAIL_REPLY_TO ?? "carlos@imperoagency.com";
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: input.to,
      replyTo,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (error) return { id: null, error: error.message };
    return { id: data?.id ?? null, error: null };
  } catch (e) {
    return { id: null, error: e instanceof Error ? e.message : "Unknown send error" };
  }
}
