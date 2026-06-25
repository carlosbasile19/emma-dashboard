"use client";

import { useState } from "react";

const COPY_ICON = (
  <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
    <rect x="7" y="7" width="9" height="9" rx="2" />
    <path d="M13 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h2" />
  </svg>
);

const CHECK_ICON = (
  <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 10.5l3.2 3.2L15 7" />
  </svg>
);

export function CopyButton({
  value,
  className,
  label = "Copy",
  copiedLabel = "Copied",
  compact = false,
  title,
}: {
  value: string;
  className?: string;
  label?: string;
  copiedLabel?: string;
  compact?: boolean;
  title?: string;
}) {
  const [done, setDone] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={copy}
        title={title ?? label}
        aria-label={done ? copiedLabel : (title ?? label)}
        className={
          className ??
          "flex h-7 w-7 flex-none items-center justify-center rounded-[8px] border border-ink/10 bg-white text-muted transition-colors hover:bg-lavender hover:text-violet"
        }
      >
        {done ? CHECK_ICON : COPY_ICON}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={
        className ??
        "flex-none rounded-[8px] border border-ink/10 bg-white px-2.5 py-1.5 font-display text-[12px] font-medium text-ink transition-colors hover:bg-lavender"
      }
    >
      {done ? copiedLabel : label}
    </button>
  );
}
