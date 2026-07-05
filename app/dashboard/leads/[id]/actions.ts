"use server";

import { AuthError } from "@/lib/auth";
import { OliviaError } from "@/lib/olivia/errors";
import { saveLeadNotes } from "@/lib/olivia/service";

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
