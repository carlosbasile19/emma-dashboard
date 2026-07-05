# Emma Dashboard — API Reference (PDF)

`emma-api-reference.pdf` is the shareable API documentation for the Emma Dashboard:
every upstream endpoint, the six key scopes, Emma's own HTTP endpoints, the server
function layer (`lib/olivia/*`, server actions), enums/metric semantics, and the
environment/security surface.

The source of truth is `emma-api-reference.html`, styled 1:1 with the dashboard
design system (`app/globals.css` tokens, `lib/design.ts` badge colors, Space
Grotesk / Space Mono — the `fonts/` subsets are the app's own `next/font` files).

## Regenerating the PDF

Edit the HTML, then:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="docs/api-reference/emma-api-reference.pdf" \
  "file://$PWD/docs/api-reference/emma-api-reference.html"
```

Content sources: `docs/olivia-external-api.md`, `docs/olivia-briefing-bridge.md`,
`docs/olivia-reporting-bridge.md`, `lib/olivia/*`, `app/api/*`, `lib/auth.ts`.
When those change (new endpoints, scopes, env vars), update the HTML and re-render.
