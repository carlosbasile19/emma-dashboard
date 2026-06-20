import type { NavKey } from "@/lib/design";

// Nav glyphs from the imported design. stroke=currentColor so color follows text.
export function NavIcon({ name, className }: { name: NavKey; className?: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    style: { display: "block", flex: "none" as const },
  };
  switch (name) {
    case "overview":
      return (
        <svg {...common}>
          <path d="M3 3h6v6H3z" />
          <path d="M11 3h6v4h-6z" />
          <path d="M11 9h6v8h-6z" />
          <path d="M3 11h6v6H3z" />
        </svg>
      );
    case "trends":
      return (
        <svg {...common}>
          <path d="M3 14l4-4 3 2 6-7" />
          <circle cx="16" cy="5" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "funnel":
      return (
        <svg {...common}>
          <path d="M3 4h14l-5 6v5l-4 2v-7z" />
        </svg>
      );
    case "outcomes":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="6.5" />
          <path d="M10 3.5A6.5 6.5 0 0116 10" strokeWidth={2.4} />
          <circle cx="10" cy="10" r="2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "agents":
      return (
        <svg {...common}>
          <circle cx="10" cy="7" r="3" />
          <path d="M4 17a6 6 0 0112 0" />
        </svg>
      );
    case "campaigns":
      return (
        <svg {...common}>
          <path d="M4 8l9-4v12L4 12z" />
          <path d="M4 8v4H3a1 1 0 01-1-1V9a1 1 0 011-1z" />
          <path d="M13 7a3 3 0 010 6" />
        </svg>
      );
    case "leads":
      return (
        <svg {...common}>
          <path d="M3 4h14v12H3z" />
          <path d="M3 8h14" />
          <path d="M8 8v8" />
        </svg>
      );
    case "logs":
      return (
        <svg {...common}>
          <path d="M4 4h12v9H8l-4 3z" />
          <path d="M7 8h6" />
          <path d="M7 10.5h4" />
        </svg>
      );
    case "design":
      return (
        <svg {...common}>
          <path d="M10 3l5.5 9.5a6 6 0 11-11 0z" />
        </svg>
      );
    default:
      return <svg {...common} />;
  }
}
