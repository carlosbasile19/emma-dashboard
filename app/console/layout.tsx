import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ConsoleSidebar } from "@/components/console/ConsoleSidebar";
import { AuthError, requireAdmin } from "@/lib/auth";
import { initials as toInitials } from "@/lib/format";

// Agency-admin console. Gated to platform admins; everyone else is bounced to their dashboard.
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError && e.status === 401) redirect("/login");
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen bg-warm">
      <ConsoleSidebar userName={ctx.userName} initials={toInitials(ctx.userName)} />
      <main className="min-w-0 flex-1 animate-fade-up px-8 pb-16 pt-7">{children}</main>
    </div>
  );
}
