import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { OliviaError } from "@/lib/olivia/errors";
import { reportingStatus } from "@/lib/olivia/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Polling fallback for a reporting session's status + transcript. Same-origin and auth-gated; the
 * agency `x-api-key` and the client_id are both resolved server-side (the client_id from the
 * session, never the browser), so a user can only ever read the status of their own client's
 * session. Used by the dashboard when the live SSE stream is unavailable.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    // reportingStatus() resolves the session's clientId internally (auth gate).
    const status = await reportingStatus(id);
    return NextResponse.json(status, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: "unauthorized" }, { status: e.status });
    }
    if (e instanceof OliviaError) {
      const headers =
        e.retryAfterSeconds != null
          ? { "Retry-After": String(e.retryAfterSeconds) }
          : undefined;
      const status = e.status && e.status >= 400 ? e.status : 502;
      return NextResponse.json({ error: e.code, message: e.message }, { status, headers });
    }
    throw e;
  }
}
