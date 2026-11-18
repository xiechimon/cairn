import { expect, type Page, test } from '@playwright/test';

const FROZEN_HEX: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    canvas: '#1b1c1b',
    background: '#151615',
    foreground: '#ecebe6',
    card: '#1c1d1c',
    'card-foreground': '#ecebe6',
    popover: '#2c2d2c',
    'popover-foreground': '#ecebe6',
    primary: '#ecebe6',
    'primary-foreground': '#151615',
    secondary: '#222322',
    'secondary-foreground': '#ecebe6',
    muted: '#222322',
    'muted-foreground': '#bbbab7',
    accent: '#222322',
    'accent-foreground': '#ecebe6',
    destructive: '#f09a88',
    input: '#676867',
    ring: '#ebb550',
    'text-secondary': '#bbbab7',
    'text-tertiary': '#9c9b98',
    'card-button': '#ebb550',
    'focus-ring': '#ebb550',
    'spot-text-on-tint': '#f2cf86',
    running: '#82b46f',
    'running-text': '#9cc78b',
    'running-bar': '#6fa35c',
    'running-track': '#262726',
    'accent-hover': '#33290f',
  },
  light: {
    canvas: '#e7e6e1',
    background: '#ecebe6',
    foreground: '#1c1d1b',
    card: '#e5e4df',
    'card-foreground': '#1c1d1b',
    popover: '#f8f7f3',
    'popover-foreground': '#1c1d1b',
    primary: '#1c1d1b',
    'primary-foreground': '#ecebe6',
    secondary: '#e0dfda',
    'secondary-foreground': '#1c1d1b',
    muted: '#e0dfda',
    'muted-foreground': '#343633',
    accent: '#e0dfda',
    'accent-foreground': '#1c1d1b',
    destructive: '#9c3627',
    input: '#b8b7b3',
    ring: '#9a6500',
    'text-secondary': '#343633',
    'text-tertiary': '#4b4d4a',
    'card-button': '#9a6500',
    'focus-ring': '#9a6500',
    'spot-text-on-tint': '#6e4900',
    running: '#5f8f4f',
    'running-text': '#3f6c35',
    'running-bar': '#55833f',
    'running-track': '#d9d9d4',
    'accent-hover': '#f7ecd2',
  },
};

const FROZEN_RGB: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    'sidebar-hover': 'rgb(255 255 255 / 0.075)',
    'sidebar-active': 'rgb(255 255 255 / 0.15)',
    'dialog-backdrop': 'rgb(0 0 0 / 0.5)',
    border: 'rgb(255 255 255 / 0.1)',
  },
  light: {
    'sidebar-hover': 'rgb(0 0 0 / 0.06)',
    'sidebar-active': 'rgb(0 0 0 / 0.12)',
    'dialog-backdrop': 'rgb(0 0 0 / 0.4)',
    border: 'rgb(0 0 0 / 0.1)',
  },
};

async function resolveColor(page: Page, value: string): Promise<string> {
  return page.evaluate((v) => {
    const el = document.createElement('div');
    el.style.backgroundColor = v;
    document.body.append(el);
    const out = getComputedStyle(el).backgroundColor;
    el.remove();
    return out;
  }, value);
}

async function tokenColor(page: Page, name: string): Promise<string> {
  return resolveColor(page, `var(--${name})`);
}

for (const theme of ['light', 'dark'] as const) {
  test(`frozen color slots stay put (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01');
    await page.waitForSelector('.board-sidebar');

    for (const [name, hex] of Object.entries(FROZEN_HEX[theme])) {
      const got = await tokenColor(page, name);
      const want = await resolveColor(page, hex);
      expect(got, name).toBe(want);
    }

    for (const [name, rgb] of Object.entries(FROZEN_RGB[theme])) {
      const got = await tokenColor(page, name);
      const want = await resolveColor(page, rgb);
      expect(got, name).toBe(want);
    }
  });

  test(`derived mix tokens resolve from existing slots (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01');
    await page.waitForSelector('.board-sidebar');

    const pairs: Array<[string, string]> = [
      ['canvas', theme === 'light' ? '#e7e6e1' : '#1b1c1b'],
      ['surface-1', 'var(--canvas)'],
      ['accent-hover', theme === 'light' ? '#f7ecd2' : '#33290f'],
      ['dialog-surface', theme === 'light' ? 'var(--background)' : 'var(--canvas)'],
      ['menu-hover', theme === 'light' ? 'rgb(0 0 0 / 0.05)' : 'rgb(255 255 255 / 0.075)'],
      ['hover-1', 'var(--sidebar-hover)'],
      ['border-soft', 'color-mix(in oklab, var(--foreground) 9%, transparent)'],
    ];
    for (const [name, formula] of pairs) {
      const got = await tokenColor(page, name);
      const want = await resolveColor(page, formula);
      expect(got, name).toBe(want);
    }
  });
}

test('CDS structural tokens land at locked mon values', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
  await page.goto('/app?scenario=01');
  await page.waitForSelector('.board-sidebar');
  const vals = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      composer: cs.getPropertyValue('--radius-composer').trim(),
      bubble: cs.getPropertyValue('--radius-bubble').trim(),
      sidebar: cs.getPropertyValue('--sidebar-w').trim(),
      chat: cs.getPropertyValue('--chat-max-w').trim(),
      edge: cs.getPropertyValue('--edge-radius').trim(),
      card: cs.getPropertyValue('--radius-card').trim(),
      cdsMd: cs.getPropertyValue('--cds-radius-md').trim(),
      shadcnMd: cs.getPropertyValue('--radius-md').trim(),
      expo: cs.getPropertyValue('--ease-out-expo').trim(),
      hairline: cs.getPropertyValue('--hairline').trim(),
    };
  });
  expect(vals.composer).toBe('14px');
  expect(vals.bubble).toBe('18px');
  expect(vals.sidebar).toBe('220px');
  expect(vals.chat).toBe('768px');
  expect(vals.edge).toBe('12px');
  expect(vals.card).toBe('12px');
  expect(vals.cdsMd).toBe('6px');
  expect(vals.shadcnMd.length).toBeGreaterThan(0);
  expect(vals.expo.replace(/0\./g, '.')).toBe('cubic-bezier(.16, 1, .3, 1)');
  expect(vals.hairline.length).toBeGreaterThan(0);
  expect(vals.hairline === '1px' || vals.hairline.startsWith('0.') || vals.hairline.startsWith('calc(')).toBe(true);
});
