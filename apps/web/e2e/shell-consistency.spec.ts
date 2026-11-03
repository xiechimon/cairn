import { expect, type Locator, type Page, test } from '@playwright/test';
import { openChiefWindow } from './helpers.js';

const THEME_KEY = 'cairn-theme'; // apps/web/src/theme.ts THEME_STORAGE_KEY
const SIDEBAR_KEY = 'cairn.sidebar-collapsed'; // apps/web/src/board/app-sidebar.tsx

const rootTheme = (page: Page) =>
  page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    light: document.documentElement.classList.contains('light'),
  }));

/** Route-commit anchors: toHaveURL flips before React commits the new
 *  shell, and boundingBox() is a one-shot sample — measuring in that gap
 *  can catch the old sidebar node detached (null box). Each anchor only
 *  exists once the target route's shell has rendered, so waiting on it
 *  makes the measurement below deterministic. */
const ROUTE_ANCHOR: Record<string, string> = {
  '/app': '[data-route="board"]',
  '/app/schedules': '[data-route="schedules"]',
};

/** Assert the sidebar box on `route` matches `box`: wait for the route's
 *  shell to commit, then retry the (one-shot) measurement until it equals
 *  — covering both the detach gap and any mid-transition sample. */
async function expectSidebarBox(
  page: Page,
  locator: Locator,
  route: string,
  box: NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>,
) {
  await expect(page.locator(ROUTE_ANCHOR[route])).toBeVisible();
  await expect.poll(() => locator.boundingBox()).toEqual(box);
}

/** Baseline capture after a fresh goto: anchor on the committed shell,
 *  retry until the box exists, then read the settled value. */
async function captureSidebarBox(
  page: Page,
  locator: Locator,
  route: string,
) {
  await expect(page.locator(ROUTE_ANCHOR[route])).toBeVisible();
  await expect.poll(() => locator.boundingBox()).not.toBeNull();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box as NonNullable<typeof box>;
}

const headContentX = (page: Page) =>
  page.evaluate(() => {

    const row = document.querySelector('[data-testid="team-row"]');
    const mark = row?.querySelector('[data-testid="brand-mark"]');
    const name = row?.querySelector('.sidebar-team-name');
    const toggle = row?.querySelector('button[aria-label="收起侧边栏"]');
    if (!row || !mark || !name || !toggle) throw new Error('sidebar brand head missing');
    return {
      iconX: mark.getBoundingClientRect().x,
      nameX: name.getBoundingClientRect().x,
      toggleX: toggle.getBoundingClientRect().x,
    };
  });

test.describe('⌘J wakes the window on every shell family', () => {
  const families = [
    { name: 'board', route: '/app/schedules?scenario=01', gear: true },
    { name: 'pages', route: '/app/schedules?scenario=11', gear: true },
  ] as const;

  for (const { name, route, gear } of families) {
    test(`${name}: ⌘J opens the window, minimize returns to the surface`, async ({
      page,
    }) => {
      await page.goto(route);

      await expect(page.locator('.chief-drawer')).toBeHidden();
      await expect(page.locator('.chief-drawer')).toHaveCount(1);

      await openChiefWindow(page);
      await expect(page.locator('.chief-drawer')).toBeVisible();

      await expect(page.locator('.chief-drawer button[aria-label="总管设置"]')).toHaveCount(
        gear ? 1 : 0,
      );

      await page.locator('.chief-drawer button[aria-label="最小化"]').click();
      await expect(page.locator('.chief-drawer')).toBeHidden();
    });
  }
});

test.describe('sidebar form is route-invariant', () => {
  test('expanded sidebar keeps identical geometry across /app ↔ /app/schedules hops', async ({
    page,
  }) => {
    await page.goto('/app?scenario=01');
    const sidebar = page.getByRole('complementary');
    const boardBox = await captureSidebarBox(page, sidebar, '/app');

    await page.goto('/app/schedules?scenario=01');
    await expectSidebarBox(page, sidebar, '/app/schedules', boardBox);

    await page.getByRole('complementary').locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' }).click();
    await expect(page).toHaveURL('/app?scenario=01');
    await expectSidebarBox(page, sidebar, '/app', boardBox);
  });

  test('the brand head holds its inner geometry across the /app → /app/schedules hop', async ({
    page,
  }) => {
    await page.goto('/app?scenario=01');
    await expect(page.locator(ROUTE_ANCHOR['/app'])).toBeVisible();
    const board = await headContentX(page);

    await page.goto('/app/schedules?scenario=01');
    // the active face repaints the row's background only (Paper Grouped
    // sidebar: sheet + hairline); the icon and the name must not drift as it
    // lights.
    await expect(page.locator(ROUTE_ANCHOR['/app/schedules'])).toBeVisible();
    await expect.poll(() => headContentX(page)).toEqual(board);
  });

  test('collapsed rail survives route hops (storage-backed on every shell)', async ({ page }) => {
    await page.addInitScript((k) => {
      localStorage.setItem(k, '1');
    }, SIDEBAR_KEY);
    await page.goto('/app?scenario=03');
    const rail = page.getByRole('complementary');
    const railBox = await captureSidebarBox(page, rail, '/app');

    await page.goto('/app/schedules?scenario=03');
    await expectSidebarBox(page, rail, '/app/schedules', railBox);
  });

  test('the collapse toggle works off-board and the state rides back', async ({ page }) => {
    await page.goto('/app/schedules?scenario=12');
    await expect(page.locator('[data-route="schedules"]')).toBeVisible();
    await page.getByRole('button', { name: '收起侧边栏' }).click();
    await expect(page.getByRole('complementary')).toBeVisible();
    // the toggle writes storage synchronously before its state flip; poll
    // keeps the read conditional regardless of commit ordering
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), SIDEBAR_KEY))
      .toBe('1');

    await page.getByRole('link', { name: /^Coordinator/ }).click();
    await expect(page).toHaveURL('/app?scenario=12');
    await expect(page.locator('[data-route="board"]')).toBeVisible();

    await expect(page.getByRole('complementary')).toBeVisible();
  });
});

test('team route carries no subscription surface', async ({ page }) => {
  await page.goto('/app/team?scenario=12');
  await expect(page.locator('.team-plan')).toHaveCount(0);
  await expect(page.locator('.team-upgrade')).toHaveCount(0);
  const body = await page.locator('body').innerText();
  expect(body).not.toContain('FREE');
  expect(body).not.toContain('升级');
});

test.describe('theme default follows the system', () => {
  test('no storage + system light boots light', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/app?scenario=01');
    expect(await rootTheme(page)).toEqual({ theme: 'light', light: true });
  });

  test('no storage + system dark boots dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/app?scenario=01');
    expect(await rootTheme(page)).toEqual({ theme: 'dark', light: false });
  });

  test('a stored theme beats the system scheme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript((k) => localStorage.setItem(k, 'dark'), THEME_KEY);
    await page.goto('/app?scenario=01');
    expect(await rootTheme(page)).toEqual({ theme: 'dark', light: false });
  });
});
