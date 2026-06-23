import {
  C,
  FONT_DISPLAY,
  FONT_MONO,
  GRADIENT,
  FOOTER_SECURITY,
  FOOTER_IGNORE,
} from "./theme";

export interface ShellInput {
  preheader: string;
  eyebrow: string;
  heading: string;
  bodyParagraphs: string[];
  cta: { label: string; url: string };
  notes?: string[];
}

/** Escape for HTML text + double-quoted attributes (also turns & into &amp; in URLs). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderShell(input: ShellInput): { html: string; text: string } {
  const href = escapeHtml(input.cta.url);

  const paras = input.bodyParagraphs
    .map(
      (p) =>
        `<p style="margin:16px 0 0 0;font-family:${FONT_DISPLAY};font-size:15px;line-height:1.6;color:${C.muted};">${escapeHtml(p)}</p>`,
    )
    .join("");

  const notes = (input.notes ?? [])
    .map(
      (n) =>
        `<p style="margin:14px 0 0 0;font-family:${FONT_DISPLAY};font-size:13px;line-height:1.55;color:${C.muted};">${escapeHtml(n)}</p>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${C.warm};">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeHtml(input.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.warm};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="500" cellpadding="0" cellspacing="0" style="width:500px;max-width:500px;background:${C.white};border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(26,43,46,0.08);">
<tr><td bgcolor="${C.violet}" align="center" style="background-color:${C.violet};background-image:${GRADIENT};padding:26px 24px;">
<span style="font-family:${FONT_DISPLAY};font-size:20px;font-weight:500;letter-spacing:-0.01em;color:${C.white};"><span style="opacity:0.82;">Hey</span> <strong style="font-weight:700;">Emma</strong></span>
</td></tr>
<tr><td style="padding:34px 36px 0 36px;">
<div style="font-family:${FONT_MONO};font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:${C.muted};">${escapeHtml(input.eyebrow)}</div>
<h1 style="margin:12px 0 0 0;font-family:${FONT_DISPLAY};font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:${C.ink};">${escapeHtml(input.heading)}</h1>
${paras}
</td></tr>
<tr><td style="padding:26px 36px 0 36px;">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:46px;v-text-anchor:middle;width:260px;" arcsize="26%" strokecolor="${C.violet}" fillcolor="${C.violet}">
<w:anchorlock/>
<center style="color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:bold;">${escapeHtml(input.cta.label)}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-- -->
<a href="${href}" style="display:inline-block;background:${C.violet};color:${C.white};font-family:${FONT_DISPLAY};font-size:15px;font-weight:600;text-decoration:none;padding:13px 28px;border-radius:12px;">${escapeHtml(input.cta.label)}</a>
<!--<![endif]-->
</td></tr>
<tr><td style="padding:4px 36px 0 36px;">${notes}</td></tr>
<tr><td style="padding:26px 36px 30px 36px;">
<div style="height:1px;line-height:1px;font-size:1px;background:${C.lavender};">&nbsp;</div>
<p style="margin:18px 0 0 0;font-family:${FONT_DISPLAY};font-size:12.5px;line-height:1.6;color:${C.muted};">${escapeHtml(FOOTER_SECURITY)}<br>${escapeHtml(FOOTER_IGNORE)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    input.heading,
    "",
    ...input.bodyParagraphs,
    "",
    `${input.cta.label}: ${input.cta.url}`,
    ...(input.notes && input.notes.length ? ["", ...input.notes] : []),
    "",
    "—",
    FOOTER_SECURITY,
    FOOTER_IGNORE,
  ].join("\n");

  return { html, text };
}
