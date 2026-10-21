import { expect, type Page, test } from '@playwright/test';

// #1430: the browser chrome color (<meta name="theme-color">) and the boot
// skeleton carry the Paper tokens. index.html scopes the two metas by
// prefers-color-scheme, so the first frame follows the system scheme; the
// applyTheme call at boot then rewrites both to the stored choice, which can
// differ from the system scheme.

const ROUTE = '/app?scenario=01';
const THEME_KEY = 'pacman-theme'; // apps/web/src/theme.ts THEME_STORAGE_KEY
const LIGHT_CHROME = '#f3eee5';
const DARK_CHROME = '#1f1b18';

const themeColors = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content')),
  );

// The metas the browser would consider right now: a media-less meta always
// counts, a media-scoped one counts when its query matches the system scheme.
const effectiveThemeColors = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('meta[name="theme-color"]')]
      .filter((m) => {
        const media = m.getAttribute('media');
        return media === null || matchMedia(media).matches;
      })
      .map((m) => m.getAttribute('content')),
  );

test('index.html ships a light and a dark theme-color, each scoped to its scheme', async ({
  page,
}) => {
  const html = await page.request.get(ROUTE).then((r) => r.text());

  const shipped = await page.evaluate(
    (source) =>
      [
        ...new DOMParser()
          .parseFromString(source, 'text/html')
          .querySelectorAll('meta[name="theme-color"]'),
      ].map((m) => ({ content: m.getAttribute('content'), media: m.getAttribute('media') })),
    html,
  );

  expect(shipped).toEqual([
    { content: LIGHT_CHROME, media: '(prefers-color-scheme: light)' },
    { content: DARK_CHROME, media: '(prefers-color-scheme: dark)' },
  ]);
});

test('theme-color follows the stored theme across reloads', async ({ page }) => {
  await page.goto(ROUTE);

  for (const [theme, color] of [
    ['light', LIGHT_CHROME],
    ['dark', DARK_CHROME],
  ] as const) {
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [THEME_KEY, theme]);
    await page.reload();
    await expect.poll(() => themeColors(page)).toEqual([color, color]);
  }
});

// The user-menu segments drive applyTheme in place, with no reload (same route
// and scenario as theme-toggle.spec.ts).
test('a live theme switch in the user menu rewrites theme-color without a reload', async ({
  page,
}) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16d');

  await page.locator('.user-menu-seg button', { hasText: '浅色' }).click();
  await expect.poll(() => themeColors(page)).toEqual([LIGHT_CHROME, LIGHT_CHROME]);

  await page.locator('.user-menu-seg button', { hasText: '深色' }).click();
  await expect.poll(() => themeColors(page)).toEqual([DARK_CHROME, DARK_CHROME]);
});

test('stored theme wins over the system scheme for the browser chrome color', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(ROUTE);
  await page.evaluate((k) => localStorage.setItem(k, 'dark'), THEME_KEY);
  await page.reload();

  expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches)).toBe(
    true,
  );
  await expect.poll(() => effectiveThemeColors(page)).toEqual([DARK_CHROME]);
});

async function bootSkeletonPaint(page: Page, theme: 'light' | 'dark') {
  await page.route(/\/assets\/.+\.js(\?|$)/, (route) => route.abort());
  await page.addInitScript(([k, t]) => localStorage.setItem(k, t), [THEME_KEY, theme]);
  await page.goto(ROUTE);

  return page.evaluate(() => {
    const boot = document.getElementById('boot');
    const row = boot?.firstElementChild?.firstElementChild;
    return {
      page: boot && getComputedStyle(boot).backgroundColor,
      row: row && getComputedStyle(row).backgroundColor,
    };
  });
}

test('boot skeleton paints the light Paper tokens before the bundle mounts', async ({ page }) => {
  expect(await bootSkeletonPaint(page, 'light')).toEqual({
    page: 'rgb(243, 238, 229)',
    row: 'rgb(235, 228, 216)',
  });
});

test('boot skeleton paints the dark tokens before the bundle mounts', async ({ page }) => {
  expect(await bootSkeletonPaint(page, 'dark')).toEqual({
    page: 'rgb(31, 27, 24)',
    row: 'rgb(45, 41, 38)',
  });
});
