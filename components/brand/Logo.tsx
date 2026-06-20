// Emma gradient logo mark — a rounded square with five equalizer bars.

export function LogoMark({ size = 34 }: { size?: number }) {
  const id = `emma-logo-${size}`;
  const bars: Array<[number, number, number]> = [
    [10, 9, 0.65],
    [15.3, 16, 1],
    [20.6, 22, 1],
    [25.9, 13, 1],
    [31.2, 8, 0.65],
  ];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      style={{ display: "block", flex: "none" }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6D4AFF" />
          <stop offset="100%" stopColor="#FF3D77" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="11" fill={`url(#${id})`} />
      <g>
        {bars.map(([x, h, o]) => (
          <rect
            key={x}
            x={x}
            y={(40 - h) / 2}
            width={3.4}
            height={h}
            rx={1.7}
            fill="#fff"
            opacity={o}
          />
        ))}
      </g>
    </svg>
  );
}

export function LogoWordmark({ size = 34 }: { size?: number }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark size={size} />
      <div className="text-[17px] font-medium tracking-[-0.01em] whitespace-nowrap">
        <span className="text-muted">Hey</span>{" "}
        <span className="font-bold text-ink">Emma</span>
      </div>
    </div>
  );
}
