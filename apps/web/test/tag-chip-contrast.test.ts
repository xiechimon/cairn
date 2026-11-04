import { readFileSync } from 'node:fs';
import { FIXED_TAGS } from '@cairn/shared';
import { describe, expect, test } from 'vitest';

const css = readFileSync(new URL('../src/styles/shadcn.css', import.meta.url), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf('\n}', start));
}

function token(scope: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(scope);
  if (match?.[1] == null) throw new Error(`missing --${name}`);
  return match[1].trim();
}

function rgb(hex: string): number[] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
}

function luminance(c: number[]): number {
  const [r, g, b] = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

function mix(color: number[], other: number[], share: number): number[] {
  return color.map((v, i) => v * share + (other[i] ?? 0) * (1 - share));
}

const LABELS = [...FIXED_TAGS.map((t) => t.color), '#ffffff', '#000000', '#d73a4a', '#fbca04'];

describe.each([
  ['dark', block(':root')],
  ['light', block('.light')],
])('tag chip text in %s keeps 4.5:1 for every label color', (_theme, scope) => {
  const card = rgb(token(scope, 'card'));
  const ink = rgb(token(scope, 'foreground'));
  const tint = Number.parseFloat(token(scope, 'tag-tint')) / 100;
  const share = Number.parseFloat(token(scope, 'tag-ink')) / 100;
  test.each(LABELS)('%s', (color) => {
    const tag = rgb(color);
    expect(contrast(mix(tag, ink, share), mix(tag, card, tint))).toBeGreaterThanOrEqual(4.5);
  });
});
