import assert from "node:assert/strict";
import {
  digitsOnly,
  hasMorePages,
  matchesLead,
  normalize,
  searchCorpus,
  tokenize,
} from "../lib/leads-search";
import type { Lead } from "../lib/types";

/** Minimal Lead fixture — only the fields search touches; the rest satisfy the type. */
function lead(over: Partial<Lead> & { id: string }): Lead {
  return {
    status: "new",
    source: "csv_import",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    total_calls: 0,
    ...over,
  } as Lead;
}

const maria = lead({
  id: "9b1e4c22-0000-4000-8000-000000000001",
  first_name: "Maria",
  last_name: "Santos",
  email: "maria@gmail.com",
  phone: "(077) 0090-0123",
});
const ana = lead({
  id: "9b1e4c22-0000-4000-8000-000000000002",
  first_name: "Ana Maria",
  last_name: "Lopez",
  email: "ana.lopez@outlook.com",
  phone: "+1 415 555 0134",
});
// A lead as it arrives WITHOUT the dashboard:pii scope — no name/email/phone at all.
const redacted = lead({ id: "9b1e4c22-0000-4000-8000-00000000abcd" });

const find = (q: string, rows: Lead[] = [maria, ana, redacted]) =>
  searchCorpus(rows, q, 1, 25).items.map((l) => l.id);

(() => {
  // Helpers
  assert.equal(normalize("  MaRiA  "), "maria");
  assert.equal(digitsOnly("(077) 0090-0123"), "07700900123");
  assert.deepEqual(tokenize("  maria   santos "), ["maria", "santos"]);
  assert.deepEqual(tokenize("   "), []);

  // 1. Name, case-insensitive — matches both Marias.
  assert.deepEqual(find("maria"), [maria.id, ana.id]);
  assert.deepEqual(find("MARIA"), [maria.id, ana.id]);

  // 2. Multi-token across separate first/last columns.
  assert.deepEqual(find("maria santos"), [maria.id]);

  // 3. Multi-token negative — every token must match.
  assert.deepEqual(find("maria jones"), []);

  // 4. Email substring.
  assert.deepEqual(find("@gmail"), [maria.id]);

  // 5. Phone — punctuation on either side is ignored.
  assert.deepEqual(find("07700900123"), [maria.id]);
  assert.deepEqual(find("(077) 0090-0123"), [maria.id]);

  // 6. Phone guard — a 2-digit token must not reach the phone branch, but a 3-digit one must.
  //    "77" IS present in maria's phone digits, so this fails if the guard is missing.
  //    Probe digits are chosen to appear in no fixture id, so only the phone branch is under test.
  assert.deepEqual(find("77"), []);
  assert.deepEqual(find("077"), [maria.id]);

  // 7. Lead ID — full paste and fragment.
  assert.deepEqual(find(maria.id), [maria.id]);
  assert.deepEqual(find("000000000002"), [ana.id]);

  // 8. PII-absent lead — ID still matches; a name query does not.
  assert.deepEqual(find("abcd"), [redacted.id]);
  assert.equal(matchesLead(redacted, tokenize("maria")), false);

  // 8b. Empty-token guard — "".includes("") is true, so this must not vacuously match.
  assert.equal(matchesLead(maria, [""]), false);

  // 9. Empty / whitespace query returns everything untouched.
  assert.deepEqual(find(""), [maria.id, ana.id, redacted.id]);
  assert.deepEqual(find("   "), [maria.id, ana.id, redacted.id]);

  // 10. Pagination over 30 matches at limit 25.
  const many = Array.from({ length: 30 }, (_, i) =>
    lead({ id: `id-${i}`, first_name: "Dup", last_name: `Lead${i}` }),
  );
  const p1 = searchCorpus(many, "dup", 1, 25);
  const p2 = searchCorpus(many, "dup", 2, 25);
  assert.equal(p1.items.length, 25);
  assert.equal(p2.items.length, 5);
  assert.equal(p1.total, 30);
  assert.equal(p2.total, 30);
  assert.equal(p2.page, 2);
  assert.equal(p2.limit, 25);
  // `noUncheckedIndexedAccess` is on in this repo's tsconfig, so index reads need a guard.
  assert.equal(p2.items[0]?.id, "id-25");

  // 10b. Non-finite page/limit coerce to defaults (1, 25) instead of producing a
  //      self-contradictory envelope (e.g. a non-zero total with `limit: NaN`).
  const pNaNLimit = searchCorpus(many, "dup", 1, NaN);
  assert.equal(pNaNLimit.limit, 25);
  assert.equal(pNaNLimit.page, 1);
  assert.equal(pNaNLimit.total, 30);
  assert.equal(pNaNLimit.items.length, 25);
  const pNaNPage = searchCorpus(many, "dup", NaN, 25);
  assert.equal(pNaNPage.page, 1);
  assert.equal(pNaNPage.limit, 25);
  assert.equal(pNaNPage.total, 30);
  assert.equal(pNaNPage.items.length, 25);

  // Crawl loop control — a short page ends the crawl; so does reaching `total`.
  assert.equal(hasMorePages(100, 250, 100, 100), true);
  assert.equal(hasMorePages(250, 250, 50, 100), false); // short page
  assert.equal(hasMorePages(200, 200, 100, 100), false); // fetched === total
  assert.equal(hasMorePages(100, 100, 100, 100), false); // exactly one full page
  assert.equal(hasMorePages(0, 0, 0, 100), false); // empty window

  console.log("leads-search-selftest: all assertions passed");
})();
