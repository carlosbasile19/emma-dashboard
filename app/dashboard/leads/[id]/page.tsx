import Link from "next/link";
import { LeadDetailView } from "@/components/dashboard/leads/LeadDetailView";
import { ErrorState } from "@/components/ui/states/ErrorState";
import { FreshnessNote } from "@/components/ui/FreshnessNote";
import { getWorkspace } from "@/lib/auth";
import { ERROR_COPY } from "@/lib/copy";
import { OliviaError } from "@/lib/olivia/errors";
import { fetchConversationThread, fetchLeadDetail } from "@/lib/olivia/service";
import type { ConversationThread } from "@/lib/types";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const wsPromise = getWorkspace(); // independent of the lead fetch — run them in parallel
  wsPromise.catch(() => undefined); // early returns below must not leave a floating rejection

  let result;
  try {
    result = await fetchLeadDetail(id);
  } catch (e) {
    // 404 = the lead doesn't exist for this tenant — a dead link, not a service fault.
    if (e instanceof OliviaError && (e.code === "lead_not_found" || e.status === 404)) {
      return (
        <div className="flex min-h-[380px] flex-col items-center justify-center px-5 py-16 text-center">
          <div className="mb-2 text-[22px] font-bold tracking-[-0.01em]">Lead not found</div>
          <div className="mb-[22px] max-w-[420px] text-[15px] leading-[1.55] text-muted">
            This lead doesn’t exist in your workspace — it may have been removed upstream.
          </div>
          <Link
            href="/dashboard/leads"
            className="rounded-[10px] bg-ink px-5 py-[11px] text-sm font-medium text-white transition hover:bg-[#0f1d20]"
          >
            Back to leads
          </Link>
        </div>
      );
    }
    return <ErrorState copy={ERROR_COPY.leads} />;
  }

  const ws = await wsPromise;
  const detail = result.data;

  // Embedded thread preview: the most recent conversation's last few messages (SMS included),
  // fail-soft — a preview hiccup must never take down the lead page. Already sorted
  // newest-first upstream; [0] is the live thread.
  const latestStub = (detail.conversations ?? [])[0];
  let preview: ConversationThread | null = null;
  if (latestStub) {
    preview = await fetchConversationThread(latestStub.id, 6)
      .then((r) => r.data)
      .catch(() => null);
  }

  // Split bookings on scheduled_at vs now, server-side (stable for hydration).
  const nowIso = new Date().toISOString();
  const upcoming = detail.bookings.filter((b) => b.scheduled_at >= nowIso);
  const past = detail.bookings.filter((b) => b.scheduled_at < nowIso);

  return (
    <>
      <FreshnessNote freshness={result.freshness} />
      <LeadDetailView
        detail={detail}
        workspaceName={ws.name}
        threadPreview={preview}
        upcomingBookings={upcoming}
        pastBookings={past}
      />
    </>
  );
}
