export interface ErrorCopy {
  title: string;
  body: string;
}

export function ErrorState({
  copy,
  onRetry,
}: {
  copy: ErrorCopy;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-[380px] flex-col items-center justify-center px-5 py-16 text-center">
      <div className="mb-[22px] flex h-[76px] w-[76px] items-center justify-center rounded-[22px] border border-danger/25 bg-danger/10">
        <svg
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#E5484D"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3l9 16H3z" />
          <path d="M12 10v4" />
          <path d="M12 17.5h.01" />
        </svg>
      </div>
      <div className="mb-2 text-[22px] font-bold tracking-[-0.01em]">{copy.title}</div>
      <div className="mb-[22px] max-w-[420px] text-[15px] leading-[1.55] text-muted">
        {copy.body}
      </div>
      <div className="flex gap-[10px]">
        <button
          onClick={onRetry}
          className="cursor-pointer rounded-[10px] bg-ink px-5 py-[11px] text-sm font-medium text-white transition hover:bg-[#0f1d20]"
        >
          Retry
        </button>
        <button className="cursor-pointer rounded-[10px] border border-ink/10 bg-white px-5 py-[11px] text-sm font-medium text-ink transition hover:bg-lavender">
          Contact support
        </button>
      </div>
    </div>
  );
}
