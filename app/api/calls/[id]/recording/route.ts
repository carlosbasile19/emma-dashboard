import { NextResponse } from "next/server";
import { AuthError, getSessionClientId } from "@/lib/auth";
import { shortId } from "@/lib/format";
import { allowedRecordingHosts, validateRecordingSrc } from "@/lib/recording";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Same-origin proxy that streams a call recording back as a downloadable attachment. The audio is
 * served cross-origin without CORS headers, so a client-side download is impossible; this route
 * fetches it server-side. It is auth-gated and only ever fetches an allowlisted host (the SSRF
 * guard) — it never resolves data by id (no such Olivia endpoint exists) and never proxies an
 * arbitrary URL.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Auth — only logged-in users may use the proxy.
  try {
    await getSessionClientId();
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: "unauthorized" }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const src = new URL(request.url).searchParams.get("src");

  // 2. Validate the source URL against the host allowlist (SSRF guard).
  const check = validateRecordingSrc(src, allowedRecordingHosts());
  if (!check.ok) {
    console.warn("[recording] rejected src reason=%s", check.reason);
    return NextResponse.json({ error: "bad_src", message: check.reason }, { status: 400 });
  }

  // 3. Fetch upstream server-side (no CORS constraints here).
  let upstream: Response;
  try {
    upstream = await fetch(check.url, { redirect: "follow" });
  } catch (e) {
    console.warn("[recording] upstream unreachable host=%s err=%s", check.url.host, (e as Error)?.message);
    return NextResponse.json({ error: "upstream_unreachable" }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    console.warn("[recording] upstream error host=%s status=%s", check.url.host, upstream.status);
    return NextResponse.json(
      { error: "upstream_error", status: upstream.status },
      { status: 502 },
    );
  }

  // 4. Stream back as an attachment with a clean filename.
  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("content-type") ?? "audio/mpeg");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  headers.set("Content-Disposition", `attachment; filename="call-${shortId(id)}.mp3"`);
  headers.set("Cache-Control", "private, no-store");
  return new Response(upstream.body, { status: 200, headers });
}
