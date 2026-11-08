import { BrandGlyph } from '../components/brand-glyph.js';

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
      <BrandGlyph busy={busy} x="22" y="22" width="56" height="56" color="var(--fab-mark)" />
    </svg>
  );
}
