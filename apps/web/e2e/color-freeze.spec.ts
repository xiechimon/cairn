import { expect, type Page, test } from '@playwright/test';

const FROZEN_HEX: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    background: '#1f1b18',
    foreground: '#eee8e4',
    card: '#26221f',
    'card-foreground': '#eee8e4',
    popover: '#26221f',
    'popover-foreground': '#eee8e4',
    primary: '#eee8e4',
    'primary-foreground': '#1f1b18',
    secondary: '#2d2926',
    'secondary-foreground': '#eee8e4',
    muted: '#2d2926',
    'muted-foreground': '#b3aeaa',
    accent: '#2d2926',
    'accent-foreground': '#eee8e4',
    destructive: '#ffabb7',
    border: '#2d2926',
    input: '#403c39',
    ring: '#938e8a',
    'card-button': '#f294d8',
    running: '#77d08c',
    'running-text': '#90daa0',
    'running-bar': '#6ac380',
    'running-track': '#2d2926',
    'project-tile-1': '#ff9c75',
    'project-tile-2': '#77d08c',
    'project-tile-3': '#c4b6ab',
    'project-tile-4': '#eea953',
    'project-tile-5': '#f294d8',
    'project-tile-6': '#63c4ff',
  },
  light: {
    canvas: '#f3eee5',
    background: '#fbf9f5',
    foreground: '#2b2620',
    card: '#ffffff',
    'card-foreground': '#2b2620',
    popover: '#ffffff',
    'popover-foreground': '#2b2620',
    primary: '#2b2620',
    'primary-foreground': '#fbf9f5',
    secondary: '#ebe4d8',
    'secondary-foreground': '#2b2620',
    muted: '#ebe4d8',
    'muted-foreground': '#5e564d',
    accent: '#ebe4d8',
    'accent-foreground': '#2b2620',
    destructive: '#9e2c49',
    border: '#ece5da',
    input: '#cbc5c1',
    ring: '#8f8985',
    'text-secondary': '#5e564d',
    'text-tertiary': '#746a5f',
    'card-button': '#b4532a',
    'focus-ring': '#b4532a',
    'spot-text-on-tint': '#8a3a1a',
    running: '#5f8f5a',
    'running-text': '#4f7049',
    'running-bar': '#7ea476',
    'running-track': '#ebe5da',
    'accent-hover': '#f6ebe3',
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
    'drop-tint-border': 'rgb(242 148 216)',
    'drop-tint-base': 'rgb(242 148 216 / 0.05)',
    'drop-tint-hover': 'rgb(242 148 216 / 0.1)',
    'dialog-backdrop': 'rgb(0 0 0 / 0.32)',
  },
  light: {
    // Paper Grouped sidebar: light row hover = DESIGN.md hover (#ebe4d8)
    'sidebar-hover': 'rgb(235 228 216)',
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
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
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
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=01');
    await page.waitForSelector('.board-sidebar');

    const pairs: Array<[string, string]> = [
      ['surface-0', 'var(--background)'],
      ['canvas', theme === 'light' ? '#f3eee5' : 'color-mix(in oklab, var(--background), var(--card) 50%)'],
      ['surface-1', 'var(--canvas)'],
      ['accent-hover', theme === 'light' ? '#f6ebe3' : 'var(--spot-soft)'],
      ['dialog-surface', theme === 'light' ? 'var(--background)' : 'var(--popover)'],
      ['menu-hover', theme === 'light' ? '#f6f2ec' : 'var(--accent)'],
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
  await page.addInitScript(() => localStorage.setItem('pacman-theme', 'light'));
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
  expect(vals.card).toBe('10px');
  expect(vals.cdsMd).toBe('6px');
  expect(vals.shadcnMd).not.toBe('6px');
  expect(vals.shadcnMd.length).toBeGreaterThan(0);
  expect(vals.expo.replace(/0\./g, '.')).toBe('cubic-bezier(.16, 1, .3, 1)');
  expect(vals.hairline.length).toBeGreaterThan(0);
  expect(vals.hairline === '1px' || vals.hairline.startsWith('0.') || vals.hairline.startsWith('calc(')).toBe(true);
});
