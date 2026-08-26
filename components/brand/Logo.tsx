// Get Emma gradient logo mark — a cluster of three four-point sparkles.

const GRADIENT_FROM = "#7C3AED";
const GRADIENT_TO = "#EC4899";

// Four-point sparkle centered at (cx, cy) with radius r, edges curved
// toward the center.
function sparklePath(cx: number, cy: number, r: number) {
  const a = r * 0.12;
  const b = r * 0.38;
  return [
    `M ${cx} ${cy - r}`,
    `C ${cx + a} ${cy - b} ${cx + b} ${cy - a} ${cx + r} ${cy}`,
    `C ${cx + b} ${cy + a} ${cx + a} ${cy + b} ${cx} ${cy + r}`,
    `C ${cx - a} ${cy + b} ${cx - b} ${cy + a} ${cx - r} ${cy}`,
    `C ${cx - b} ${cy - a} ${cx - a} ${cy - b} ${cx} ${cy - r}`,
    "Z",
  ].join(" ");
}

export function LogoMark({ size = 34 }: { size?: number }) {
  const id = `emma-logo-${size}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      style={{ display: "block", flex: "none" }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0.2" y1="0" x2="0.75" y2="1">
          <stop offset="0%" stopColor={GRADIENT_FROM} />
          <stop offset="100%" stopColor={GRADIENT_TO} />
        </linearGradient>
      </defs>
      <path d={sparklePath(25.5, 13.5, 12.5)} fill={`url(#${id})`} />
      <path d={sparklePath(8.5, 21, 8)} fill={`url(#${id})`} />
      <path d={sparklePath(18, 33, 6)} fill={`url(#${id})`} />
    </svg>
  );
}

export function LogoWordmark({ size = 34 }: { size?: number }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark size={size} />
      <div className="whitespace-nowrap text-[17px] font-bold tracking-[-0.01em] text-ink">
        Get Emma
        <span className="align-super text-[8px] font-semibold text-muted">™</span>
      </div>
    </div>
  );
}
