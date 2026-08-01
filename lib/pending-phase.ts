/**
 * The pending-navigation timeline, as a pure function of elapsed time.
 *
 * Kept React-free and out of the component so it can be tested in plain node
 * (`scripts/loading-states-selftest.ts`), the same way `lib/usage.ts` is. These are the ONLY
 * definitions of these timings — no other file may hardcode them.
 */

export type PendingPhase = "idle" | "active" | "slow" | "stuck";

/**
 * Below this, a navigation produces no visible state at all. Without it every fast or cached
 * filter change flashes a dim-and-restore, which reads as jank rather than as feedback.
 */
export const GRACE_MS = 150;

/** Past this the wait is abnormal — say so, because the upstream is known to flap. */
export const SLOW_MS = 8_000;

/** Past this it may never resolve — offer a way out. Still not an error: it may yet succeed. */
export const STUCK_MS = 25_000;

/** `null` elapsed means "nothing pending". */
export function phaseFor(elapsedMs: number | null): PendingPhase {
  if (elapsedMs === null) return "idle";
  if (elapsedMs < GRACE_MS) return "idle";
  if (elapsedMs < SLOW_MS) return "active";
  if (elapsedMs < STUCK_MS) return "slow";
  return "stuck";
}

/**
 * Milliseconds until the phase would next change, or `null` if it never will again (not
 * pending, or already terminal). Lets the provider set exactly one timer per phase instead of
 * polling on an interval.
 */
export function nextPhaseChangeMs(elapsedMs: number | null): number | null {
  if (elapsedMs === null) return null;
  if (elapsedMs < GRACE_MS) return GRACE_MS - elapsedMs;
  if (elapsedMs < SLOW_MS) return SLOW_MS - elapsedMs;
  if (elapsedMs < STUCK_MS) return STUCK_MS - elapsedMs;
  return null;
}
