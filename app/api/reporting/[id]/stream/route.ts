import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { OliviaError } from "@/lib/olivia/errors";
import { streamReporting } from "@/lib/olivia/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Upstream closes the SSE on terminal status or ~110s; give the function room to outlive one cycle.
export const maxDuration = 120;

/**
 * Same-origin Server-Sent Events proxy for a reporting session's live transcript. The browser's
 * EventSource can't send the agency `x-api-key`, and the upstream stream is cross-origin without
 * CORS — so we open it server-side (key injected) and pipe the event bytes straight through. The
 * client_id is resolved from the session inside `streamReporting` (never from the browser), so a
 * user can only ever stream their own client's session.
 *
 * The browser's abort (EventSource.close / navigation) flows through `request.signal` to the
 * upstream fetch, tearing down the upstream connection too. Events pass verbatim, so the named
 * SSE events (`status` | `transcript` | `ended`) reach `EventSource.addEventListener` unchanged.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let upstream: Response;
  try {
    upstream = await streamReporting(id, request.signal);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: "unauthorized" }, { status: e.status });
    }
    if (e instanceof OliviaError) {
      console.warn("[reporting] stream upstream error code=%s status=%s", e.code, e.status);
      const headers =
        e.retryAfterSeconds != null ? { "Retry-After": String(e.retryAfterSeconds) } : undefined;
      const status = e.status && e.status >= 400 ? e.status : 502;
      return NextResponse.json({ error: e.code, message: e.message }, { status, headers });
    }
    throw e;
  }

  if (!upstream.body) {
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering so events flush immediately (e.g. nginx in front).
      "X-Accel-Buffering": "no",
    },
  });
}
