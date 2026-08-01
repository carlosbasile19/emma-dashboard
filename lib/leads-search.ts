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

/** Strip everything that is not a digit, so "(077) 0090-0123" → "0770090123". */
export function digitsOnly(s: string): string {
  return s.replace(/\D+/g, "");
}

/** Split a raw query into non-empty, normalized search tokens. */
export function tokenize(q: string): string[] {
  return normalize(q).split(/\s+/).filter(Boolean);
}

/**
 * True when EVERY token matches at least one field (AND across tokens, OR across fields).
 * That's what makes "maria santos" work when first and last names are separate columns.
 * Fields absent without the dashboard:pii scope simply match nothing.
 */
export function matchesLead(lead: Lead, tokens: string[]): boolean {
  if (!tokens.length) return true;

  const first = normalize(lead.first_name ?? "");
  const last = normalize(lead.last_name ?? "");
  const joined = [first, last].filter(Boolean).join(" ");
  const email = normalize(lead.email ?? "");
  const id = normalize(lead.id);
  const phone = digitsOnly(lead.phone ?? "");

  return tokens.every((t) => {
    if (first.includes(t) || last.includes(t) || joined.includes(t)) return true;
    if (email.includes(t)) return true;
    if (id.includes(t)) return true;
    const d = digitsOnly(t);
    return d.length >= MIN_PHONE_DIGITS && phone.length > 0 && phone.includes(d);
  });
}

/** Filter a corpus by `q`, then slice to a page. An empty query returns everything. */
export function searchCorpus(
  leads: Lead[],
  q: string,
  page: number,
  limit: number,
): ListResponse<Lead> {
  const tokens = tokenize(q);
  const matches = tokens.length ? leads.filter((l) => matchesLead(l, tokens)) : leads;
  const size = Math.max(1, limit);
  const p = Math.max(1, page);
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
