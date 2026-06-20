import type { ReactNode } from "react";

// Standard white surface card (design: white bg, hairline border, lg radius, sm shadow).
export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-[16px] border border-ink/10 bg-white shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}
