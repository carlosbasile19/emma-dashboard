import { sendEmail } from "../lib/email/send";
import { magicLink, teamInvite, workspaceInvite } from "../lib/email/templates";

const TO = process.env.TEST_EMAIL_TO ?? "carlos@imperoagency.com";
const ORIGIN = process.env.TEST_ORIGIN ?? "https://emma-dashboard-blue.vercel.app";

async function main(): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.error("Set RESEND_API_KEY before running (RESEND_API_KEY=... npm run email:test-send).");
    process.exit(1);
  }

  const samples = [
    workspaceInvite({
      inviterName: "Carlos",
      clientName: "SOLVI Dental",
      email: TO,
      acceptUrl: `${ORIGIN}/invite/sample-token-workspace`,
      expiresInDays: 7,
    }),
    teamInvite({
      inviterName: "Carlos",
      email: TO,
      acceptUrl: `${ORIGIN}/invite/sample-token-team`,
      expiresInDays: 7,
    }),
    magicLink({
      verifyUrl: `${ORIGIN}/auth/callback?token_hash=sample-demo-hash&type=magiclink`,
      code: "305805",
    }),
  ];

  for (const s of samples) {
    const { id, error } = await sendEmail({ to: TO, subject: s.subject, html: s.html, text: s.text });
    console.log(error ? `FAILED  ${s.subject}: ${error}` : `sent ${id}  ${s.subject}`);
  }
}

main();
