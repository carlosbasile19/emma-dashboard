"use server";

import { OliviaError } from "@/lib/olivia/errors";
import { fetchConversationThread } from "@/lib/olivia/service";
import type { ConversationThread } from "@/lib/types";

export interface LoadThreadResult {
  ok: boolean;
  thread?: ConversationThread;
  error?: "not_found" | "failed";
}

/** Load a DM thread's messages for the chat drawer (session-scoped; never retries 404s). */
export async function loadThread(conversationId: string): Promise<LoadThreadResult> {
  if (typeof conversationId !== "string" || !conversationId) {
    return { ok: false, error: "failed" };
  }
  try {
    const r = await fetchConversationThread(conversationId);
    return { ok: true, thread: r.data };
  } catch (e) {
    if (e instanceof OliviaError && (e.code === "conversation_not_found" || e.status === 404)) {
      return { ok: false, error: "not_found" };
    }
    return { ok: false, error: "failed" };
  }
}
