import { BRAND_MARK_PATH, BRAND_MARK_VIEWBOX } from '../../lib/brand-mark.js';

export type TextureFilter = 'ascii' | 'dither';

export type Rgb = readonly [number, number, number];

export const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

export const ASCII_RAMP = '  .,:;-=+xX08S#&@';

export function bayerThreshold(col: number, row: number): number {
  const line = BAYER_4[((row % 4) + 4) % 4] ?? BAYER_4[0];
  return ((line[((col % 4) + 4) % 4] ?? 0) + 0.5) / 16;
}

export function asciiGlyph(tone: number): string {
  const clamped = Math.min(1, Math.max(0, tone));
  return ASCII_RAMP[Math.round(clamped * (ASCII_RAMP.length - 1))] ?? ' ';
}

export function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function driftField(x: number, y: number, t: number): number {
  const swirl = Math.hypot(x - 3 + Math.sin(t * 0.2), y - 2) * 1.6 - t * 0.8;
  return (
    (Math.sin(x * 0.9 + t * 0.6) +
      Math.sin(y * 1.3 - t * 0.4) +
      Math.sin((x + y) * 0.7 + t * 0.3) +
      Math.sin(swirl)) /
      8 +
    0.5
  );
}

export function sweepField(x: number, phase: number): number {
  return Math.max(0, 1 - Math.abs(x - phase) * 3.2) * 0.85;
}

export interface SpiralFrame {
  cx: number;
  cy: number;
  scale: number;
  rotate: number;
  grow: boolean;
}

export const SPIRAL_CROPPED: SpiralFrame = {
  cx: 0.36,
  cy: 0.66,
  scale: 1.9,
  rotate: -0.35,
  grow: true,
};
export const SPIRAL_MARK: SpiralFrame = { cx: 0.5, cy: 0.52, scale: 0.92, rotate: 0, grow: false };

export function paintSpiral(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  frame: SpiralFrame,
): void {
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);
  const [x, y, size] = BRAND_MARK_VIEWBOX;
  const k = (Math.min(width, height) * frame.scale) / size / 1.28;
  const mark = new Path2D(BRAND_MARK_PATH);
  ctx.save();
  ctx.translate(width * frame.cx, height * frame.cy);
  ctx.rotate(frame.rotate);
  ctx.scale(k, k);
  ctx.translate(-(x + size / 2), -(y + size / 2));
  if (frame.grow) {
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgb(0 0 0 / 0.14)';
    ctx.lineWidth = size * 0.07;
    ctx.stroke(mark);
  }
  ctx.fillStyle = 'rgb(0 0 0 / 0.95)';
  ctx.fill(mark);
  ctx.restore();
}

export interface ToneGrid {
  cols: number;
  rows: number;
  at(col: number, row: number): number;
}

export function sampleCanvas(source: HTMLCanvasElement, cols: number, rows: number): ToneGrid {
  const ctx = source.getContext('2d');
  const data = ctx?.getImageData(0, 0, source.width, source.height).data;
  return {
    cols,
    rows,
    at(col, row) {
      if (data == null) return 0;
      const sx = Math.min(source.width - 1, Math.floor(((col + 0.5) / cols) * source.width));
      const sy = Math.min(source.height - 1, Math.floor(((row + 0.5) / rows) * source.height));
      const i = (sy * source.width + sx) * 4;
      return 1 - luminance(data[i] ?? 255, data[i + 1] ?? 255, data[i + 2] ?? 255);
    },
  };
}

export interface PaintOptions {
  filter: TextureFilter;
  cell: number;
  ink: Rgb;
  ground: Rgb | null;
  alpha: number;
  bias: number;
  veil: boolean;
  font: string;
}

export function veilAt(rowRatio: number): number {
  const fadeOut = Math.max(0, 1 - Math.max(0, rowRatio - 0.5) / 0.32);
  return fadeOut * (0.45 + 0.55 * Math.min(1, rowRatio * 2));
}

export function paintTones(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  tone: (col: number, row: number, cols: number, rows: number) => number,
  options: PaintOptions,
): void {
  const { filter, cell, ink, ground, alpha, bias, veil } = options;
  if (ground == null) ctx.clearRect(0, 0, width, height);
  else {
    ctx.fillStyle = `rgb(${ground[0]} ${ground[1]} ${ground[2]})`;
    ctx.fillRect(0, 0, width, height);
  }
  const stepX = filter === 'ascii' ? cell * 0.72 : cell;
  const stepY = filter === 'ascii' ? cell * 1.05 : cell;
  const cols = Math.ceil(width / stepX);
  const rows = Math.ceil(height / stepY);
  if (filter === 'ascii') {
    ctx.font = `${cell}px ${options.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
  }
  for (let row = 0; row < rows; row += 1) {
    const shade = veil ? veilAt(row / rows) : 1;
    if (shade <= 0) continue;
    for (let col = 0; col < cols; col += 1) {
      const value = tone(col, row, cols, rows);
      if (filter === 'dither') {
        if (value <= bayerThreshold(col, row) + bias) continue;
        ctx.fillStyle = `rgb(${ink[0]} ${ink[1]} ${ink[2]} / ${alpha * shade})`;
        ctx.fillRect(col * stepX, row * stepY, stepX - 1, stepY - 1);
      } else {
        const t = Math.max(0, Math.min(1, (value - bias - 0.08) / 0.8));
        if (t <= 0.03) continue;
        const glyph = asciiGlyph(t);
        if (glyph === ' ') continue;
        ctx.fillStyle = `rgb(${ink[0]} ${ink[1]} ${ink[2]} / ${(0.18 + 0.7 * t) * alpha * shade})`;
        ctx.fillText(glyph, col * stepX + stepX / 2, row * stepY + stepY / 2);
      }
    }
  }
}
