import { expect, type Page, test } from '@playwright/test';

const FROZEN_HEX: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    canvas: '#141715',
    background: '#1b1f1c',
    foreground: '#e6e8e2',
    card: '#222723',
    'card-foreground': '#e6e8e2',
    popover: '#262b27',
    'popover-foreground': '#e6e8e2',
    primary: '#e6e8e2',
    'primary-foreground': '#161a17',
    secondary: '#2a302b',
    'secondary-foreground': '#e6e8e2',
    muted: '#2a302b',
    'muted-foreground': '#b4bab3',
    accent: '#2a302b',
    'accent-foreground': '#e6e8e2',
    destructive: '#f09a88',
    border: '#353b36',
    input: '#6b726c',
    ring: '#9cc78b',
    'text-secondary': '#b4bab3',
    'text-tertiary': '#959c96',
    'card-button': '#ebb550',
    'focus-ring': '#9cc78b',
    'spot-text-on-tint': '#f2cf86',
    running: '#82b46f',
    'running-text': '#9cc78b',
    'running-bar': '#6fa35c',
    'running-track': '#2e3430',
    'accent-hover': '#33290f',
    'project-tile-1': '#6f9c5f',
    'project-tile-2': '#b98a57',
    'project-tile-3': '#6f93bb',
    'project-tile-4': '#9a7cad',
    'project-tile-5': '#5fa3a0',
    'project-tile-6': '#b77f8a',
  },
  light: {
    canvas: '#e6e7e1',
    background: '#f6f6f2',
    foreground: '#1d231f',
    card: '#fdfdfb',
    'card-foreground': '#1d231f',
    popover: '#fdfdfb',
    'popover-foreground': '#1d231f',
    primary: '#233127',
    'primary-foreground': '#f4f6f1',
    secondary: '#eceee8',
    'secondary-foreground': '#1d231f',
    muted: '#eceee8',
    'muted-foreground': '#4b534d',
    accent: '#eceee8',
    'accent-foreground': '#1d231f',
    destructive: '#a33a2a',
    border: '#dcdfd7',
    input: '#ccd0c7',
    ring: '#3f6c35',
    'text-secondary': '#4b534d',
    'text-tertiary': '#5f665f',
    'card-button': '#9a6500',
    'focus-ring': '#3f6c35',
    'spot-text-on-tint': '#6e4900',
    running: '#5f8f4f',
    'running-text': '#3f6c35',
    'running-bar': '#55833f',
    'running-track': '#e1e3dc',
    'accent-hover': '#f7ecd2',
    'project-tile-1': '#3f6c35',
    'project-tile-2': '#9a6b3a',
    'project-tile-3': '#5379a0',
    'project-tile-4': '#7a5b8e',
    'project-tile-5': '#3d7c7a',
    'project-tile-6': '#8a5560',
  },
};

const FROZEN_RGB: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    'sidebar-hover': 'rgb(230 232 226 / 0.05)',
    'sidebar-active': 'rgb(230 232 226 / 0.09)',
    'dialog-backdrop': 'rgb(0 0 0 / 0.5)',
  },
  light: {
    'sidebar-hover': '#dcded7',
    'sidebar-active': '#d2d6cc',
    'dialog-backdrop': 'rgb(29 35 31 / 0.28)',
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
      ['surface-0', 'var(--background)'],
      ['canvas', theme === 'light' ? '#e6e7e1' : '#141715'],
      ['surface-1', 'var(--canvas)'],
      ['accent-hover', theme === 'light' ? '#f7ecd2' : '#33290f'],
      ['dialog-surface', 'var(--background)'],
      ['menu-hover', theme === 'light' ? 'rgb(29 35 31 / 0.1)' : 'rgb(230 232 226 / 0.1)'],
      ['drop-tint-border', 'var(--card-button)'],
      ['drop-tint-base', 'color-mix(in srgb, var(--card-button) 5%, transparent)'],
      ['drop-tint-hover', 'color-mix(in srgb, var(--card-button) 10%, transparent)'],
      ['surface-2', 'var(--card)'],
      ['surface-3', 'var(--popover)'],
      ['hover-1', 'color-mix(in oklab, var(--foreground) 5%, transparent)'],
      ['hover-2', 'color-mix(in oklab, var(--foreground) 10%, transparent)'],
      ['border-soft', 'color-mix(in oklab, var(--foreground) 9%, transparent)'],
      ['ring-inset-highlight', 'color-mix(in oklab, var(--foreground) 10%, transparent)'],
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
  expect(vals.bubble).toBe('14px');
  expect(vals.sidebar).toBe('248px');
  expect(vals.chat).toBe('768px');
  expect(vals.edge).toBe('18px');
  expect(vals.card).toBe('14px');
  expect(vals.cdsMd).toBe('6px');
  expect(vals.shadcnMd.length).toBeGreaterThan(0);
  expect(vals.expo.replace(/0\./g, '.')).toBe('cubic-bezier(.16, 1, .3, 1)');
  expect(vals.hairline.length).toBeGreaterThan(0);
  expect(vals.hairline === '1px' || vals.hairline.startsWith('0.') || vals.hairline.startsWith('calc(')).toBe(true);
});
