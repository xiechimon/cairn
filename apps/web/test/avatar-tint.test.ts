import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { avatarInitial, avatarTint } from '../src/lib/avatar-tint.js';

const TINTS = ['#3f6c35', '#9a6b3a', '#5379a0', '#7a5b8e', '#3d7c7a', '#8a5560'];
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

describe('avatarTint', () => {
  test('gives one person the same colour every time, from the six tints', () => {
    expect(avatarTint('r3-builder')).toBe(avatarTint('r3-builder'));
    for (const name of ['chief', 'coder-1', 'reviewer', 'Xmon Dai', '小林', ''])
      expect(TINTS).toContain(avatarTint(name));
  });

  test('keeps the colour each name had on its spiral disc', () => {
    expect(avatarTint('r3-builder')).toBe('#7a5b8e');
    expect(avatarTint('Xmon Dai')).toBe('#3f6c35');
  });
});

describe('avatarInitial', () => {
  test.each([
    ['ian', 'I'],
    ['  r5-scribe', 'R'],
    ['小林', '小'],
    ['Étienne', 'É'],
    ['👩‍🚀 crew', '👩‍🚀'],
    ['   ', ''],
  ])('%j starts with %j', (name, initial) => {
    expect(avatarInitial(name)).toBe(initial);
  });
});

describe.each([
  ['dark', block(':root')],
  ['light', block('.light')],
])('the initial in %s keeps 4.5:1 on its tint for every colour', (_theme, scope) => {
  const ink = rgb(token(scope, 'foreground'));
  const tint = Number.parseFloat(token(scope, 'avatar-tint')) / 100;
  const share = Number.parseFloat(token(scope, 'avatar-ink')) / 100;
  describe.each(['background', 'card'])('on %s', (surface) => {
    const under = rgb(token(scope, surface));
    test.each(TINTS)('%s', (color) => {
      const hue = rgb(color);
      expect(contrast(mix(hue, ink, share), mix(hue, under, tint))).toBeGreaterThanOrEqual(4.5);
    });
  });
});
