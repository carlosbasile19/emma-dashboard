"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/auth/actions";

const NAV = [
  { href: "/console", label: "Overview", key: "overview" },
  { href: "/console/clients", label: "Clients", key: "clients" },
] as const;

function active(pathname: string, href: string): boolean {
  return href === "/console" ? pathname === "/console" : pathname.startsWith(href);
}

export function ConsoleSidebar({
  userName,
  initials,
}: {
  userName: string;
  initials: string;
}) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 flex h-screen w-[248px] flex-none flex-col border-r border-ink/10 bg-white px-[14px] py-5">
      <div className="flex items-center gap-2.5 px-2 pb-4 pt-1.5">
        <div className="bg-gradient-brand flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] text-white">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3.5" y="3" width="7.5" height="14" rx="1" />
            <path d="M11 8.5h4.5a1 1 0 0 1 1 1V17H11" />
            <path d="M6 6.5h2.5M6 9.5h2.5M6 12.5h2.5" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="font-display text-[15px] font-bold leading-tight">Emma Console</div>
          <div className="font-mono text-[10px] tracking-[0.04em] text-muted">Agency admin</div>
        </div>
      </div>

      <Link
        href="/dashboard"
        className="mb-3 flex items-center gap-2 rounded-[10px] border border-dashed border-lavender-deep px-2.5 py-2 font-mono text-[12px] text-muted transition-colors hover:border-violet/45 hover:bg-lavender hover:text-violet"
      >
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5l-5 5 5 5" />
        </svg>
        Back to a workspace
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5">
        <div className="px-2 pb-[7px] font-mono text-[10px] uppercase tracking-[0.14em] text-muted opacity-80">
          Agency
        </div>
        {NAV.map((item) => {
          const on = active(pathname, item.href);
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={on ? "page" : undefined}
              className={`flex items-center gap-[11px] rounded-[10px] px-2.5 py-[9px] text-sm transition-colors ${
                on ? "bg-lavender font-semibold text-violet" : "font-normal text-ink hover:bg-lavender"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-2.5 border-t border-ink/10 pt-[14px]">
        <div className="bg-gradient-brand flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] font-mono text-[13px] font-bold text-white">
          {initials || "–"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium">{userName}</span>
            <span className="bg-gradient-brand flex-none rounded-[5px] px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wider text-white">
              Admin
            </span>
          </div>
          <div className="truncate text-[11px] text-muted">Agency console</div>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            title="Sign out"
            className="cursor-pointer rounded-[8px] p-1.5 text-muted transition-colors hover:bg-lavender"
          >
            <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
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
