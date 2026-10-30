import { expect, type Page, test } from '@playwright/test';

const FROZEN_HEX: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    canvas: '#0a110e',
    background: '#101814',
    foreground: '#edebe2',
    card: '#18201c',
    'card-foreground': '#edebe2',
    popover: '#1f2924',
    'popover-foreground': '#edebe2',
    primary: '#ebe5cf',
    'primary-foreground': '#0c1f17',
    secondary: '#222b27',
    'secondary-foreground': '#edebe2',
    muted: '#222b27',
    'muted-foreground': '#bcbfb5',
    accent: '#222b27',
    'accent-foreground': '#edebe2',
    destructive: '#f28881',
    border: '#2b3631',
    input: '#3b4540',
    ring: '#e4b65c',
    'text-secondary': '#bcbfb5',
    'text-tertiary': '#9aa198',
    'card-button': '#e4b65c',
    'focus-ring': '#e4b65c',
    'spot-text-on-tint': '#f0d49b',
    running: '#68ca80',
    'running-text': '#8fd89e',
    'running-bar': '#54b66e',
    'running-track': '#2b3631',
    'accent-hover': '#372c19',
    'menu-hover': '#26312c',
    'project-tile-1': '#89bb7e',
    'project-tile-2': '#dcaf61',
    'project-tile-3': '#89afd6',
    'project-tile-4': '#e5946f',
    'project-tile-5': '#c293bd',
    'project-tile-6': '#69bbba',
  },
  light: {
    canvas: '#f1f0eb',
    background: '#f9f8f4',
    foreground: '#14261e',
    card: '#fefefb',
    'card-foreground': '#14261e',
    popover: '#fefefb',
    'popover-foreground': '#14261e',
    primary: '#143e2e',
    'primary-foreground': '#f7f2e2',
    secondary: '#edebe5',
    'secondary-foreground': '#14261e',
    muted: '#edebe5',
    'muted-foreground': '#465048',
    accent: '#edebe5',
    'accent-foreground': '#14261e',
    destructive: '#b6322d',
    border: '#dfded7',
    input: '#cccbc2',
    ring: '#205943',
    'text-secondary': '#465048',
    'text-tertiary': '#666b62',
    'card-button': '#926300',
    'focus-ring': '#205943',
    'spot-text-on-tint': '#6b4300',
    running: '#348f4f',
    'running-text': '#206b38',
    'running-bar': '#40a35c',
    'running-track': '#dfded7',
    'accent-hover': '#fbf4e4',
    'menu-hover': '#f1f0eb',
    'project-tile-1': '#46703d',
    'project-tile-2': '#8a5f18',
    'project-tile-3': '#496684',
    'project-tile-4': '#9d5035',
    'project-tile-5': '#774c73',
    'project-tile-6': '#287070',
  },
};

const FROZEN_RGB: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    'sidebar-hover': 'rgb(235 245 238 / 0.05)',
    'sidebar-active': 'rgb(235 245 238 / 0.09)',
    'dialog-backdrop': 'rgb(0 0 0 / 0.45)',
  },
  light: {
    'sidebar-hover': '#e8e6e0',
    'sidebar-active': '#d9e3da',
    'dialog-backdrop': 'rgb(16 32 26 / 0.18)',
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
      ['canvas', theme === 'light' ? '#f1f0eb' : '#0a110e'],
      ['surface-1', 'var(--canvas)'],
      ['accent-hover', theme === 'light' ? '#fbf4e4' : '#372c19'],
      ['dialog-surface', theme === 'light' ? 'var(--background)' : 'var(--popover)'],
      ['menu-hover', theme === 'light' ? '#f1f0eb' : '#26312c'],
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
  expect(vals.composer).toBe('20px');
  expect(vals.bubble).toBe('18px');
  expect(vals.sidebar).toBe('248px');
  expect(vals.chat).toBe('768px');
  expect(vals.edge).toBe('16px');
  expect(vals.card).toBe('20px');
  expect(vals.cdsMd).toBe('6px');
  expect(vals.shadcnMd).not.toBe('6px');
  expect(vals.shadcnMd.length).toBeGreaterThan(0);
  expect(vals.expo.replace(/0\./g, '.')).toBe('cubic-bezier(.16, 1, .3, 1)');
  expect(vals.hairline.length).toBeGreaterThan(0);
  expect(vals.hairline === '1px' || vals.hairline.startsWith('0.') || vals.hairline.startsWith('calc(')).toBe(true);
});
