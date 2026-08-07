import assert from "node:assert/strict";
import { matchesCall, matchesThread, searchCallCorpus, searchThreads } from "../lib/log-search";
import { tokenize } from "../lib/leads-search";
import type { Call, ThreadRow } from "../lib/types";

/** Minimal Call fixture — only the fields search touches; the rest satisfy the type. */
function call(over: Partial<Call> & { id: string; lead_id: string }): Call {
  return {
    direction: "outbound",
    status: "completed",
    disposition: "interested",
    started_at: "2026-08-01T10:00:00Z",
    created_at: "2026-08-01T10:00:00Z",
    duration_seconds: 62,
    ...over,
  } as Call;
}

function thread(over: Partial<ThreadRow> & { id: string; lead_id: string }): ThreadRow {
  return {
    channel: "sms",
    status: "active",
    unread: 0,
    ...over,
  } as ThreadRow;
}

// `lead` is the enriched display name — /calls itself never carries one.
const mariaCall = call({
  id: "call-1",
  lead_id: "9b1e4c22-0000-4000-8000-000000000001",
  lead: "Maria Santos",
  from_number: "+1 415 555 0100",
  to_number: "(077) 0090-0123",
});
const anaCall = call({
  id: "call-2",
  lead_id: "9b1e4c22-0000-4000-8000-000000000002",
  lead: "Ana Maria Lopez",
  direction: "inbound",
  from_number: "+1 415 555 0134",
  to_number: "+1 415 555 0100",
});
// A call as it arrives WITHOUT the dashboard:pii scope — no name, no numbers.
const redactedCall = call({
  id: "call-3",
  lead_id: "9b1e4c22-0000-4000-8000-00000000abcd",
});

const CALLS = [mariaCall, anaCall, redactedCall];
const findCalls = (q: string, rows: Call[] = CALLS) =>
  searchCallCorpus(rows, q, 1, 25).items.map((c) => c.id);

const mariaThread = thread({
  id: "th-1",
  lead_id: "9b1e4c22-0000-4000-8000-000000000001",
  lead_name: "Maria Santos",
});
const anaThread = thread({
  id: "th-2",
  lead_id: "9b1e4c22-0000-4000-8000-000000000002",
  lead_name: "Ana Maria Lopez",
  channel: "instagram",
});
// A locked DM thread — name suppressed upstream.
const lockedThread = thread({
  id: "th-3",
  lead_id: "9b1e4c22-0000-4000-8000-00000000abcd",
  locked: true,
});

const THREADS = [mariaThread, anaThread, lockedThread];
const findThreads = (q: string, rows: ThreadRow[] = THREADS) =>
  searchThreads(rows, q).map((t) => t.id);

(() => {
  // ---- Calls ----

  // 1. Lead name, case-insensitive — matches both Marias.
  assert.deepEqual(findCalls("maria"), [mariaCall.id, anaCall.id]);
  assert.deepEqual(findCalls("MARIA"), [mariaCall.id, anaCall.id]);

  // 2. Multi-token AND across the one name field.
  assert.deepEqual(findCalls("maria santos"), [mariaCall.id]);
  assert.deepEqual(findCalls("maria jones"), []);

  // 3. Partial / mid-word matching, same as leads.
  assert.deepEqual(findCalls("san"), [mariaCall.id]);

  // 4. Lead id, full and partial.
  assert.deepEqual(findCalls(redactedCall.lead_id), [redactedCall.id]);
  assert.deepEqual(findCalls("abcd"), [redactedCall.id]);

  // 5. Phone matches through formatting, on EITHER number — the lead is `to_number` on an
  //    outbound call and `from_number` on an inbound one.
  assert.deepEqual(findCalls("07700900123"), [mariaCall.id]); // to_number, outbound
  assert.deepEqual(findCalls("(077) 0090-0123"), [mariaCall.id]);
  assert.deepEqual(findCalls("5550134"), [anaCall.id]); // from_number, inbound
  // Shared number hits both rows.
  assert.deepEqual(findCalls("5550100"), [mariaCall.id, anaCall.id]);

  // 6. The ≥3-digit guard: a 2-digit token must not match a phone, even though "55" occurs in
  //    every number here.
  assert.deepEqual(findCalls("55"), []);
  // But 3 digits may — "013" occurs only in Ana's from_number (…0134).
  assert.deepEqual(findCalls("013"), [anaCall.id]);

  // 7. PII-absent rows degrade to id-only rather than throwing or matching everything.
  assert.deepEqual(findCalls("maria", [redactedCall]), []);
  assert.equal(matchesCall(redactedCall, tokenize("maria")), false);

  // 8. Empty query returns everything, in order.
  assert.deepEqual(findCalls(""), CALLS.map((c) => c.id));
  assert.deepEqual(findCalls("   "), CALLS.map((c) => c.id));

  // 9. An empty token can never match — guards a caller that skips filter(Boolean).
  assert.equal(matchesCall(mariaCall, [""]), false);
  // No tokens at all is "no filter", which is not the same thing.
  assert.equal(matchesCall(mariaCall, []), true);

  // 10. Pagination slices the MATCHES, and total is the match count, not the corpus size.
  const p1 = searchCallCorpus(CALLS, "maria", 1, 1);
  assert.deepEqual(p1.items.map((c) => c.id), [mariaCall.id]);
  assert.equal(p1.total, 2);
  assert.equal(p1.page, 1);
  const p2 = searchCallCorpus(CALLS, "maria", 2, 1);
  assert.deepEqual(p2.items.map((c) => c.id), [anaCall.id]);
  assert.equal(p2.total, 2);
  // Past the end is empty, not an error.
  assert.deepEqual(searchCallCorpus(CALLS, "maria", 9, 1).items, []);

  // 11. Non-finite / non-positive page & limit coerce to sane values, so the envelope is
  //     never self-contradictory (a real total alongside limit: NaN).
  const nan = searchCallCorpus(CALLS, "", NaN, NaN);
  assert.equal(nan.limit, 25);
  assert.equal(nan.page, 1);
  assert.equal(nan.items.length, 3);
  const inf = searchCallCorpus(CALLS, "", Infinity, Infinity);
  assert.equal(inf.limit, 25);
  assert.equal(inf.page, 1);
  const zero = searchCallCorpus(CALLS, "", 0, 0);
  assert.equal(zero.limit, 1);
  assert.equal(zero.page, 1);

  // ---- Threads ----

  // 12. Name and id matching, same semantics.
  assert.deepEqual(findThreads("maria"), [mariaThread.id, anaThread.id]);
  assert.deepEqual(findThreads("maria santos"), [mariaThread.id]);
  assert.deepEqual(findThreads("abcd"), [lockedThread.id]);

  // 13. Locked threads carry no name — id-only, never a crash.
  assert.deepEqual(findThreads("maria", [lockedThread]), []);
  assert.equal(matchesThread(lockedThread, tokenize("maria")), false);

  // 14. Threads carry no phone field, so a phone query cannot reach them by number.
  assert.deepEqual(findThreads("07700900123"), []);

  // 15. Empty query returns everything, in order.
  assert.deepEqual(findThreads(""), THREADS.map((t) => t.id));
  assert.equal(matchesThread(mariaThread, [""]), false);
  assert.equal(matchesThread(mariaThread, []), true);

  console.log("log-search self-test: all assertions passed");
})();
