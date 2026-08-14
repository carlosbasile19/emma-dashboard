"use server";

import { AuthError } from "@/lib/auth";
import type { DoNotContactError } from "@/lib/do-not-contact";
import { OliviaError } from "@/lib/olivia/errors";
import { setLeadDoNotContact } from "@/lib/olivia/service";

export interface DoNotContactActionResult {
  ok: boolean;
  /** The value the SERVER now holds — never assume it matches what was requested. */
  doNotContact?: boolean;
  updatedAt?: string;
  /**
   * Workflow runs killed by this write. 0 is meaningful and common: the lead was already in
   * this state (the endpoint is idempotent), or nothing was running.
   */
  cancelledRuns?: number;
  /**
   * "forbidden" → the key lacks dashboard:notes, so this is read-only for everyone; hide the
   * control rather than let it keep failing. "not_found" → the lead is gone or belongs to
   * another client; never retry. "rate_limited" → writes ride a tighter bucket than reads and
   * the client already exhausted its backoff; retrying by hand is fine. "failed" → retryable.
   */
  error?: DoNotContactError;
}

/**
 * Stop or resume all outbound contact for a lead. Server-side so the agency key stays out of
 * the browser (same reasoning as saveNotes — a Server Action IS the same-origin proxy).
 *
 * Idempotent upstream, so a double-click or a retry is safe; the second call simply reports
 * `cancelled_runs: 0`.
 */
export async function setDoNotContact(
  leadId: string,
  doNotContact: boolean,
): Promise<DoNotContactActionResult> {
  // The upstream body contract is strict (`{ do_not_contact: <boolean> }`), so reject a
  // non-boolean here rather than spend a request earning a 400.
  if (typeof leadId !== "string" || !leadId || typeof doNotContact !== "boolean") {
    return { ok: false, error: "failed" };
  }
  try {
    const r = await setLeadDoNotContact(leadId, doNotContact);
    return {
      ok: true,
      doNotContact: r.do_not_contact,
      updatedAt: r.updated_at,
      cancelledRuns: r.cancelled_runs ?? 0,
    };
  } catch (e) {
    if (e instanceof OliviaError) {
      if (e.code === "forbidden_scope") return { ok: false, error: "forbidden" };
      if (e.code === "lead_not_found") return { ok: false, error: "not_found" };
      if (e.status === 429) return { ok: false, error: "rate_limited" };
    }
    if (e instanceof AuthError) return { ok: false, error: "failed" };
    return { ok: false, error: "failed" };
  }
}
