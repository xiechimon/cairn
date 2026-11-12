import { expect, type Page, test } from '@playwright/test';

const FROZEN_HEX: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    canvas: '#1f1f1f',
    background: '#191919',
    foreground: '#f7f7f7',
    card: '#202020',
    'card-foreground': '#f7f7f7',
    popover: '#303030',
    'popover-foreground': '#f7f7f7',
    primary: '#f7f7f7',
    'primary-foreground': '#191919',
    secondary: '#262626',
    'secondary-foreground': '#f7f7f7',
    muted: '#262626',
    'muted-foreground': '#c4c4c4',
    accent: '#262626',
    'accent-foreground': '#f7f7f7',
    destructive: '#f09a88',
    input: '#6b6b6b',
    ring: '#ebb550',
    'text-secondary': '#c4c4c4',
    'text-tertiary': '#a3a3a3',
    'card-button': '#ebb550',
    'focus-ring': '#ebb550',
    'spot-text-on-tint': '#f2cf86',
    running: '#82b46f',
    'running-text': '#9cc78b',
    'running-bar': '#6fa35c',
    'running-track': '#2a2a2a',
    'accent-hover': '#33290f',
  },
  light: {
    canvas: '#fafafa',
    background: '#ffffff',
    foreground: '#0a0a0a',
    card: '#f7f7f7',
    'card-foreground': '#0a0a0a',
    popover: '#ffffff',
    'popover-foreground': '#0a0a0a',
    primary: '#0a0a0a',
    'primary-foreground': '#ffffff',
    secondary: '#f2f2f2',
    'secondary-foreground': '#0a0a0a',
    muted: '#f2f2f2',
    'muted-foreground': '#3a3a3a',
    accent: '#f2f2f2',
    'accent-foreground': '#0a0a0a',
    destructive: '#a33a2a',
    input: '#c7c7c7',
    ring: '#9a6500',
    'text-secondary': '#3a3a3a',
    'text-tertiary': '#545454',
    'card-button': '#9a6500',
    'focus-ring': '#9a6500',
    'spot-text-on-tint': '#6e4900',
    running: '#5f8f4f',
    'running-text': '#3f6c35',
    'running-bar': '#55833f',
    'running-track': '#ebebeb',
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
      ['canvas', theme === 'light' ? '#fafafa' : '#1f1f1f'],
      ['surface-1', 'var(--canvas)'],
      ['accent-hover', theme === 'light' ? '#f7ecd2' : '#33290f'],
      ['dialog-surface', theme === 'light' ? 'var(--background)' : 'var(--canvas)'],
      ['menu-hover', theme === 'light' ? 'rgb(0 0 0 / 0.05)' : 'rgb(255 255 255 / 0.075)'],
      ['hover-1', 'var(--sidebar-hover)'],
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
