"use server";

import { AuthError } from "@/lib/auth";
import { OliviaError } from "@/lib/olivia/errors";
import { fetchCallDetail, saveLeadNotes } from "@/lib/olivia/service";
import type { Call } from "@/lib/types";

export interface SaveNotesResult {
  ok: boolean;
  notes?: string;
  updatedAt?: string;
  /** "forbidden" → the key lacks dashboard:notes (notes are read-only); "failed" → retryable. */
  error?: "forbidden" | "failed";
}

const NOTES_MAX = 20_000;

/** Persist a lead's notes via the Olivia PUT (session-scoped; empty string clears). */
export async function saveNotes(leadId: string, notes: string): Promise<SaveNotesResult> {
  if (typeof leadId !== "string" || !leadId || typeof notes !== "string") {
    return { ok: false, error: "failed" };
  }
  if (notes.length > NOTES_MAX) return { ok: false, error: "failed" };
  try {
    const r = await saveLeadNotes(leadId, notes);
    return { ok: true, notes: r.notes, updatedAt: r.updated_at };
  } catch (e) {
    if (e instanceof OliviaError && e.code === "forbidden_scope") {
      return { ok: false, error: "forbidden" };
    }
    if (e instanceof AuthError) return { ok: false, error: "failed" };
    return { ok: false, error: "failed" };
  }
}

export interface LoadCallResult {
  ok: boolean;
  call?: Call;
  /** "not_found" → the call isn't in the day's log (session-scoped); "failed" → retryable. */
  error?: "not_found" | "failed";
}

/**
 * Hydrate the full call row (recording/transcript) for the lead page's call drawer — the
 * lead-detail payload embeds only a slim call shape without those fields.
 */
export async function loadCall(callId: string, startedAt: string): Promise<LoadCallResult> {
  if (
    typeof callId !== "string" ||
    !callId ||
    typeof startedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}/.test(startedAt)
  ) {
    return { ok: false, error: "failed" };
  }
  try {
    const call = await fetchCallDetail(callId, startedAt);
    return call ? { ok: true, call } : { ok: false, error: "not_found" };
  } catch {
    return { ok: false, error: "failed" };
  }
}
