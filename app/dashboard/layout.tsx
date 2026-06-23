import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { signOut } from "@/app/auth/actions";
import { Header, type CampaignOption } from "@/components/dashboard/Header";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { AuthError, getWorkspace } from "@/lib/auth";
import { fetchCampaigns } from "@/lib/olivia/service";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  let ws;
  try {
    ws = await getWorkspace();
  } catch (e) {
    if (e instanceof AuthError && e.status === 401) redirect("/login");
    return <NoWorkspace />;
  }

  // Campaign options come from the live /campaigns list (presentational selector — see
  // DECISIONS: the Olivia analytics API has no campaign filter param).
  let campaignOptions: CampaignOption[] = [{ value: "all", label: "All campaigns" }];
  try {
    const { data: campaigns } = await fetchCampaigns();
    campaignOptions = [
      { value: "all", label: "All campaigns" },
      ...campaigns
        .filter((c) => c.status !== "draft")
        .map((c) => ({ value: c.id, label: c.name })),
    ];
  } catch {
    // keep the default single option on error
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar workspace={ws} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense
          fallback={
            <div className="sticky top-0 z-20 h-[57px] border-b border-ink/10 bg-warm/85 backdrop-blur-[10px]" />
          }
        >
          <Header
            workspaceName={ws.name}
            campaignOptions={campaignOptions}
            isAdmin={ws.isAdmin}
            clients={ws.clients}
            activeClientId={ws.clientId}
          />
        </Suspense>
        <main className="flex-1 animate-fade-up px-7 pb-14 pt-[22px]">{children}</main>
      </div>
    </div>
  );
}

function NoWorkspace() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-[76px] w-[76px] items-center justify-center rounded-[22px] border border-lavender-deep bg-lavender">
        <svg width="34" height="34" viewBox="0 0 20 20" fill="none" stroke="#6D4AFF" strokeWidth="1.6">
          <rect x="4" y="9" width="12" height="8" rx="2" />
          <path d="M7 9V6a3 3 0 016 0v3" />
        </svg>
      </div>
      <h1 className="text-2xl font-bold tracking-[-0.01em]">No workspace linked yet</h1>
      <p className="max-w-[420px] text-[15px] leading-[1.55] text-muted">
        Your account isn’t mapped to an Olivia workspace. Ask your Hey Emma administrator to
        finish provisioning, then sign in again.
      </p>
      <form action={signOut}>
        <button className="cursor-pointer rounded-[10px] border border-ink/10 bg-white px-5 py-[11px] text-sm font-medium text-ink hover:bg-lavender">
          Sign out
        </button>
      </form>
    </main>
  );
}
