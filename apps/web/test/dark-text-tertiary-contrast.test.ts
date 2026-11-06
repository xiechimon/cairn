import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles/shadcn.css', import.meta.url), 'utf8');
const dark = css.slice(css.indexOf(':root {'), css.indexOf('\n.light {'));

function hex(name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`).exec(dark);
  if (match?.[1] == null) throw new Error(`missing ${name}`);
  return match[1];
}

function luminance(color: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(color.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

it.each(['--background', '--surface-tertiary', '--accent', '--border'])(
  'dark tertiary text reaches 4.5:1 on %s',
  (surface) => {
    expect(contrast(hex('--text-tertiary'), hex(surface))).toBeGreaterThanOrEqual(4.5);
  },
);
