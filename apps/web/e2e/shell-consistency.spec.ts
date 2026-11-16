import { expect, type Locator, type Page, test } from '@playwright/test';
import { pressOpenCoordinator } from './helpers.js';

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
  project: '[data-route="board"] [data-slot="sidebar-project-row"][aria-current="page"]',
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
    const name = row?.querySelector('.sidebar-team-name');
    const toggle = row?.querySelector('button[aria-label="收起侧边栏"]');
    if (!row || !name || !toggle) throw new Error('sidebar brand head missing');
    return {
      nameX: name.getBoundingClientRect().x,
      toggleX: toggle.getBoundingClientRect().x,
    };
  });

test.describe('⌘J reaches the bare Coordinator page from the schedules panel', () => {
  const families = [
    { name: 'board', route: '/app?scenario=01&pane=tasks&tab=scheduled', home: '/app?scenario=01' },
    { name: 'empty schedules', route: '/app?scenario=11&pane=tasks&tab=scheduled', home: '/app?scenario=11' },
  ] as const;

  for (const { name, route, home } of families) {
    test(`${name}: ⌘J navigates to the Coordinator page`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole('complementary', { name: '任务' })).toBeVisible();
      await expect(page.getByTestId('chief-composer-input')).not.toBeFocused();
      await pressOpenCoordinator(page);
      await expect(page.getByRole('complementary', { name: '任务' })).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`${home.replace('?', '\\?')}$`));
      await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toBeFocused();
    });
  }
});

test.describe('sidebar form is route-invariant', () => {
  test('expanded sidebar keeps identical geometry across /app ↔ project hops', async ({
    page,
  }) => {
    await page.goto('/app?scenario=01');
    const sidebar = page.getByRole('complementary');
    const boardBox = await captureSidebarBox(page, sidebar, '/app');

    await sidebar.locator('[data-slot="sidebar-project-row"]').first().click();
    await expectSidebarBox(page, sidebar, 'project', boardBox);

    await page.getByRole('complementary').locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' }).click();
    await expect(page).toHaveURL('/app?scenario=01');
    await expectSidebarBox(page, sidebar, '/app', boardBox);
  });

  test('the brand head holds its inner geometry across the /app → project hop', async ({
    page,
  }) => {
    await page.goto('/app?scenario=01');
    await expect(page.locator(ROUTE_ANCHOR['/app'])).toBeVisible();
    const board = await headContentX(page);

    await page.getByRole('complementary').locator('[data-slot="sidebar-project-row"]').first().click();
    await expect(page.locator(ROUTE_ANCHOR.project)).toBeVisible();
    await expect.poll(() => headContentX(page)).toEqual(board);
  });

  test('a collapsed sidebar stays collapsed across route hops (storage-backed on every shell)', async ({
    page,
  }) => {
    await page.addInitScript((k) => {
      localStorage.setItem(k, '1');
    }, SIDEBAR_KEY);
    for (const route of ['/app?scenario=03', '/app?scenario=03&project=ZAQczKCu0MOAzC1ZqcFlX&chat=1']) {
      await page.goto(route);
      await expect(page.getByTestId('sidebar-reopen')).toBeVisible();
      await expect(page.getByRole('complementary')).toHaveCount(0);
    }
  });

  test('the collapse toggle works on a project and the state rides back', async ({ page }) => {
    await page.goto('/app?scenario=12');
    await page.getByRole('complementary').locator('[data-slot="sidebar-project-row"]').first().click();
    await expect(page.locator(ROUTE_ANCHOR.project)).toBeVisible();
    await page.getByRole('button', { name: '收起侧边栏' }).click();
    await expect(page.getByTestId('sidebar-reopen')).toBeVisible();
    // the toggle writes storage synchronously before its state flip; poll
    // keeps the read conditional regardless of commit ordering
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), SIDEBAR_KEY))
      .toBe('1');

    await page.mouse.move(700, 400);
    await page.getByTestId('sidebar-reopen').hover();
    await page
      .getByTestId('sidebar-peek')
      .locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' })
      .click();
    await expect(page).toHaveURL('/app?scenario=12');
    await expect(page.locator('[data-route="board"]')).toBeVisible();

    await expect(page.getByTestId('sidebar-reopen')).toBeVisible();
  });
});

test('legacy team route redirects to work routing with no subscription surface', async ({
  page,
}) => {
  await page.goto('/app/team?scenario=12');
  await expect(page).toHaveURL(/\/app\/settings\/work-routing\?scenario=12$/);
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
