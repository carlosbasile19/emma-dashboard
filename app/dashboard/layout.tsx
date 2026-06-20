import { Suspense, type ReactNode } from "react";
import { Header, type CampaignOption } from "@/components/dashboard/Header";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { sampleCampaigns, sampleWorkspace } from "@/lib/sample-data";

// Phase 2: workspace + campaign filter come from placeholder data.
// Phase 3 swaps the workspace for the authenticated session's olivia_clients row;
// Phase 6 swaps campaign options for the live /campaigns list.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const ws = sampleWorkspace;
  const campaignOptions: CampaignOption[] = [
    { value: "all", label: "All campaigns" },
    ...sampleCampaigns
      .filter((c) => c.status !== "draft")
      .map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <div className="flex min-h-screen">
      <Sidebar workspace={ws} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense
          fallback={
            <div className="sticky top-0 z-20 h-[57px] border-b border-ink/10 bg-warm/85 backdrop-blur-[10px]" />
          }
        >
          <Header workspaceName={ws.name} campaignOptions={campaignOptions} />
        </Suspense>
        <main className="flex-1 animate-fade-up px-7 pb-14 pt-[22px]">{children}</main>
      </div>
    </div>
  );
}
