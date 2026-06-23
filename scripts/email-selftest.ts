import assert from "node:assert/strict";
import { renderShell } from "../lib/email/layout";
import {
  workspaceInvite,
  teamInvite,
  magicLink,
  buildVerifyUrl,
} from "../lib/email/templates";

const shell = renderShell({
  preheader: "PRE",
  eyebrow: "EYE",
  heading: "HEAD",
  bodyParagraphs: ["Para one."],
  cta: { label: "GO", url: "https://x.test/go" },
  notes: ["note one"],
});
assert.match(shell.html, /PRE/);
assert.match(shell.html, /EYE/);
assert.match(shell.html, /HEAD/);
assert.match(shell.html, /https:\/\/x\.test\/go/);
assert.match(shell.html, /Secured by Supabase/);
assert.match(shell.html, /note one/);
assert.match(shell.text, /GO: https:\/\/x\.test\/go/);
assert.match(shell.text, /HEAD/);

const xss = renderShell({
  preheader: "p",
  eyebrow: "e",
  heading: "<b>X</b>",
  bodyParagraphs: ["safe"],
  cta: { label: "go", url: "https://x.test/go" },
});
assert.match(xss.html, /&lt;b&gt;X&lt;\/b&gt;/);
assert.doesNotMatch(xss.html, /<b>X<\/b>/);

const w = workspaceInvite({
  inviterName: "Carlos",
  clientName: "SOLVI",
  email: "p@co.com",
  acceptUrl: "https://app.test/invite/tok123",
  expiresInDays: 7,
});
assert.equal(w.subject, "You're invited to SOLVI on Hey Emma");
assert.match(w.html, /SOLVI/);
assert.match(w.html, /Accept your invitation/);
assert.match(w.html, /https:\/\/app\.test\/invite\/tok123/);
assert.match(w.html, /p@co\.com/);

const t = teamInvite({
  inviterName: "Carlos",
  email: "p@co.com",
  acceptUrl: "https://app.test/invite/tokTEAM",
  expiresInDays: 7,
});
assert.equal(t.subject, "You're invited to the Hey Emma agency team");
assert.match(t.html, /agency team/);
assert.match(t.html, /tokTEAM/);

const m = magicLink({
  verifyUrl: "https://app.test/auth/callback?token_hash=abc&type=magiclink",
  code: "305805",
});
assert.equal(m.subject, "Your Hey Emma sign-in link");
assert.match(m.html, /Sign in to Hey Emma/);
assert.match(m.html, /305805/);
// & inside the URL must be HTML-escaped in the href attribute
assert.match(m.html, /token_hash=abc&amp;type=magiclink/);

assert.equal(
  buildVerifyUrl({
    token: "305805",
    token_hash: "HASH",
    redirect_to: "https://app.test/auth/callback",
    email_action_type: "magiclink",
    site_url: "https://app.test",
  }),
  "https://app.test/auth/callback?token_hash=HASH&type=magiclink",
);
assert.equal(
  buildVerifyUrl({
    token: "1",
    token_hash: "H2",
    redirect_to: "",
    email_action_type: "email",
    site_url: "https://app.test",
  }),
  "https://app.test/auth/callback?token_hash=H2&type=email",
);

console.log("email-selftest: all assertions passed");
