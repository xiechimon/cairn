export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

let probe: HTMLDivElement | null = null;
let pixel: CanvasRenderingContext2D | null = null;

function probeElement(): HTMLDivElement {
  if (probe == null) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:-9999px';
    document.body.append(probe);
  }
  return probe;
}

export function computedColor(expr: string): string {
  const el = probeElement();
  el.style.color = '';
  el.style.color = expr;
  return getComputedStyle(el).color;
}

export function computedLength(expr: string): string {
  const el = probeElement();
  el.style.width = expr;
  return getComputedStyle(el).width;
}

export function rgba(expr: string): Rgba {
  if (pixel == null) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    pixel = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (pixel == null) return { r: 0, g: 0, b: 0, a: 1 };
  pixel.clearRect(0, 0, 1, 1);
  pixel.fillStyle = computedColor(expr);
  pixel.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 255] = pixel.getImageData(0, 0, 1, 1).data;
  return { r, g, b, a: a / 255 };
}

export function over(fg: Rgba, bg: Rgba): Rgba {
  if (fg.a >= 0.999) return fg;
  const mix = (f: number, b: number) => Math.round(f * fg.a + b * (1 - fg.a));
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

export function toHex({ r, g, b }: Rgba): string {
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

export function tokenHex(cssVar: string): string {
  return toHex(rgba(`var(${cssVar})`));
}

export function rawToken(cssVar: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
}
