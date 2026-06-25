export type SkeletonVariant =
  | "cards"
  | "charts"
  | "donuts"
  | "funnel"
  | "campaigns"
  | "table"
  | "board";

function Block({ className }: { className?: string }) {
  return <div className={`shimmer rounded-[8px] ${className ?? ""}`} />;
}

// Per-view loading skeletons (design `SHARED: SKELETON`).
export function Skeleton({ variant }: { variant: SkeletonVariant }) {
  switch (variant) {
    case "cards":
      return (
        <div>
          <Block className="mb-[22px] h-[120px] rounded-[16px]" />
          <div className="mb-[22px] grid grid-cols-[repeat(auto-fill,minmax(216px,1fr))] gap-[14px]">
            {Array.from({ length: 6 }).map((_, i) => (
              <Block key={i} className="h-[128px]" />
            ))}
          </div>
          <Block className="h-[280px] rounded-[16px]" />
        </div>
      );
    case "charts":
      return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Block key={i} className="h-[240px] rounded-[16px]" />
          ))}
        </div>
      );
    case "donuts":
      return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Block key={i} className="h-[320px] rounded-[16px]" />
          ))}
        </div>
      );
    case "funnel":
      return <Block className="h-[420px] rounded-[16px]" />;
    case "campaigns":
      return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Block key={i} className="h-[230px] rounded-[16px]" />
          ))}
        </div>
      );
    case "table":
      return (
        <div>
          <Block className="mb-3 h-[46px] w-[320px] rounded-[10px]" />
          <div className="rounded-[16px] border border-ink/10 bg-white p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Block key={i} className="m-1.5 h-[42px]" />
            ))}
          </div>
        </div>
      );
    case "board":
      return (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex w-[300px] flex-none flex-col gap-2 rounded-[14px] border border-ink/10 bg-lavender/40 p-2.5"
            >
              <Block className="mb-1 h-[34px]" />
              {Array.from({ length: 3 }).map((__, j) => (
                <Block key={j} className="h-[72px]" />
              ))}
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}
