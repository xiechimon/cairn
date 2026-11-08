import type { SVGProps } from 'react';
import { BRAND_GLYPH, type BrandGlyphSize } from '../lib/brand-mark.js';

export function BrandGlyph({
  optical = 'small',
  busy = false,
  ...svg
}: { optical?: BrandGlyphSize; busy?: boolean } & SVGProps<SVGSVGElement>) {
  const { box, scale, offset, band, d } = BRAND_GLYPH[optical];
  const stroke = {
    d,
    pathLength: 1,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: band,
    strokeLinecap: 'round',
  } as const;
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${box} ${box}`} {...svg}>
      <g
        transform={`translate(${box / 2} ${box / 2}) scale(${scale}) translate(${offset[0]} ${offset[1]})`}
      >
        <path {...stroke} opacity={busy ? 0.28 : 1} />
        {busy && <path className="spiral-trace" {...stroke} />}
      </g>
    </svg>
  );
}
