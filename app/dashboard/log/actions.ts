"use server";

import { OliviaError } from "@/lib/olivia/errors";
import { fetchConversationThread } from "@/lib/olivia/service";
import type { ConversationThread } from "@/lib/types";

export interface LoadThreadResult {
  ok: boolean;
  thread?: ConversationThread;
  error?: "not_found" | "failed";
}

/**
 * Load a conversation's messages for the chat drawer — any channel, SMS included
 * (session-scoped; never retries 404s). `before` is an ISO-8601 cursor for paging
 * backwards through a long thread; an unparseable value is rejected upstream with a
 * 400, so it is validated here rather than forwarded blind.
 */
export async function loadThread(
  conversationId: string,
  before?: string,
): Promise<LoadThreadResult> {
  if (typeof conversationId !== "string" || !conversationId) {
    return { ok: false, error: "failed" };
  }
  if (before !== undefined && (typeof before !== "string" || Number.isNaN(Date.parse(before)))) {
    return { ok: false, error: "failed" };
  }
  try {
    const r = await fetchConversationThread(conversationId, undefined, { before });
    return { ok: true, thread: r.data };
  } catch (e) {
    if (e instanceof OliviaError && (e.code === "conversation_not_found" || e.status === 404)) {
      return { ok: false, error: "not_found" };
    }
    return { ok: false, error: "failed" };
  }
}
