import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// One agency key → one bucket. We never store the key itself, just a stable id.
const RATE_KEY = "olivia:default";
// ~500/min, a margin under Olivia's 600/min-per-key hard limit (guide §5).
const CAPACITY = 500;
const REFILL_PER_SEC = 500 / 60;

/** Atomic, cross-instance token-bucket consume. Returns false when over budget. */
export async function consumeToken(admin: Admin): Promise<boolean> {
  const { data, error } = await admin.rpc("consume_rate_token", {
    p_key: RATE_KEY,
    p_capacity: CAPACITY,
    p_refill_per_sec: REFILL_PER_SEC,
  });
  // Fail-open on infra error: don't block legitimate traffic if the governor itself errors.
  if (error) return true;
  return data === true;
}

/** Single-flight: true if this caller now holds the lock for `key`. */
export async function acquireLock(key: string, admin: Admin): Promise<boolean> {
  const { data, error } = await admin.rpc("try_acquire_lock", { p_key: key });
  if (error) return false;
  return data === true;
}

export async function releaseLock(key: string, admin: Admin): Promise<void> {
  await admin.rpc("release_lock", { p_key: key });
}
