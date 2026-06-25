// SSRF guard for the recording-download proxy. The recording audio is fetched server-side
// (it is cross-origin with no CORS headers), so the route must only ever fetch a known recording
// host — never an arbitrary client-supplied URL. The allowlist is env-configured
// (RECORDING_HOST_ALLOWLIST = comma-separated hostnames) with a built-in default.
//
// The default host is Retell's recording CDN (the voice backend runs on Retell). Confirm the real
// host from a production `recording_url` and set RECORDING_HOST_ALLOWLIST accordingly — the route
// logs the rejected host on a 400, so a wrong/missing default is easy to spot and fix without code.
const DEFAULT_RECORDING_HOSTS = ["dxc03zgurdly9.cloudfront.net"];

export function allowedRecordingHosts(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const raw = env.RECORDING_HOST_ALLOWLIST?.trim();
  if (!raw) return DEFAULT_RECORDING_HOSTS;
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export type RecordingSrcCheck = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * Validate a client-supplied recording URL before the proxy fetches it. Requires https and a host
 * on the allowlist. On rejection the reason includes the offending host so it can be logged.
 */
export function validateRecordingSrc(
  src: string | null | undefined,
  allowedHosts: string[],
): RecordingSrcCheck {
  if (!src) return { ok: false, reason: "missing src" };
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return { ok: false, reason: "unparseable src" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: `non-https src: ${url.protocol}` };
  }
  if (!allowedHosts.includes(url.host.toLowerCase())) {
    return { ok: false, reason: `host not allowed: ${url.host}` };
  }
  return { ok: true, url };
}
