export interface EmptyCopy {
  title: string;
  body: string;
  cta?: string;
}

export function EmptyState({
  copy,
  onAction,
}: {
  copy: EmptyCopy;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-h-[380px] flex-col items-center justify-center px-5 py-16 text-center">
      <div className="mb-[22px] flex h-[76px] w-[76px] items-center justify-center rounded-[22px] border border-lavender-deep bg-lavender">
        <svg
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#6D4AFF"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 12a9 9 0 1018 0 9 9 0 00-18 0z" />
          <path d="M9 12h6" />
        </svg>
      </div>
      <div className="mb-2 text-[22px] font-bold tracking-[-0.01em]">{copy.title}</div>
      <div className="mb-[22px] max-w-[420px] text-[15px] leading-[1.55] text-muted">
        {copy.body}
      </div>
      {copy.cta ? (
        <button
          onClick={onAction}
          className="cursor-pointer rounded-[10px] bg-violet px-5 py-[11px] text-sm font-medium text-white shadow-[0_6px_18px_rgba(109,74,255,0.28)] transition hover:bg-[#5d3df0]"
        >
          {copy.cta}
        </button>
      ) : null}
    </div>
  );
}
