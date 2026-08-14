// Pure copy/state helpers for the "stop contacting this lead" control. Kept out of the
// components so the wording — which is the safety-critical part of this feature — is unit
// testable. See scripts/dnc-selftest.ts.

import { num } from "@/lib/format";
import type { Lead } from "@/lib/types";

/** Every write failure the server action can report. */
export type DoNotContactError = "forbidden" | "not_found" | "rate_limited" | "failed";

/**
 * The blast-radius line shown after a successful stop. `cancelled_runs` comes from the server
 * and cannot be predicted locally, which is why the toggle never moves before the response.
 *
 * 0 is a normal, meaningful outcome — the lead had nothing running, or already carried the
 * flag (the endpoint is idempotent, so a retry or double-click reports 0). Saying "0
 * automations cancelled" would read like a failure, so that case gets its own sentence.
 */
export function cancelledLine(cancelledRuns: number): string {
  // Guard the non-finite/negative cases too: this is server-supplied and feeds a claim about
  // what was destroyed, so it must never render "NaN automations cancelled".
  if (!Number.isFinite(cancelledRuns) || cancelledRuns <= 0) {
    return "No automations were running for this lead.";
  }
  const n = Math.floor(cancelledRuns);
  return `${num(n)} running automation${n === 1 ? "" : "s"} cancelled.`;
}

export const ERROR_COPY: Record<DoNotContactError, string> = {
  forbidden: "This API key can’t change contact settings — it needs the dashboard:notes scope.",
  not_found: "This lead no longer exists, so nothing was changed.",
  rate_limited: "Emma is rate-limiting writes right now. Wait a moment and try again.",
  failed: "Couldn’t reach Emma — nothing was changed. Try again in a moment.",
};

/** Retrying is pointless when the key lacks the scope or the lead is gone. */
export function isRetryable(error: DoNotContactError): boolean {
  return error === "rate_limited" || error === "failed";
}

/**
 * Is this lead suppressed? `do_not_contact` is optional on the type because cache rows written
 * before the field existed omit it — absent must read as "contactable", never as unknown.
 *
 * Deliberately independent of `status`: `status: "dnc"` is a pipeline stage a lead can be moved
 * through, while this flag is the switch the outbound channels actually check. A lead can carry
 * either without the other, so neither may be inferred from the other.
 */
export function isStopped(lead: Pick<Lead, "do_not_contact">): boolean {
  return lead.do_not_contact === true;
}
