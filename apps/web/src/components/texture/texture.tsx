import { cn } from 'cn';
import { type ReactNode, useEffect, useRef } from 'react';
import { useI18n } from '../../i18n/provider.js';
import {
  driftField,
  paintSpiral,
  paintTones,
  type Rgb,
  SPIRAL_CROPPED,
  SPIRAL_MARK,
  type SpiralFrame,
  sampleCanvas,
  sweepField,
  type TextureFilter,
} from './texture-core.js';

export type TextureTone = 1 | 2 | 3 | 4 | 5 | 6;

type Source =
  | { kind: 'spiral'; frame: SpiralFrame }
  | { kind: 'ramp' }
  | { kind: 'drift'; spanX: number; spanY: number; speed: number }
  | { kind: 'sweep' };

interface TextureLayerProps {
  source: Source;
  filter: TextureFilter;
  cell: number;
  alpha: number;
  bias: number;
  veil: boolean;
  ground: string | null;
  tone: TextureTone;
  inkVar?: string;
  animate: boolean;
  className?: string;
}

const MAX_DPR = 1.6;
const STILL_ELAPSED_MS = 12_500;

function readRgb(host: HTMLElement, cssVar: string): Rgb {
  const probe = document.createElement('span');
  probe.style.color = `var(${cssVar})`;
  probe.style.display = 'none';
  host.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const swatch = document.createElement('canvas');
  swatch.width = 1;
  swatch.height = 1;
  const ctx = swatch.getContext('2d', { willReadFrequently: true });
  if (ctx == null) return [0, 0, 0];
  ctx.fillStyle = resolved;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function TextureLayer({
  source,
  filter,
  cell,
  alpha,
  bias,
  veil,
  ground,
  tone,
  inkVar,
  animate,
  className,
}: TextureLayerProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sourceKey = JSON.stringify(source);
  useEffect(() => {
    const canvas = ref.current;
    if (canvas == null) return;
    const parsed = JSON.parse(sourceKey) as Source;
    let frame = 0;
    let running = false;
    let visible = true;
    const started = performance.now();
    let spiral: HTMLCanvasElement | null = null;

    const draw = (now: number) => {
      const ctx = canvas.getContext('2d');
      if (ctx == null) return;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const box = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(box.width * dpr));
      const height = Math.max(1, Math.round(box.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        spiral = null;
      }
      const dark = !document.documentElement.classList.contains('light');
      const ink = readRgb(
        canvas,
        inkVar ?? (dark ? `--project-ink-${tone}` : `--project-tile-${tone}`),
      );
      const groundRgb = ground == null ? null : readRgb(canvas, ground);
      const font = getComputedStyle(document.documentElement).getPropertyValue('--font-mono');
      const elapsed = running ? now - started : STILL_ELAPSED_MS;
      const t = (elapsed / 1000) * (parsed.kind === 'drift' ? parsed.speed : 1);
      let tones: (col: number, row: number, cols: number, rows: number) => number;
      if (parsed.kind === 'spiral') {
        if (spiral == null) {
          spiral = document.createElement('canvas');
          spiral.width = 240;
          spiral.height = Math.max(1, Math.round((240 * height) / width));
          const sctx = spiral.getContext('2d', { willReadFrequently: true });
          if (sctx != null) paintSpiral(sctx, spiral.width, spiral.height, parsed.frame);
        }
        const source = spiral;
        let grid: ReturnType<typeof sampleCanvas> | null = null;
        tones = (col, row, cols, rows) => {
          if (grid == null || grid.cols !== cols || grid.rows !== rows)
            grid = sampleCanvas(source, cols, rows);
          return grid.at(col, row);
        };
      } else if (parsed.kind === 'drift') {
        tones = (col, row, cols, rows) =>
          driftField((col / cols) * parsed.spanX, (row / rows) * parsed.spanY, t);
      } else if (parsed.kind === 'ramp') {
        tones = (col, row, cols, rows) => 0.15 + 0.7 * (col / cols) * (row / rows);
      } else {
        const phase = ((elapsed / 1600) % 1.4) - 0.2;
        tones = (col, _row, cols) => sweepField(col / cols, phase);
      }
      paintTones(ctx, width, height, tones, {
        filter,
        cell: cell * dpr,
        ink,
        ground: groundRgb,
        alpha,
        bias,
        veil,
        font,
      });
    };

    const loop = (now: number) => {
      draw(now);
      if (running) frame = requestAnimationFrame(loop);
    };
    const sync = () => {
      const want =
        animate && visible && document.visibilityState === 'visible' && !prefersReducedMotion();
      if (want && !running) {
        running = true;
        draw(performance.now());
        frame = requestAnimationFrame(loop);
      } else if (!want && running) {
        running = false;
        cancelAnimationFrame(frame);
      }
      if (!running) draw(performance.now());
    };

    const resize = new ResizeObserver(() => {
      spiral = null;
      if (!running) draw(performance.now());
    });
    resize.observe(canvas);
    const theme = new MutationObserver(() => {
      if (!running) draw(performance.now());
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      sync();
    });
    seen.observe(canvas);
    document.addEventListener('visibilitychange', sync);
    void document.fonts?.ready.then(sync);
    sync();
    return () => {
      running = false;
      cancelAnimationFrame(frame);
      resize.disconnect();
      theme.disconnect();
      seen.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [sourceKey, filter, cell, alpha, bias, veil, ground, tone, inkVar, animate]);
  return (
    <div aria-hidden="true" className={cn('pointer-events-none size-full', className)}>
      <canvas ref={ref} data-slot="texture" data-filter={filter} className="block size-full" />
    </div>
  );
}

export function SpiralArt({
  filter = 'ascii',
  tone = 1,
  className,
  children,
}: {
  filter?: TextureFilter;
  tone?: TextureTone;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-slot="spiral-art"
      className={cn(
        'relative isolate overflow-hidden rounded-(--radius-card) bg-secondary',
        className,
      )}
    >
      <TextureLayer
        source={{ kind: 'spiral', frame: SPIRAL_CROPPED }}
        filter={filter}
        cell={filter === 'ascii' ? 9 : 4}
        alpha={1}
        bias={0}
        veil
        ground="--secondary"
        tone={tone}
        animate={false}
        className="absolute inset-0"
      />
      {children != null && <div className="relative">{children}</div>}
    </div>
  );
}

export function SpiralMark({
  filter = 'dither',
  tone = 1,
  className,
}: {
  filter?: TextureFilter;
  tone?: TextureTone;
  className?: string;
}) {
  return (
    <div
      data-slot="spiral-mark"
      className={cn('h-24 w-40 overflow-hidden rounded-(--radius-control) bg-secondary', className)}
    >
      <TextureLayer
        source={{ kind: 'spiral', frame: SPIRAL_MARK }}
        filter={filter}
        cell={filter === 'ascii' ? 7 : 3}
        alpha={1}
        bias={0}
        veil={false}
        ground="--secondary"
        tone={tone}
        animate={false}
      />
    </div>
  );
}

export function DriftField({
  active,
  filter = 'dither',
  tone = 1,
  className,
}: {
  active: boolean;
  filter?: TextureFilter;
  tone?: TextureTone;
  className?: string;
}) {
  return (
    <div
      data-slot="drift-field"
      data-active={active ? '' : undefined}
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <TextureLayer
        source={{ kind: 'drift', spanX: 7, spanY: 3, speed: 0.32 }}
        filter={filter}
        cell={filter === 'ascii' ? 10 : 6}
        alpha={0.42}
        bias={0.12}
        veil={false}
        ground={null}
        tone={tone}
        animate={active}
      />
      <div className="absolute inset-0 bg-linear-to-b from-transparent via-background/30 to-background" />
    </div>
  );
}

export function DriftEdge({
  active,
  filter = 'dither',
  tone = 1,
  className,
}: {
  active: boolean;
  filter?: TextureFilter;
  tone?: TextureTone;
  className?: string;
}) {
  return (
    <div
      data-slot="drift-edge"
      className={cn(
        'pointer-events-none absolute inset-y-0 right-0 w-2/5 mask-l-from-30% mask-l-to-100%',
        className,
      )}
    >
      <TextureLayer
        source={{ kind: 'drift', spanX: 3, spanY: 1.5, speed: 0.45 }}
        filter={filter}
        cell={filter === 'ascii' ? 8 : 4}
        alpha={0.32}
        bias={0.18}
        veil={false}
        ground={null}
        tone={tone}
        animate={active}
      />
    </div>
  );
}

export function TextureSkeleton({
  filter = 'dither',
  className,
}: {
  filter?: TextureFilter;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      data-slot="texture-skeleton"
      role="status"
      aria-label={t('加载中…')}
      className={cn(
        'h-16 w-full overflow-hidden rounded-(--radius-card) bg-card ring-1 ring-border',
        className,
      )}
    >
      <TextureLayer
        source={{ kind: 'sweep' }}
        filter={filter}
        cell={filter === 'ascii' ? 8 : 4}
        alpha={0.22}
        bias={0}
        veil={false}
        ground={null}
        tone={1}
        animate
      />
    </div>
  );
}

export function TexturedTile({
  letter,
  tone,
  className,
}: {
  letter: string;
  tone: TextureTone;
  className?: string;
}) {
  return (
    <span
      data-slot="textured-tile"
      className={cn(
        'relative inline-grid size-10 flex-none place-items-center overflow-hidden rounded-(--radius-control) text-ui font-semibold text-card',
        TILE_GROUND[tone - 1],
        className,
      )}
    >
      <TextureLayer
        source={{ kind: 'ramp' }}
        filter="dither"
        cell={3}
        alpha={0.55}
        bias={0}
        veil={false}
        ground={null}
        tone={tone}
        inkVar="--card"
        animate={false}
        className="absolute inset-0"
      />
      <span className="relative">{letter}</span>
    </span>
  );
}

const TILE_GROUND = [
  'bg-project-tile-1',
  'bg-project-tile-2',
  'bg-project-tile-3',
  'bg-project-tile-4',
  'bg-project-tile-5',
  'bg-project-tile-6',
] as const;
