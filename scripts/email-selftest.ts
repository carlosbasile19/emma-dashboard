import assert from "node:assert/strict";
import { renderShell } from "../lib/email/layout";

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


console.log("email-selftest: all assertions passed");
