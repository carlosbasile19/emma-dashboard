import { badgeColor, tint } from "@/lib/design";
import { fmtEnum } from "@/lib/format";
import type { BadgeKind } from "@/lib/types";

// Status badge — colored dot + tinted pill (design `badge()`).
// The `source` kind renders the raw token in a neutral mono pill, matching the design.
export function Badge({ kind, value }: { kind: BadgeKind; value: string }) {
  if (kind === "source") {
    return (
      <span className="inline-flex items-center whitespace-nowrap rounded-[6px] border border-lavender-deep bg-lavender px-[7px] py-[2px] font-mono text-[11px] text-muted">
        {value}
      </span>
    );
  }
  const color = badgeColor(kind, value);
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border py-[3px] pl-2 pr-2.5 text-xs font-medium leading-tight"
      style={{ color, background: tint(color, 0.1), borderColor: tint(color, 0.22) }}
    >
      <span
        className="h-1.5 w-1.5 flex-none rounded-full"
        style={{ background: color }}
      />
      {fmtEnum(value)}
    </span>
  );
}
