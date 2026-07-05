export default function Loading() {
  return (
    <div>
      <div className="shimmer mb-4 h-[44px] w-[340px] rounded-[12px]" />
      <div className="shimmer mb-4 h-[52px] rounded-[14px]" />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="flex flex-col gap-4">
          <div className="shimmer h-[240px] rounded-[16px]" />
          <div className="shimmer h-[200px] rounded-[16px]" />
          <div className="shimmer h-[180px] rounded-[16px]" />
        </div>
        <div className="shimmer h-[280px] rounded-[16px]" />
      </div>
    </div>
  );
}
