import type { Lead, ListResponse } from "@/lib/types";

/**
 * In-app lead search. Upstream /leads has no search parameter (external API guide §5), so
 * matching runs here over a locally-paged corpus. Pure and dependency-free — see
 * `scripts/leads-search-selftest.ts`.
 */

/** Tokens shorter than this never match a phone, so "maria" can't hit a number via stray digits. */
const MIN_PHONE_DIGITS = 3;

/** Reduce a string to comparable form: trimmed and lowercased. */
export function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Strip everything that is not a digit, so "(077) 0090-0123" → "07700900123". */
export function digitsOnly(s: string): string {
  return s.replace(/\D+/g, "");
}

/** Split a raw query into non-empty, normalized search tokens. */
export function tokenize(q: string): string[] {
  return normalize(q).split(/\s+/).filter(Boolean);
}

/**
 * True when EVERY token matches at least one field (AND across tokens, OR across fields).
 * A multi-word query like "maria santos" works because `tokenize` splits it into two
 * AND-ed tokens, each checked independently against first/last/email/id/phone — not
 * because of any joined "first last" string.
 * Fields absent without the dashboard:pii scope simply match nothing.
 */
export function matchesLead(lead: Lead, tokens: string[]): boolean {
  if (!tokens.length) return true;

  const first = normalize(lead.first_name ?? "");
  const last = normalize(lead.last_name ?? "");
  const email = normalize(lead.email ?? "");
  const id = normalize(lead.id);
  const phone = digitsOnly(lead.phone ?? "");

  return tokens.every((t) => {
    // Guard against a vacuous match: "".includes("") is true, so an empty token
    // (e.g. from a caller that skips filter(Boolean)) must not match everything.
    if (!t) return false;
    if (first.includes(t) || last.includes(t)) return true;
    if (email.includes(t)) return true;
    if (id.includes(t)) return true;
    const d = digitsOnly(t);
    return d.length >= MIN_PHONE_DIGITS && phone.length > 0 && phone.includes(d);
  });
}

/**
 * Filter a corpus by `q`, then slice to a page. An empty query returns everything.
 * Non-finite `page`/`limit` (NaN, ±Infinity) coerce to their defaults (1 and 25) so the
 * returned envelope is never self-contradictory (e.g. a non-zero `total` with `limit: NaN`).
 */
export function searchCorpus(
  leads: Lead[],
  q: string,
  page: number,
  limit: number,
): ListResponse<Lead> {
  const tokens = tokenize(q);
  const matches = tokens.length ? leads.filter((l) => matchesLead(l, tokens)) : leads;
  const safeLimit = Number.isFinite(limit) ? limit : 25;
  const safePage = Number.isFinite(page) ? page : 1;
  const size = Math.max(1, safeLimit);
  const p = Math.max(1, safePage);
  const start = (p - 1) * size;
  return { items: matches.slice(start, start + size), total: matches.length, page: p, limit: size };
}

/**
 * Should the corpus crawl request another page? A short page means we've hit the end;
 * otherwise keep going until we've collected `total`.
 */
export function hasMorePages(
  fetched: number,
  total: number,
  lastPageCount: number,
  pageSize: number,
): boolean {
  if (lastPageCount < pageSize) return false;
  return fetched < total;
}
