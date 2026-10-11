"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { saveBillingSettings } from "@/lib/billing/config";
import { runBilling } from "@/lib/billing/invoices";
import { parseAnchorDay, parseDollarsToCents, parsePercentToBps } from "@/lib/billing/money";
import { getRequestOrigin } from "@/lib/origin";

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

/** Platform-admin only: the defaults every client inherits unless overridden. */
export async function saveBillingDefaults(formData: FormData) {
  const ctx = await requireAdmin();
  const markupBps = parsePercentToBps(str(formData, "markup"));
  const feeCents = parseDollarsToCents(str(formData, "fee"));
  const anchorDay = parseAnchorDay(str(formData, "anchorDay"));
  const alertEmail = str(formData, "alertEmail").toLowerCase();
  if (markupBps == null || feeCents == null || anchorDay == null) redirect("/console/billing?error=invalid");
  if (alertEmail && !alertEmail.includes("@")) redirect("/console/billing?error=invalid");
  let failed = false;
  try {
    await saveBillingSettings({ markupBps, feeCents, anchorDay, alertEmail: alertEmail || null }, ctx.userId);
  } catch (e) {
    console.error("[billing] save defaults failed", e);
    failed = true;
  }
  redirect(failed ? "/console/billing?error=save_failed" : "/console/billing?notice=saved");
}

/** Platform-admin only: the daily job, on demand. Only months that are due are touched. */
export async function runBillingNow() {
  await requireAdmin();
  let target: string;
  try {
    const summary = await runBilling("manual", { origin: await getRequestOrigin() });
    target = `/console/billing?notice=run&invoiced=${summary.counts.invoiced}&errors=${summary.counts.error}`;
  } catch (e) {
    console.error("[billing] manual run failed", e);
    target = "/console/billing?error=run_failed";
  }
  redirect(target);
}
