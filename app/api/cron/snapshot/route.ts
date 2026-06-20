import { NextResponse } from "next/server";

// Phase 8 snapshot cron entrypoint. DISABLED by default — this is a scaffolded seam.
// Activate later by setting SNAPSHOTS_ENABLED=true (and CRON_SECRET) in the environment.
// The Vercel cron schedule (vercel.json) points here and is a harmless no-op until then.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (process.env.SNAPSHOTS_ENABLED !== "true") {
    return NextResponse.json({
      status: "disabled",
      message: "Snapshot cron is scaffolded but inactive (set SNAPSHOTS_ENABLED=true to enable).",
    });
  }

  // When enabled, require the Vercel cron secret.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const { runDailySnapshots } = await import("@/lib/olivia/snapshots");
  const result = await runDailySnapshots();
  return NextResponse.json({ status: "ok", ...result });
}
