"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { NAV_ITEMS, SCREEN_TITLES, type NavKey } from "@/lib/design";

export interface CampaignOption {
  value: string;
  label: string;
}

const RANGES: Array<{ value: string; label: string }> = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

function titleFor(pathname: string): string {
  const match = NAV_ITEMS.find((n) =>
    n.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(n.href),
  );
  const key = (match?.key ?? "overview") as NavKey;
  return SCREEN_TITLES[key];
}

export function Header({
  workspaceName,
  campaignOptions,
}: {
  workspaceName: string;
  campaignOptions: CampaignOption[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();

  const range = params.get("range") ?? "30d";
  const campaign = params.get("campaign") ?? "all";

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value === "" || value === "all" || (key === "range" && value === "30d")) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      // Page changes reset on a new filter selection.
      next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-4 border-b border-ink/10 bg-warm/85 px-7 py-3.5 backdrop-blur-[10px]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <h1 className="m-0 text-[21px] font-bold tracking-[-0.02em]">
            {titleFor(pathname)}
          </h1>
          <span className="rounded-[6px] border border-lavender-deep bg-lavender px-2 py-0.5 font-mono text-[11px] text-muted">
            {workspaceName}
          </span>
        </div>
      </div>

      {/* date range */}
      <div className="flex gap-0.5 rounded-[10px] border border-ink/10 bg-white p-[3px]">
        {RANGES.map((r) => {
          const on = range === r.value;
          return (
            <button
              key={r.value}
              onClick={() => setParam("range", r.value)}
              className={`cursor-pointer rounded-[7px] px-[11px] py-1.5 font-mono text-xs transition-colors ${
                on ? "bg-ink text-white" : "text-muted hover:bg-lavender"
              }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      {/* campaign filter */}
      <div className="relative">
        <select
          value={campaign}
          onChange={(e) => setParam("campaign", e.target.value)}
          className="max-w-[200px] cursor-pointer appearance-none rounded-[10px] border border-ink/10 bg-white py-2 pl-3 pr-[30px] font-display text-[13px] text-ink"
        >
          {campaignOptions.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-[11px] top-1/2 -translate-y-1/2 text-[10px] text-muted">
          ▼
        </span>
      </div>
    </header>
  );
}
