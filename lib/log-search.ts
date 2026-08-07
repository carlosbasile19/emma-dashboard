import { MIN_PHONE_DIGITS, digitsOnly, normalize, tokenize } from "@/lib/leads-search";
import type { Call, ListResponse, ThreadRow } from "@/lib/types";

/**
 * In-app search for the Calls & Conversations log. Neither /calls nor /conversations takes a
 * search parameter (external API guide §5), and /calls ignores a lead_id filter, so matching
 * runs here over locally-collected rows. Pure and dependency-free — see
 * `scripts/log-search-selftest.ts`.
 *
 * The token primitives are imported from `lib/leads-search` rather than redefined, so a search
 * for "maria santos" behaves identically on the Leads tab and here.
 */

/**
 * True when EVERY token matches at least one field (AND across tokens, OR across fields).
 *
 * `call.lead` is the DISPLAY name injected by `withLeadNames()` from the lead directory —
 * /calls itself carries only `lead_id`. Callers must therefore enrich before matching, or a
 * name search finds nothing. Both numbers are checked because direction decides which one is
 * the lead: `to_number` on an outbound call, `from_number` on an inbound one.
 * Fields absent without the dashboard:pii scope simply match nothing.
 */
export function matchesCall(call: Call, tokens: string[]): boolean {
  if (!tokens.length) return true;

  const lead = normalize(call.lead ?? "");
  const id = normalize(call.lead_id ?? "");
  const from = digitsOnly(call.from_number ?? "");
  const to = digitsOnly(call.to_number ?? "");

  return tokens.every((t) => {
    // Guard against a vacuous match: "".includes("") is true, so an empty token
    // (e.g. from a caller that skips filter(Boolean)) must not match everything.
    if (!t) return false;
    if (lead.includes(t)) return true;
    if (id.includes(t)) return true;
    const d = digitsOnly(t);
    if (d.length < MIN_PHONE_DIGITS) return false;
    return (from.length > 0 && from.includes(d)) || (to.length > 0 && to.includes(d));
  });
}

/**
 * Same semantics as `matchesCall`, over a merged thread row. Thread rows carry no phone number
 * (see `ThreadRow`), so a numeric query can only reach them through the lead id.
 */
export function matchesThread(row: ThreadRow, tokens: string[]): boolean {
  if (!tokens.length) return true;

  const name = normalize(row.lead_name ?? "");
  const id = normalize(row.lead_id ?? "");

  return tokens.every((t) => {
    if (!t) return false;
    return name.includes(t) || id.includes(t);
  });
}

/**
 * Filter a call corpus by `q`, then slice to a page. An empty query returns everything.
 * Non-finite `page`/`limit` (NaN, ±Infinity) coerce to their defaults (1 and 25) so the
 * returned envelope is never self-contradictory (e.g. a non-zero `total` with `limit: NaN`).
 * Mirrors `searchCorpus` in `lib/leads-search`.
 */
export function searchCallCorpus(
  calls: Call[],
  q: string,
  page: number,
  limit: number,
): ListResponse<Call> {
  const tokens = tokenize(q);
  const matches = tokens.length ? calls.filter((c) => matchesCall(c, tokens)) : calls;
  const safeLimit = Number.isFinite(limit) ? limit : 25;
  const safePage = Number.isFinite(page) ? page : 1;
  const size = Math.max(1, safeLimit);
  const p = Math.max(1, safePage);
  const start = (p - 1) * size;
  return { items: matches.slice(start, start + size), total: matches.length, page: p, limit: size };
}

/** Filter merged thread rows by `q`. An empty query returns everything, in order. */
export function searchThreads(rows: ThreadRow[], q: string): ThreadRow[] {
  const tokens = tokenize(q);
  if (!tokens.length) return rows;
  return rows.filter((r) => matchesThread(r, tokens));
}
