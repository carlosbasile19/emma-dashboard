// Merge logic for the conversations tab. Deliberately NOT "server-only": nothing here
// touches secrets or the network, and keeping it import-safe lets the selftest exercise
// the merge directly (scripts/threads-selftest.ts).
//
// Two upstream surfaces describe threads and neither is complete on its own:
//   • /dm-threads     → DM networks only. Carries lead_name, preview text, bot_active, locked.
//   • /conversations  → every channel (the ONLY place SMS appears). Carries the activity
//                       counters (message_count, unread, last_message_at, direction).
// Rows are keyed by conversation id; where both describe the same thread the DM row wins on
// display fields and the conversation row supplies the counters.

import type { Conversation, DmThread, ThreadRow } from "./types";

/** Voice conversations hold zero message rows — listing them opens empty ghost threads. */
export const isMessageBearing = (channel: string) => channel !== "voice";

/**
 * Newest-first comparator for optional ISO timestamps. Compares parsed epochs, NOT strings:
 * the two sources disagree on format — `/conversations` sends
 * "2026-07-31T13:02:38.359232+00:00" while other rows send "2026-07-30T02:34:10Z" — and a
 * lexicographic compare would misorder same-second rows across that boundary. Unparseable or
 * missing stamps sort last.
 */
export function byRecencyDesc(a?: string | null, b?: string | null): number {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return tb - ta;
}

export function mergeThreadRows(
  dmThreads: DmThread[],
  conversations: Conversation[],
): ThreadRow[] {
  const byId = new Map<string, ThreadRow>();

  for (const c of conversations) {
    if (!isMessageBearing(c.channel)) continue;
    byId.set(c.id, {
      id: c.id,
      lead_id: c.lead_id,
      lead_name: c.lead ?? null,
      channel: c.channel,
      platform: c.platform ?? null,
      status: c.ended_at ? "ended" : "active",
      last_message: c.last_message ?? null,
      // Fall back to started_at so a thread with no activity stamp still sorts sanely.
      last_message_at: c.last_message_at ?? c.started_at ?? null,
      last_message_direction: c.last_message_direction ?? null,
      message_count: c.message_count ?? null,
      unread: c.unread ?? 0,
      opted_out_at: c.opted_out_at ?? null,
    });
  }

  for (const t of dmThreads) {
    const prev = byId.get(t.id);
    byId.set(t.id, {
      ...prev,
      id: t.id,
      lead_id: t.lead_id,
      lead_name: t.lead_name ?? prev?.lead_name ?? null,
      channel: t.channel,
      platform: t.platform ?? prev?.platform ?? null,
      status: t.status,
      bot_active: t.bot_active,
      last_message: t.last_message ?? prev?.last_message ?? null,
      last_message_at: t.last_message_at ?? prev?.last_message_at ?? null,
      last_message_direction: prev?.last_message_direction ?? null,
      message_count: prev?.message_count ?? null,
      unread: t.unread ?? prev?.unread ?? 0,
      opted_out_at: prev?.opted_out_at ?? null,
      locked: t.locked,
    });
  }

  return [...byId.values()].sort((a, b) => byRecencyDesc(a.last_message_at, b.last_message_at));
}
