import { expect, type Page, test } from '@playwright/test';

const FROZEN_HEX: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    // Paper dark (DESIGN.md colors-dark, #1396): elevation = lighter
    canvas: '#1a1612',
    background: '#24201b',
    foreground: '#ece7df',
    card: '#2f2a26',
    'card-foreground': '#ece7df',
    popover: '#37322d',
    'popover-foreground': '#ece7df',
    primary: '#ece7df',
    'primary-foreground': '#24201b',
    secondary: '#3c3732',
    'secondary-foreground': '#ece7df',
    muted: '#3c3732',
    'muted-foreground': '#c5c0b9',
    accent: '#3c3732',
    'accent-foreground': '#ece7df',
    destructive: '#ffabb7',
    border: '#3e3a34',
    input: '#514c47',
    ring: '#837f7b',
    'text-secondary': '#c5c0b9',
    'text-tertiary': '#aca7a0',
    'card-button': '#f0926d',
    'focus-ring': '#f0926d',
    'spot-text-on-tint': '#fbc3a7',
    running: '#7fb980',
    'running-text': '#99ce9a',
    'running-bar': '#70a971',
    'running-track': '#3e3a34',
    'accent-hover': '#46362f',
    'menu-hover': '#403b36',
    'project-tile-1': '#da8f72',
    'project-tile-2': '#9eac76',
    'project-tile-3': '#8ba8c6',
    'project-tile-4': '#cca26e',
    'project-tile-5': '#b19ac4',
    'project-tile-6': '#6eb3b2',
  },
  light: {
    canvas: '#efe6d0',
    background: '#f7f1e1',
    foreground: '#1b2b24',
    card: '#fffdf6',
    'card-foreground': '#1b2b24',
    popover: '#fffdf6',
    'popover-foreground': '#2b2620',
    primary: '#173a2f',
    'primary-foreground': '#f2ead7',
    secondary: '#e8dec5',
    'secondary-foreground': '#2b2620',
    muted: '#e8dec5',
    'muted-foreground': '#5e564d',
    accent: '#e8dec5',
    'accent-foreground': '#2b2620',
    destructive: '#9e2c49',
    border: '#e2d8bf',
    input: '#cbc5c1',
    ring: '#8f8985',
    'text-secondary': '#5e564d',
    'text-tertiary': '#6f6558',
    'card-button': '#173a2f',
    'focus-ring': '#173a2f',
    'spot-text-on-tint': '#173a2f',
    running: '#5f8f5a',
    'running-text': '#4f7049',
    'running-bar': '#7ea476',
    'running-track': '#ebe5da',
    'accent-hover': '#ece3cc',
    'menu-hover': '#f6f2ec',
    'project-tile-1': '#c06a43',
    'project-tile-2': '#7d8b5a',
    'project-tile-3': '#6b7a8f',
    'project-tile-4': '#a0784a',
    'project-tile-5': '#8a6a9a',
    'project-tile-6': '#4f8a8b',
  },
};

const FROZEN_RGB: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    'sidebar-hover': 'rgb(255 252 248 / 0.05)',
    'sidebar-active': 'rgb(255 252 248 / 0.1)',
    'drop-tint-border': 'rgb(240 146 109)',
    'drop-tint-base': 'rgb(240 146 109 / 0.05)',
    'drop-tint-hover': 'rgb(240 146 109 / 0.1)',
    'dialog-backdrop': 'rgb(0 0 0 / 0.45)',
  },
  light: {
    // Paper Grouped sidebar: light row hover = DESIGN.md hover (#e8dec5)
    'sidebar-hover': 'rgb(232, 222, 197)',
    'sidebar-active': 'rgb(28 25 21 / 0.1)',
    'drop-tint-border': 'rgb(180 83 42)',
    'drop-tint-base': 'rgb(180 83 42 / 0.05)',
    'drop-tint-hover': 'rgb(180 83 42 / 0.1)',
    'dialog-backdrop': 'rgb(43 38 32 / 0.14)',
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
      ['canvas', theme === 'light' ? '#efe6d0' : '#1a1612'],
      ['surface-1', 'var(--canvas)'],
      ['accent-hover', theme === 'light' ? '#ece3cc' : '#46362f'],
      ['dialog-surface', theme === 'light' ? 'var(--background)' : 'var(--popover)'],
      ['menu-hover', theme === 'light' ? '#f6f2ec' : '#403b36'],
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
