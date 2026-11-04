export const SPIRAL_PATH = 'M0 0 A84 84 0 0 1 168 0 A140 140 0 0 1 -112 0 A196 196 0 0 1 280 0';

export function ChiefSpiralFace({
  size,
  busy = false,
  className = '',
}: {
  size: number;
  busy?: boolean;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`flex-none ${className}`}
    >
      <circle cx="50" cy="50" r="50" fill="var(--fab-surface)" />
      <g transform="translate(50 50) scale(0.105) translate(-84 28)">
        <path
          d={SPIRAL_PATH}
          pathLength={1}
          fill="none"
          stroke="var(--fab-mark)"
          strokeWidth="64"
          strokeLinecap="round"
          opacity={busy ? 0.28 : 1}
        />
        {busy && (
          <path
            className="spiral-trace"
            d={SPIRAL_PATH}
            pathLength={1}
            fill="none"
            stroke="var(--fab-mark)"
            strokeWidth="64"
            strokeLinecap="round"
          />
        )}
      </g>
    </svg>
  );
}
