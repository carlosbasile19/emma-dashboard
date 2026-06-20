"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { LogoWordmark } from "@/components/brand/Logo";
import { NavIcon } from "@/components/dashboard/nav-icons";
import { NAV_GROUPS, NAV_ITEMS } from "@/lib/design";
import type { Workspace } from "@/lib/types";

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  workspace,
}: {
  workspace: Pick<Workspace, "name" | "user" | "initials" | "role" | "isAdmin">;
}) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 flex h-screen w-[248px] flex-none flex-col border-r border-ink/10 bg-white px-[14px] py-5">
      <div className="px-2 pb-[18px] pt-1.5">
        <LogoWordmark size={34} />
      </div>

      <nav className="flex flex-1 flex-col gap-[14px] overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group}>
            <div className="px-2 pb-[7px] font-mono text-[10px] uppercase tracking-[0.14em] text-muted opacity-80">
              {group}
            </div>
            <div className="flex flex-col gap-0.5">
              {NAV_ITEMS.filter((n) => n.group === group).map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-[11px] rounded-[10px] px-2.5 py-[9px] text-sm transition-colors ${
                      active
                        ? "bg-lavender font-semibold text-violet"
                        : "font-normal text-ink hover:bg-lavender"
                    }`}
                  >
                    <NavIcon name={item.key} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-2.5 border-t border-ink/10 pt-[14px]">
        <div className="bg-gradient-brand flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] font-mono text-[13px] font-bold text-white">
          {workspace.initials ?? "–"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium">{workspace.user ?? "—"}</span>
            {workspace.isAdmin ? (
              <span className="bg-gradient-brand flex-none rounded-[5px] px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wider text-white">
                Admin
              </span>
            ) : null}
          </div>
          <div className="truncate text-[11px] text-muted">
            {workspace.isAdmin ? "Platform admin" : "Member"}
          </div>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            title="Sign out"
            className="cursor-pointer rounded-[8px] p-1.5 text-muted transition-colors hover:bg-lavender"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 17H5a2 2 0 01-2-2V5a2 2 0 012-2h3" />
              <path d="M13 14l4-4-4-4" />
              <path d="M17 10H8" />
            </svg>
          </button>
        </form>
      </div>
    </aside>
  );
}
