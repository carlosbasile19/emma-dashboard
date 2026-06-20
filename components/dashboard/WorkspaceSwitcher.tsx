"use client";

import { setActiveClient } from "@/app/auth/actions";
import type { WorkspaceClient } from "@/lib/types";

// Platform-admin workspace switcher — replaces the static workspace badge for admins.
// Changing the selection submits the admin-gated setActiveClient server action.
export function WorkspaceSwitcher({
  clients,
  activeClientId,
}: {
  clients: WorkspaceClient[];
  activeClientId: string;
}) {
  return (
    <form action={setActiveClient} className="relative">
      <select
        name="clientId"
        defaultValue={activeClientId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        aria-label="Switch workspace"
        title="Switch workspace (admin)"
        className="max-w-[220px] cursor-pointer appearance-none rounded-[6px] border border-lavender-deep bg-lavender py-0.5 pl-2 pr-6 font-mono text-[11px] text-muted hover:text-violet"
      >
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[8px] text-muted">
        ▼
      </span>
    </form>
  );
}
