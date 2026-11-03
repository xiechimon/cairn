import { SPIRAL_PATH } from './chief-spiral-face.js';

export function SpiralMark({
  busy,
  className = 'size-5.5',
}: {
  busy: boolean;
  className?: string;
}) {
  return (
    <svg aria-hidden="true" viewBox="-142 -254 452 452" className={className}>
      <path
        d={SPIRAL_PATH}
        pathLength={1}
        fill="none"
        stroke="currentColor"
        strokeWidth="58"
        strokeLinecap="round"
        opacity={busy ? 0.28 : 1}
      />
      {busy && (
        <path
          className="spiral-trace"
          d={SPIRAL_PATH}
          pathLength={1}
          fill="none"
          stroke="currentColor"
          strokeWidth="58"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
