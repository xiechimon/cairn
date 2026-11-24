import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles/shadcn.css', import.meta.url), 'utf8');
const dark = css.slice(css.indexOf(':root {'), css.indexOf('\n.light {'));
const light = css.slice(css.indexOf('\n.light {'));

function hex(name: string, theme = dark): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6}|var\\((--[a-z-]+)\\))`).exec(theme);
  if (match?.[1] == null) throw new Error(`missing ${name}`);
  return match[2] === undefined ? match[1] : hex(match[2], theme);
}

function translucentOver(name: string, base: string, theme = dark): string {
  const match = new RegExp(`${name}:\\s*rgb\\((\\d+) (\\d+) (\\d+) / ([\\d.]+)\\)`).exec(theme);
  if (match == null) throw new Error(`missing ${name}`);
  const alpha = Number(match[4]);
  const channels = [1, 3, 5].map((i, n) => {
    const under = Number.parseInt(base.slice(i, i + 2), 16);
    return Math.round(Number(match[n + 1]) * alpha + under * (1 - alpha));
  });
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function surfaceColor(name: string): string {
  return name === '--border' ? translucentOver(name, hex('--background')) : hex(name);
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
    expect(contrast(hex('--text-tertiary'), surfaceColor(surface))).toBeGreaterThanOrEqual(4.5);
  },
);

it.each([
  { name: 'light', theme: light },
  { name: 'dark', theme: dark },
])('$name warning text reaches 4.5:1 on normal and selected provider rows', ({ theme }) => {
  const card = hex('--card', theme);
  const selected = translucentOver('--sidebar-active', card, theme);
  for (const background of [card, selected]) {
    const ink = hex('--tint-wait-ink', theme);
    const measured = contrast(ink, background);
    expect(measured, `A3: ${ink} on ${background} = ${measured.toFixed(3)}:1`).toBeGreaterThanOrEqual(4.5);
  }
});

it.each([
  { name: 'light', theme: light },
  { name: 'dark', theme: dark },
])('$name provider text reaches 4.5:1 on every row and detail surface', ({ name, theme }) => {
  const card = hex('--card', theme);
  const surfaces = [
    { state: 'normal', color: card },
    { state: 'hover', color: translucentOver('--menu-hover', card, theme) },
    { state: 'selected', color: translucentOver('--sidebar-active', card, theme) },
    { state: 'detail', color: hex('--secondary', theme) },
    { state: 'feedback', color: hex('--popover', theme) },
    { state: 'field', color: name === 'dark' ? translucentColor(hex('--input', theme), card, 0.3) : card },
    { state: 'button hover', color: name === 'dark' ? translucentColor(hex('--input', theme), card, 0.5) : hex('--muted', theme) },
  ];
  for (const token of ['--foreground', '--text-secondary', '--tint-wait-ink']) {
    for (const { state, color } of surfaces) {
      const ink = hex(token, theme);
      const measured = contrast(ink, color);
      expect(measured, `A3: ${name} ${token} on ${state} ${color} = ${measured.toFixed(3)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  }
  const destructive = hex('--destructive', theme);
  for (const background of [card, hex('--popover', theme), translucentColor(destructive, card, name === 'dark' ? 0.2 : 0.1), translucentColor(destructive, card, name === 'dark' ? 0.3 : 0.2)]) {
    const ink = hex('--foreground', theme);
    const measured = contrast(ink, background);
    expect(measured, `A3: ${name} provider removal text on ${background} = ${measured.toFixed(3)}:1`).toBeGreaterThanOrEqual(4.5);
  }
  const primary = hex('--primary', theme);
  for (const background of [primary, translucentColor(primary, card, 0.8)]) {
    expect(contrast(hex('--primary-foreground', theme), background), `A3: ${name} primary button text`).toBeGreaterThanOrEqual(4.5);
  }
});

function translucentColor(ink: string, base: string, alpha: number): string {
  return `#${[1, 3, 5].map((i) => Math.round(Number.parseInt(ink.slice(i, i + 2), 16) * alpha + Number.parseInt(base.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`;
}

it.each([{ name: 'light', theme: light }, { name: 'dark', theme: dark }])('A3: $name Available glyph reaches 3:1 on every provider row background', ({ name, theme }) => {
  const panel = readFileSync(new URL('../src/components/providers/provider-panel.tsx', import.meta.url), 'utf8');
  const token = /const TONE_INK[^]*?ok: 'text-(running(?:-text)?)'/.exec(panel)?.[1];
  expect(token).toBeDefined();
  const ink = hex(`--${token}`, theme);
  const card = hex('--card', theme);
  for (const background of [card, translucentOver('--menu-hover', card, theme), translucentOver('--sidebar-active', card, theme), hex('--popover', theme)]) {
    const measured = contrast(ink, background);
    expect(measured, `A3: ${name} Available ${ink} on ${background} = ${measured.toFixed(3)}:1`).toBeGreaterThanOrEqual(3);
  }
});

it.each([
  { name: 'light', theme: light, destructive: '#9c3627', tertiary: '#4b4d4a', waiting: '#7a5000' },
  { name: 'dark', theme: dark, destructive: '#f09a88', tertiary: '#9c9b98', waiting: '#ebb550' },
])('$name global slots retain the owner-approved colors', ({ theme, destructive, tertiary, waiting }) => {
  expect(hex('--destructive', theme)).toBe(destructive);
  expect(hex('--text-tertiary', theme)).toBe(tertiary);
  expect(hex('--waiting-ink', theme)).toBe(waiting);
});

it('dark surfaces step up in lightness from page to card to popover, so layers read without a stroke', () => {
  const steps = ['--background', '--card', '--popover'].map((name) => hex(name));
  expect(contrast(steps[1] ?? '', steps[0] ?? '')).toBeGreaterThanOrEqual(1.1);
  expect(contrast(steps[2] ?? '', steps[1] ?? '')).toBeGreaterThanOrEqual(1.1);
});

it('the dark tree line reaches 2.5:1 on the page', () => {
  expect(contrast(hex('--tree-line'), hex('--background'))).toBeGreaterThanOrEqual(2.5);
});
