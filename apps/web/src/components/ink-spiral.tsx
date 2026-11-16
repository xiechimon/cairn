import { cn } from 'cn';
import { type CSSProperties, useId, useLayoutEffect, useRef, useState } from 'react';
import { BRAND_GLYPH } from '../lib/brand-mark.js';
import { Button } from './ui/button.js';

export type SpiralHang = {
  key: string;
  label: string;
  waiting?: string | null;
  muted?: boolean;
  testId?: string;
  onSelect: () => void;
};

type Placed = { hang: SpiralHang; x: number; y: number; dx: number; dy: number; at: number };

const VIEW = 210;
const STROKE = 9;
const DRAW_MS = 1600;
const LEADER_FROM = 9;
const LEADER_TO = 22;
const LABEL_GAP = 26;

export function hangPositions(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0.8];
  const first = 0.52;
  const last = 0.9;
  return Array.from({ length: count }, (_, i) => first + ((last - first) * i) / (count - 1));
}

function outward(x: number, y: number) {
  const n = Math.hypot(x, y) || 1;
  return { dx: x / n, dy: y / n };
}

function anchorX(dx: number) {
  if (dx < -0.2) return '-100%';
  if (dx > 0.2) return '0';
  return '-50%';
}

export function InkSpiral({
  hangs,
  tail,
  size = 300,
  drawn = 1,
  className,
}: {
  hangs: readonly SpiralHang[];
  tail?: SpiralHang;
  size?: number;
  drawn?: number;
  className?: string;
}) {
  const filterId = `ink-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const pathRef = useRef<SVGPathElement | null>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const scale = size / VIEW;

  useLayoutEffect(() => {
    const path = pathRef.current;
    if (path === null || typeof path.getTotalLength !== 'function') return;
    const total = path.getTotalLength();
    const at = hangPositions(hangs.length);
    const rows: Placed[] = hangs.map((hang, i) => {
      const f = at[i] ?? 1;
      const p = path.getPointAtLength(total * f);
      return { hang, x: p.x, y: p.y, ...outward(p.x, p.y), at: f };
    });
    if (tail !== undefined) {
      const p = path.getPointAtLength(total);
      rows.push({ hang: tail, x: p.x, y: p.y, ...outward(p.x, p.y), at: 1 });
    }
    setPlaced(rows);
  }, [hangs, tail]);

  return (
    <div
      data-slot="ink-spiral"
      data-drawn={drawn.toFixed(2)}
      className={cn('relative', className)}
      style={{ width: size, height: size, ['--spiral-rest' as string]: String(1 - drawn) }}
    >
      <svg
        aria-hidden="true"
        width={size}
        height={size}
        viewBox={`${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`}
        className="absolute inset-0 overflow-visible text-content-secondary"
      >
        <defs>
          <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.8"
              numOctaves={2}
              seed={7}
              result="warp"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="warp"
              scale={1.6}
              xChannelSelector="R"
              yChannelSelector="G"
              result="rough"
            />
            <feTurbulence
              type="fractalNoise"
              baseFrequency="1.4"
              numOctaves={1}
              seed={2}
              result="grain"
            />
            <feColorMatrix
              in="grain"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3.2 2.55"
              result="holes"
            />
            <feComposite in="rough" in2="holes" operator="in" />
          </filter>
        </defs>
        <g filter={`url(#${filterId})`}>
          <path
            ref={pathRef}
            d={BRAND_GLYPH.large.d}
            pathLength={1}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            className="spiral-draw"
          />
          {placed.map(({ hang, x, y, dx, dy, at }) => (
            <line
              key={hang.key}
              x1={x + dx * LEADER_FROM}
              y1={y + dy * LEADER_FROM}
              x2={x + dx * LEADER_TO}
              y2={y + dy * LEADER_TO}
              stroke="currentColor"
              strokeWidth={0.9}
              strokeLinecap="round"
              className="ink-hang-in"
              style={{ animationDelay: `${Math.round(at * DRAW_MS)}ms` }}
            />
          ))}
        </g>
      </svg>
      {placed.map(({ hang, x, y, dx, dy, at }) => {
        const style: CSSProperties = {
          left: size / 2 + (x + dx * LABEL_GAP) * scale,
          top: size / 2 + (y + dy * LABEL_GAP) * scale,
          animationDelay: `${Math.round(at * DRAW_MS)}ms`,
          transform: `translate(${anchorX(dx)}, -50%)`,
        };
        return (
          <div key={hang.key} className="ink-hang-in absolute" style={style}>
            <Button
              variant="ghost"
              size="xs"
              data-testid={hang.testId}
              data-waiting={hang.waiting != null ? '' : undefined}
              aria-description={hang.waiting ?? undefined}
              onClick={hang.onSelect}
              className={cn(
                'gap-1.5 px-1 text-meta font-normal whitespace-nowrap hover:bg-transparent hover:text-foreground pointer-coarse:h-11',
                hang.muted === true ? 'text-content-tertiary' : 'text-content-secondary',
              )}
            >
              <span className="relative">
                {hang.label}
                {hang.waiting != null && (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 100 6"
                    preserveAspectRatio="none"
                    className="absolute -bottom-1.5 left-0 h-1.5 w-full"
                  >
                    <path
                      d="M1 4 C 20 1, 35 6, 55 3 S 85 2, 99 4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                )}
              </span>
              {hang.waiting != null && (
                <span
                  aria-hidden="true"
                  className="size-1.5 flex-none rounded-full bg-(--card-button)"
                />
              )}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
