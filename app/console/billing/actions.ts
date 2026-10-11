"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import {
  billingMarkupEnabled,
  chargeTerms,
  defaultBillingEmail,
  loadBillingSettings,
  loadClientBilling,
  saveBillingSettings,
  upsertClientBilling,
} from "@/lib/billing/config";
import { removeCard, syncCustomerEmail } from "@/lib/billing/customers";
import { invoiceMonth, retryInvoice, runBilling, tzOf, listInvoices } from "@/lib/billing/invoices";
import { parseAnchorDay, parseDollarsToCents, parseMonthKey, parsePercentToBps } from "@/lib/billing/money";
import { sendSetupLinkEmail } from "@/lib/billing/notify";
import { closedMonthsWithoutInvoice, localDate, monthOf, prevMonth, reenableNeedsBillFrom } from "@/lib/billing/schedule";
import { setupLinkState } from "@/lib/billing/status";
import {
  createSetupLink,
  listSetupLinks,
  markSetupLinkSent,
  revokeSetupLink,
  setupLinkUrl,
} from "@/lib/billing/setup";
import { getRequestOrigin } from "@/lib/origin";
import { createAdminClient } from "@/lib/supabase/admin";

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

/**
 * Platform-admin only: the defaults every client inherits unless overridden. Markup is unreleased:
 * while it is off the form has no markup field and the stored default is left untouched.
 */
export async function saveBillingDefaults(formData: FormData) {
  const ctx = await requireAdmin();
  const markupBps = billingMarkupEnabled() ? parsePercentToBps(str(formData, "markup")) : undefined;
  const feeCents = parseDollarsToCents(str(formData, "fee"));
  const anchorDay = parseAnchorDay(str(formData, "anchorDay"));
  const alertEmail = str(formData, "alertEmail").toLowerCase();
  if (markupBps === null || feeCents == null || anchorDay == null) redirect("/console/billing?error=invalid");
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

/**
 * Platform-admin only: the daily job, on demand. Only months that are due are touched. Charges
 * real cards, so the form's confirmation box must be ticked.
 */
export async function runBillingNow(formData: FormData) {
  await requireAdmin();
  if (formData.get("confirm") !== "on") redirect("/console/billing?error=run_unconfirmed");
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

// ---- Per-client actions (/console/billing/[id]) ----
// Every one: requireAdmin() first, then the client id is re-checked against olivia_clients
// (never trusted from the form alone). Stripe/DB work is wrapped; redirect() stays outside catches.

/** The client must be one of ours; a client id is never trusted from the form alone. */
async function knownClient(clientId: string): Promise<{ id: string; name: string; timezone: string | null } | null> {
  if (!clientId) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("olivia_clients")
    .select("olivia_client_id, name, timezone")
    .eq("olivia_client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(`Client lookup failed: ${error.message}`);
  return data
    ? {
        id: data.olivia_client_id as string,
        name: (data.name as string | null) ?? clientId,
        timezone: (data.timezone as string | null) ?? null,
      }
    : null;
}

/** Platform-admin only: enable/disable and the per-client overrides. Blank override = default. */
export async function saveClientBilling(formData: FormData) {
  const ctx = await requireAdmin();
  const client = await knownClient(str(formData, "clientId"));
  if (!client) redirect("/console/billing?error=client");
  const back = `/console/billing/${client.id}`;

  const enabled = formData.get("enabled") === "on";
  const emailRaw = str(formData, "billingEmail").toLowerCase();
  if (emailRaw && !emailRaw.includes("@")) redirect(`${back}?error=email`);
  const billFromRaw = str(formData, "billFromMonth");
  const billFromMonth = billFromRaw ? parseMonthKey(billFromRaw) : null;
  if (billFromRaw && !billFromMonth) redirect(`${back}?error=invalid`);
  if (billFromMonth) {
    // A year typo would raise a year of fee invoices: no more than 12 months back (future is fine).
    let earliest = monthOf(localDate(new Date(), tzOf(client.timezone)));
    for (let i = 0; i < 12; i++) earliest = prevMonth(earliest);
    if (billFromMonth < earliest) redirect(`${back}?error=bill_from`);
  }
  // Markup is unreleased: while it is off there is no field, and the stored override is untouched.
  const markupOn = billingMarkupEnabled();
  const markupRaw = markupOn ? str(formData, "markup") : "";
  const markupBps = markupRaw ? parsePercentToBps(markupRaw) : null;
  if (markupRaw && markupBps == null) redirect(`${back}?error=invalid`);
  const feeRaw = str(formData, "fee");
  const feeCents = feeRaw ? parseDollarsToCents(feeRaw) : null;
  if (feeRaw && feeCents == null) redirect(`${back}?error=invalid`);
  const anchorRaw = str(formData, "anchorDay");
  const anchorDay = anchorRaw ? parseAnchorDay(anchorRaw) : null;
  if (anchorRaw && anchorDay == null) redirect(`${back}?error=invalid`);

  let existing: Awaited<ReturnType<typeof loadClientBilling>>;
  try {
    existing = await loadClientBilling(client.id);
  } catch (e) {
    console.error("[billing] save client billing: load failed", e);
    redirect(`${back}?error=save`);
  }
  // Re-enabling with the old, past bill-from would back-charge every month billing was off. Make
  // the admin choose the month explicitly; never change the submitted data silently. A blank
  // field falls back to the stored month below, so it counts as "the stored month submitted".
  if (
    reenableNeedsBillFrom({
      wasEnabled: existing?.enabled ?? false,
      nowEnabled: enabled,
      storedBillFrom: existing?.billFromMonth ?? null,
      submittedBillFrom: billFromMonth ?? existing?.billFromMonth ?? null,
      currentMonth: monthOf(localDate(new Date(), tzOf(client.timezone))),
    })
  ) {
    redirect(`${back}?error=bill_from_reenable`);
  }

  let failed = false;
  try {
    // First configure: bill from the current month in the client's timezone, and default the
    // billing contact to the earliest member, so switching billing on never bills the past by
    // accident and always has somewhere to send receipts.
    const billFrom = billFromMonth ?? existing?.billFromMonth ?? monthOf(localDate(new Date(), tzOf(client.timezone)));
    const billingEmail = emailRaw || existing?.billingEmail || (await defaultBillingEmail(client.id));
    // A blank override is an explicit null: it clears the override back to the platform default.
    const saved = await upsertClientBilling(
      client.id,
      { enabled, billingEmail, billFromMonth: billFrom, markupBps: markupOn ? markupBps : undefined, feeCents, anchorDay },
      ctx.userId,
    );
    // The card may have been saved before billing was configured: Stripe's receipts follow the contact.
    if (saved.billingEmail !== (existing?.billingEmail ?? null)) await syncCustomerEmail(saved, saved.billingEmail);
  } catch (e) {
    console.error("[billing] save client billing failed", e);
    failed = true;
  }
  redirect(failed ? `${back}?error=save` : `${back}?notice=saved`);
}

/**
 * Platform-admin only: a fresh card-setup link (7 days, reusable until completed). Works whether
 * or not automatic billing is on — saving a card never charges anything by itself.
 */
export async function generateSetupLink(formData: FormData) {
  const ctx = await requireAdmin();
  const client = await knownClient(str(formData, "clientId"));
  if (!client) redirect("/console/billing?error=client");
  const back = `/console/billing/${client.id}`;
  let target = `${back}?notice=link`;
  try {
    await createSetupLink(client.id, ctx.userId);
  } catch (e) {
    console.error("[billing] create setup link failed", e);
    target = `${back}?error=link`;
  }
  redirect(target);
}

/** Platform-admin only: email an existing link. Fail-soft — the copy-link UI remains the fallback. */
export async function emailSetupLink(formData: FormData) {
  await requireAdmin();
  const client = await knownClient(str(formData, "clientId"));
  if (!client) redirect("/console/billing?error=client");
  const back = `/console/billing/${client.id}`;
  const linkId = str(formData, "linkId");
  const to = str(formData, "email").toLowerCase();
  if (!linkId || !to.includes("@")) redirect(`${back}?error=email`);

  let target = `${back}?notice=sent`;
  try {
    // The token comes from the stored link for THIS client, never from the form.
    const now = new Date();
    const link = (await listSetupLinks(client.id)).find((l) => l.id === linkId && setupLinkState(l, now) === "valid");
    if (!link) {
      target = `${back}?error=no_valid_link`;
    } else {
      const [cb, settings] = await Promise.all([loadClientBilling(client.id), loadBillingSettings()]);
      const terms = chargeTerms(cb, settings);
      const { error } = await sendSetupLinkEmail({
        clientId: client.id,
        clientName: client.name,
        to,
        setupUrl: setupLinkUrl(await getRequestOrigin(), link.token),
        feeCents: terms.feeCents,
        anchorDay: terms.anchorDay,
        expiresInDays: Math.max(1, Math.ceil((Date.parse(link.expiresAt) - now.getTime()) / 86_400_000)),
      });
      if (error) {
        console.error("[billing] setup link email failed:", error);
        target = `${back}?error=send`;
      } else {
        await markSetupLinkSent(link.id, to);
      }
    }
  } catch (e) {
    console.error("[billing] setup link email failed", e);
    target = `${back}?error=send`;
  }
  redirect(target);
}

export async function revokeLink(formData: FormData) {
  await requireAdmin();
  const client = await knownClient(str(formData, "clientId"));
  if (!client) redirect("/console/billing?error=client");
  const back = `/console/billing/${client.id}`;
  let target = `${back}?notice=revoked`;
  try {
    await revokeSetupLink(str(formData, "linkId"), client.id);
  } catch (e) {
    console.error("[billing] revoke setup link failed", e);
    target = `${back}?error=link`;
  }
  redirect(target);
}

export async function adminRemoveCard(formData: FormData) {
  await requireAdmin();
  const client = await knownClient(str(formData, "clientId"));
  if (!client) redirect("/console/billing?error=client");
  const back = `/console/billing/${client.id}`;
  let target = `${back}?notice=card_removed`;
  try {
    const removed = await removeCard(client.id, await getRequestOrigin());
    if (!removed) target = `${back}?notice=no_card`;
  } catch (e) {
    // The local mirror is already cleared (nothing will be charged); Stripe's detach failed.
    console.error("[billing] remove card failed", e);
    target = `${back}?error=remove`;
  }
  redirect(target);
}

/** Platform-admin only: invoice one closed month now, ignoring the anchor day. Never the current month. */
export async function chargeNow(formData: FormData) {
  const ctx = await requireAdmin();
  const client = await knownClient(str(formData, "clientId"));
  if (!client) redirect("/console/billing?error=client");
  const back = `/console/billing/${client.id}`;
  const month = parseMonthKey(str(formData, "month"));
  const lastClosed = prevMonth(monthOf(localDate(new Date(), tzOf(client.timezone))));
  if (!month || month > lastClosed) redirect(`${back}?error=month`);

  // Only months the page offers: bill-from onward, closed, not yet invoiced. Decided before the
  // charge try/catch so redirect() is never inside a catch.
  let allowed = false;
  try {
    const cb = await loadClientBilling(client.id);
    if (cb?.enabled && cb.billFromMonth) {
      const invoiced = (await listInvoices(client.id)).map((i) => i.periodMonth);
      const today = localDate(new Date(), tzOf(client.timezone));
      allowed = closedMonthsWithoutInvoice(today, cb.billFromMonth, invoiced).includes(month);
    }
  } catch (e) {
    console.error("[billing] charge now pre-check failed", e);
    redirect(`${back}?error=charge`);
  }
  if (!allowed) redirect(`${back}?error=month`);

  let target: string;
  try {
    const r = await invoiceMonth(client.id, month, "manual", {
      createdBy: ctx.userId,
      origin: await getRequestOrigin(),
    });
    target =
      r.outcome === "error"
        ? `${back}?error=charge`
        : `${back}?notice=charged&outcome=${encodeURIComponent(r.outcome)}&status=${encodeURIComponent(r.status ?? "")}`;
  } catch (e) {
    console.error("[billing] charge now failed", e);
    target = `${back}?error=charge`;
  }
  redirect(target);
}

export async function retryCharge(formData: FormData) {
  await requireAdmin();
  const client = await knownClient(str(formData, "clientId"));
  if (!client) redirect("/console/billing?error=client");
  const back = `/console/billing/${client.id}`;
  const invoiceId = str(formData, "invoiceId");

  let target: string;
  try {
    // The invoice row must belong to this client (retryInvoice takes only a row id).
    const owned = (await listInvoices(client.id)).some((i) => i.id === invoiceId);
    if (!owned) {
      target = `${back}?error=retry`;
    } else {
      const r = await retryInvoice(invoiceId);
      target = `${back}?notice=retried&ok=${r.ok ? 1 : 0}&status=${encodeURIComponent(r.status ?? "")}`;
    }
  } catch (e) {
    console.error("[billing] retry charge failed", e);
    target = `${back}?error=retry`;
  }
  redirect(target);
}
