/**
 * Selftest for the conversations merge + channel display helpers.
 *
 * Guards the three shape corrections the Olivia backend called out when SMS shipped:
 *   1. SMS sends `platform: "sms"`, NOT null — only voice sends null.
 *   2. Voice conversations carry no message rows and must never reach the list.
 *   3. `locked` threads OMIT total/has_more — absent means unknown, not zero.
 *
 * Run: npm run test:threads
 */

import { agentLabel, channelCode, channelLabel } from "../lib/channels";
import { mergeThreadRows } from "../lib/threads";
import type { Conversation, DmThread } from "../lib/types";

let failures = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}

const conv = (over: Partial<Conversation> & Pick<Conversation, "id" | "channel">): Conversation =>
  ({
    lead_id: "lead-1",
    started_at: "2026-07-01T10:00:00Z",
    created_at: "2026-07-01T10:00:00Z",
    ...over,
  }) as Conversation;

const dm = (over: Partial<DmThread> & Pick<DmThread, "id" | "channel">): DmThread =>
  ({
    lead_id: "lead-1",
    status: "active",
    unread: 0,
    ...over,
  }) as DmThread;

console.log("\nchannel display helpers");
// The bug this replaces: the old DM-only map returned "DM" for sms.
check('channelLabel("sms") is SMS, not DM', channelLabel("sms") === "SMS", channelLabel("sms"));
check('channelLabel("ig") still Instagram', channelLabel("ig") === "Instagram");
check("unknown channel degrades", channelLabel("carrier-pigeon") === "Message");
// Slicing would have rendered "email" as "EMA" and "imessage" as "IME".
check('channelCode("email") is MAIL', channelCode("email") === "MAIL", channelCode("email"));
check('channelCode("imessage") is IMSG', channelCode("imessage") === "IMSG");
check('channelCode("sms") is SMS', channelCode("sms") === "SMS");

console.log("\nagent label sanitizing");
check(
  "strips sequence prefix and channel suffix",
  agentLabel("007. Emma Re-activation Nurse/Midwife (SMS)") === "Emma Re-activation Nurse/Midwife",
  agentLabel("007. Emma Re-activation Nurse/Midwife (SMS)"),
);
check("null agent falls back to Emma", agentLabel(null) === "Emma");
check("empty after cleaning falls back", agentLabel("12.") === "Emma", agentLabel("12."));
check("ordinary name untouched", agentLabel("Emma") === "Emma");

console.log("\nmerge: SMS visibility");
const smsRows = mergeThreadRows(
  [],
  [
    conv({
      id: "c-sms",
      channel: "sms",
      platform: "sms", // correction 1 — not null
      message_count: 20,
      unread: 2,
      last_message_at: "2026-07-30T02:34:10Z",
      last_message_direction: "outbound",
    }),
  ],
);
check("SMS conversation becomes a row", smsRows.length === 1 && smsRows[0]?.channel === "sms");
check("counters survive the merge", smsRows[0]?.message_count === 20 && smsRows[0]?.unread === 2);
check("direction survives", smsRows[0]?.last_message_direction === "outbound");

console.log("\nmerge: voice exclusion (correction 2)");
const withVoice = mergeThreadRows(
  [],
  [conv({ id: "c-voice", channel: "voice" }), conv({ id: "c-sms", channel: "sms" })],
);
check("voice dropped", withVoice.length === 1 && withVoice[0]?.id === "c-sms", withVoice.map((r) => r.id));

console.log("\nmerge: DM overlay");
const overlaid = mergeThreadRows(
  [
    dm({
      id: "c-ig",
      channel: "ig",
      lead_name: "Sarah T.",
      last_message: "see you tuesday",
      bot_active: true,
      unread: 1,
    }),
  ],
  [
    conv({
      id: "c-ig",
      channel: "chat",
      platform: "instagram",
      message_count: 8,
      last_message_at: "2026-07-30T09:00:00Z",
    }),
  ],
);
check("same thread is not duplicated", overlaid.length === 1, overlaid.length);
check("DM display fields win", overlaid[0]?.lead_name === "Sarah T." && overlaid[0]?.channel === "ig");
check("conversation counters preserved", overlaid[0]?.message_count === 8);
check("DM preview text preserved", overlaid[0]?.last_message === "see you tuesday");

console.log("\nmerge: ordering");
const ordered = mergeThreadRows(
  [],
  [
    conv({ id: "old", channel: "sms", last_message_at: "2026-07-01T00:00:00Z" }),
    conv({ id: "new", channel: "sms", last_message_at: "2026-07-30T00:00:00Z" }),
    conv({ id: "mid", channel: "sms", last_message_at: "2026-07-15T00:00:00Z" }),
  ],
);
check(
  "newest activity first",
  ordered.map((r) => r.id).join(",") === "new,mid,old",
  ordered.map((r) => r.id),
);
const noStamp = mergeThreadRows([], [conv({ id: "c1", channel: "sms", last_message_at: null })]);
check("missing last_message_at falls back to started_at", noStamp[0]?.last_message_at === "2026-07-01T10:00:00Z");

// The live API mixes formats: /conversations sends "…+00:00" with microseconds, other rows
// send "…Z". A lexicographic sort puts the "+" row (0x2B) before "Z" (0x5A) regardless of
// the actual instant, so these must be compared as parsed epochs.
const mixedFormat = mergeThreadRows(
  [dm({ id: "z-newer", channel: "wa", last_message_at: "2026-07-31T13:02:39Z" })],
  [conv({ id: "plus-older", channel: "sms", last_message_at: "2026-07-31T13:02:38.359232+00:00" })],
);
check(
  "mixed Z / +00:00 formats order by instant, not string",
  mixedFormat.map((r) => r.id).join(",") === "z-newer,plus-older",
  mixedFormat.map((r) => r.id),
);
const unparseable = mergeThreadRows(
  [],
  [
    conv({ id: "good", channel: "sms", last_message_at: "2026-07-30T00:00:00Z" }),
    conv({ id: "junk", channel: "sms", last_message_at: "not-a-date", started_at: "not-a-date" }),
  ],
);
check("unparseable stamps sort last", unparseable.map((r) => r.id).join(",") === "good,junk", unparseable.map((r) => r.id));

console.log("\nmerge: locked threads (correction 3)");
const lockedRows = mergeThreadRows(
  [dm({ id: "c-locked", channel: "wa", locked: true, lead_name: null, last_message: null })],
  [],
);
check("locked row still lists", lockedRows.length === 1 && lockedRows[0]?.locked === true);
check(
  "unknown message_count stays null, not 0",
  lockedRows[0]?.message_count === null,
  lockedRows[0]?.message_count,
);

console.log(
  failures === 0 ? "\nAll thread selftests passed.\n" : `\n${failures} thread selftest(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
