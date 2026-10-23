import { expect, type Page, test } from '@playwright/test';

// Issue #122 acceptance: the 外观 segmented row in the user-menu popover
// drives applyTheme — instant repaint via the root .light class, persisted
// under `cairn-theme`, segment aria-checked following the stored value.
// The popover open state is a fixture flag (its open/close trigger lands
// with the overlay ticket), so the row rides scenario 16d, which freezes
// the capture with the menu open. The scheme-aware icon links are asserted
// as markup + asset resolution: which link the browser chrome picks is
// internal to the browser, not observable from page JS — the PR body
// carries the mechanism note.

const ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16d';
const THEME_KEY = 'cairn-theme'; // apps/web/src/theme.ts THEME_STORAGE_KEY

const lightSeg = (page: Page) =>
  page.locator('.user-menu-seg button', { hasText: '浅色' });
const darkSeg = (page: Page) =>
  page.locator('.user-menu-seg button', { hasText: '深色' });

const rootTheme = (page: Page) =>
  page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    light: document.documentElement.classList.contains('light'),
  }));

test('default dark: 深色 active; 浅色 click repaints instantly + persists', async ({ page }) => {
  await page.goto(ROUTE);

  expect(await rootTheme(page)).toEqual({ theme: 'dark', light: false });
  await expect(darkSeg(page)).toHaveAttribute('aria-checked', 'true');
  await expect(lightSeg(page)).toHaveAttribute('aria-checked', 'false');

  await lightSeg(page).click();

  expect(await rootTheme(page)).toEqual({ theme: 'light', light: true });
  await expect(lightSeg(page)).toHaveAttribute('aria-checked', 'true');
  await expect(darkSeg(page)).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe('light');
});

test('selection survives reload', async ({ page }) => {
  await page.goto(ROUTE);
  await lightSeg(page).click();
  expect(await rootTheme(page)).toEqual({ theme: 'light', light: true });

  await page.reload();

  expect(await rootTheme(page)).toEqual({ theme: 'light', light: true });
  await expect(lightSeg(page)).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe('light');

  await darkSeg(page).click();
  await page.reload();
  expect(await rootTheme(page)).toEqual({ theme: 'dark', light: false });
  await expect(darkSeg(page)).toHaveAttribute('aria-checked', 'true');
});

test('injected storage pins the initial segment (storage injection path)', async ({ page }) => {
  // the boot reads the stored value before first paint
  await page.addInitScript((k) => localStorage.setItem(k, 'light'), THEME_KEY);
  await page.goto(ROUTE);

  expect(await rootTheme(page)).toEqual({ theme: 'light', light: true });
  await expect(lightSeg(page)).toHaveAttribute('aria-checked', 'true');
});

test('clicking the active segment is a stable no-op', async ({ page }) => {
  await page.goto(ROUTE);
  await darkSeg(page).click();

  expect(await rootTheme(page)).toEqual({ theme: 'dark', light: false });
  expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe('dark');
  await expect(darkSeg(page)).toHaveAttribute('aria-checked', 'true');
});

// #787 (base-ui-theme F8): the .light flip repaints every token at once —
// applyTheme rides .theme-suppress (motion.css) across the flip so the
// color/background/border/shadow transitions don't smear the page. The
// class must be present for the flip paint and gone two frames later —
// sticking around would kill every transition site-wide.
test('theme flip rides the transition suppression and drops it after the paint', async ({
  page,
}) => {
  await page.goto(ROUTE);
  // Record every class mutation before the flip so the add can't slip past.
  await page.evaluate(() => {
    const seen: string[] = [];
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'class') seen.push(document.documentElement.className);
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    (window as unknown as { __suppressLog: string[] }).__suppressLog = seen;
  });

  await lightSeg(page).click();

  expect(await rootTheme(page)).toEqual({ theme: 'light', light: true });
  const rodeSuppression = await page.evaluate(() =>
    (window as unknown as { __suppressLog: string[] }).__suppressLog.some((c) =>
      c.includes('theme-suppress'),
    ),
  );
  expect(rodeSuppression).toBe(true);
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.classList.contains('theme-suppress')),
    )
    .toBe(false);
});

test('icon + apple-touch-icon carry prefers-color-scheme variants that resolve', async ({
  page,
}) => {
  await page.goto('/app?scenario=01');

  const links = await page.evaluate(() =>
    [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')].map((l) => ({
      rel: l.getAttribute('rel'),
      href: new URL(l.getAttribute('href') ?? '', location.origin).pathname,
      media: l.getAttribute('media'),
    })),
  );
  expect(links).toEqual([
    { rel: 'icon', href: '/logo.svg', media: null },
    { rel: 'icon', href: '/icon-192-dark.png', media: '(prefers-color-scheme: dark)' },
    { rel: 'icon', href: '/icon-192-light.png', media: '(prefers-color-scheme: light)' },
    { rel: 'apple-touch-icon', href: '/icon-192-dark.png', media: '(prefers-color-scheme: dark)' },
    {
      rel: 'apple-touch-icon',
      href: '/icon-192-light.png',
      media: '(prefers-color-scheme: light)',
    },
  ]);

  for (const { href } of links) {
    const res = await page.request.get(href);
    expect(res.ok()).toBe(true);
    expect(res.headers()['content-type']).toContain('image/');
  }
});
