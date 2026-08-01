export type SkeletonVariant =
  | "cards"
  | "charts"
  | "donuts"
  | "funnel"
  | "calendar"
  | "campaigns"
  | "table"
  | "board"
  | "console"
  | "console-detail"
  | "console-plain"
  | "console-table"
  | "console-usage";

function Block({ className }: { className?: string }) {
  return <div className={`shimmer rounded-[8px] ${className ?? ""}`} />;
}

// Every console view opens with a 26-34px heading and a muted subtitle, so all three console
// variants share this head rather than repeating it.
function ConsoleHead() {
  return (
    <>
      <Block className="mb-2.5 h-[30px] w-[260px] rounded-[10px]" />
      <Block className="mb-6 h-[16px] w-[420px] max-w-full rounded-[8px]" />
    </>
  );
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
    case "calendar":
      return (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.9fr_1fr]">
          <div>
            <Block className="mb-3 h-[46px] rounded-[12px]" />
            <Block className="h-[520px] rounded-[16px]" />
          </div>
          <div className="flex flex-col gap-4">
            <Block className="h-[240px] rounded-[16px]" />
            <Block className="h-[240px] rounded-[16px]" />
          </div>
        </div>
      );
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
    case "console":
      return (
        <div className="mx-auto max-w-[1100px]">
          <ConsoleHead />
          <Block className="mb-7 h-[180px] rounded-[18px]" />
          <div className="mb-7 grid grid-cols-2 gap-3.5 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Block key={i} className="h-[86px] rounded-[13px]" />
            ))}
          </div>
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Block key={i} className="h-[74px] rounded-[14px]" />
            ))}
          </div>
        </div>
      );
    case "console-detail":
      return (
        <div className="mx-auto max-w-[1000px]">
          <Block className="mb-4 h-[16px] w-[90px] rounded-[6px]" />
          <ConsoleHead />
          <Block className="mb-7 h-[180px] rounded-[18px]" />
          <div className="mb-7 grid grid-cols-2 gap-3.5 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Block key={i} className="h-[86px] rounded-[13px]" />
            ))}
          </div>
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Block key={i} className="h-[74px] rounded-[14px]" />
            ))}
          </div>
        </div>
      );
    case "console-plain":
      return (
        <div className="mx-auto max-w-[1000px]">
          <ConsoleHead />
          <div className="mb-7 grid grid-cols-2 gap-3.5 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Block key={i} className="h-[86px] rounded-[13px]" />
            ))}
          </div>
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Block key={i} className="h-[74px] rounded-[14px]" />
            ))}
          </div>
        </div>
      );
    case "console-table":
      return (
        <div className="mx-auto max-w-[1100px]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <ConsoleHead />
            </div>
            {/* "Sync from Emma" button, inline with the heading in ClientsTable.tsx */}
            <Block className="h-[30px] w-[132px] flex-none rounded-[10px]" />
          </div>
          <div className="rounded-[16px] border border-ink/10 bg-white p-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Block key={i} className="m-1.5 h-[46px]" />
            ))}
          </div>
        </div>
      );
    case "console-usage":
      return (
        <div className="mx-auto max-w-[1100px]">
          <ConsoleHead />
          {/* period picker */}
          <div className="mb-6 rounded-[16px] border border-ink/10 bg-white px-[18px] py-4">
            <Block className="mb-2.5 h-[12px] w-[60px] rounded-[6px]" />
            <div className="mb-3.5 flex flex-wrap gap-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Block key={i} className="h-[30px] w-[92px] rounded-[9px]" />
              ))}
            </div>
            {/* From / To / Apply range form row */}
            <Block className="h-[44px] w-[360px] max-w-full rounded-[9px]" />
          </div>
          <Block className="mb-6 h-[300px] rounded-[16px]" />
          <Block className="h-[260px] rounded-[16px]" />
        </div>
      );
    default:
      return null;
  }
}
