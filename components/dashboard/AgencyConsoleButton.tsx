import Link from "next/link";

// Platform-admin affordance in the client dashboard sidebar: jump up to the agency-level admin
// console (/console). Rendered only for admins (see Sidebar).
export function AgencyConsoleButton({ href }: { href: string }) {
  return (
    <Link
      href={href}
      title="Open the agency console"
      className="group mb-3 flex items-center gap-2.5 rounded-[14px] border border-dashed border-lavender-deep px-3.5 py-[11px] transition-colors hover:border-violet/45 hover:bg-lavender"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="flex-none text-muted transition-colors group-hover:text-violet"
      >
        <rect x="3.5" y="3" width="7.5" height="14" rx="1" />
        <path d="M11 8.5h4.5a1 1 0 0 1 1 1V17H11" />
        <path d="M6 6.5h2.5M6 9.5h2.5M6 12.5h2.5" />
      </svg>
      <span className="flex-1 font-mono text-[13px] tracking-[0.01em] text-muted transition-colors group-hover:text-ink">
        Agency console
      </span>
      <svg
        width="15"
        height="15"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="flex-none text-ink/70 transition-colors group-hover:text-violet"
      >
        <path d="M7 13 13 7" />
        <path d="M7.5 7H13v5.5" />
      </svg>
    </Link>
  );
}
