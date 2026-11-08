import { BrandGlyphMark } from '../components/brand-glyph.js';
import { BRAND_GLYPH } from '../lib/brand-mark.js';

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
      <g
        transform={`translate(22 22) scale(${56 / BRAND_GLYPH.small.box})`}
        color="var(--fab-mark)"
      >
        <BrandGlyphMark busy={busy} />
      </g>
    </svg>
  );
}
