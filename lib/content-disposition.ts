/**
 * Extracts the filename from a `Content-Disposition` header value.
 *
 * Pulled out of `components/console/UsageControls.tsx` and unit-tested
 * (`scripts/loading-states-selftest.ts`) because the inline regex it replaced —
 * `/filename="?([^"]+)"?/` — over-captures on an unquoted header with a trailing parameter:
 * `attachment; filename=a.csv; size=1` produced `a.csv; size=1` instead of `a.csv`. That bug was
 * invisible from the client file, because `app/console/usage/export/route.ts` always emits a
 * quoted filename — a coupling nothing enforced and nothing here should rely on again.
 */
export function parseContentDispositionFilename(
  header: string | null | undefined,
  fallback = "usage.csv",
): string {
  if (!header) return fallback;

  // RFC 5987 extended notation — `filename*=charset'lang'value`, language tag optional but the
  // two single quotes are always present — takes priority when present. It's the form that can
  // carry non-ASCII names and is percent-encoded, so decode it. Servers that send it typically
  // also send a plain `filename` fallback for older clients; preferring the extended form when
  // both are present matches RFC 6266's own guidance.
  const extended = header.match(/filename\*\s*=\s*[^']*'[^']*'([^;]+)/i);
  if (extended) {
    try {
      const decoded = decodeURIComponent((extended[1] ?? "").trim());
      if (decoded) return decoded;
    } catch {
      // Malformed percent-encoding — fall through to the plain forms below.
    }
  }

  // Quoted form: filename="a.csv". The closing quote bounds the match, so a trailing
  // `; size=1`-style parameter is correctly excluded.
  const quoted = header.match(/filename="([^"]*)"/i);
  if (quoted) return quoted[1] || fallback;

  // Unquoted form: filename=a.csv[; more]. Stop at the next `;` (or end of string) instead of
  // capturing greedily — that greediness is exactly what let a trailing parameter leak into the
  // downloaded filename.
  const unquoted = header.match(/filename=([^;]+)/i);
  if (unquoted) {
    const value = (unquoted[1] ?? "").trim();
    if (value) return value;
  }

  return fallback;
}
