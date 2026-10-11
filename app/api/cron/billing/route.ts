import { NextResponse } from "next/server";
import { billingFeatureEnabled } from "@/lib/billing/config";
import { getRequestOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily billing run (vercel.json: 03:00 UTC). Same shape as /api/cron/snapshot: a no-op while
 * the feature flag is off; with it on, CRON_SECRET is mandatory and must match (fail closed).
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically when the variable is set.
 */
export async function GET(request: Request) {
  if (!billingFeatureEnabled()) {
    return NextResponse.json({ status: "disabled", message: "Set BILLING_ENABLED=true to run billing." });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "misconfigured", message: "CRON_SECRET is required when BILLING_ENABLED=true" },
      { status: 500 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { runBilling } = await import("@/lib/billing/invoices");
    const summary = await runBilling("cron", { origin: await getRequestOrigin() });
    return NextResponse.json({ status: "ok", counts: summary.counts, results: summary.results });
  } catch (err) {
    // Log server-side only; never return a stack or message to the caller.
    console.error("[cron/billing] run failed", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "billing_run_failed" }, { status: 500 });
  }
}
