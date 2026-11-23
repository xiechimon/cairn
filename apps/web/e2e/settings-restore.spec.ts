import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock.js';

const HOME = '/app?scenario=providers-fleet';
const SECTION = 'routing';
const KEY = 'cairn.settings-section';

const stored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), KEY);

const settings = (page: Page) => page.getByRole('dialog', { name: '设置' });
const navItem = (page: Page, id: string) =>
  settings(page).locator(`[data-settings-section="${id}"]`);

async function openSettings(page: Page) {
  await page.getByTestId('sidebar-settings').click();
  await expect(settings(page)).toBeVisible();
}

test('settings reopen on the section they were closed at', async ({ page }) => {
  await page.goto(HOME);
  await openSettings(page);
  await expect(navItem(page, 'account')).toHaveAttribute('aria-current', 'page');
  await navItem(page, SECTION).click();
  await expect(page).toHaveURL(new RegExp(`/app/settings/${SECTION}\\?`));
  await expect(navItem(page, SECTION)).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => stored(page)).toBe(SECTION);
  await page.keyboard.press('Escape');
  await expect(settings(page)).toHaveCount(0);

  await openSettings(page);
  await expect(page).toHaveURL(new RegExp(`/app/settings/${SECTION}\\?`));
  await expect(navItem(page, SECTION)).toHaveAttribute('aria-current', 'page');
});

test('bare settings opens on the section last used even while the signed-in user is still loading', async ({
  page,
}) => {
  await page.addInitScript(
    ([key, section]) => {
      localStorage.setItem(key, section);
    },
    [KEY, SECTION],
  );
  await mockLive(page, { threads: [], messages: [] }, (path) =>
    path === '/api/user/me' ? new Promise<void>(() => {}) : undefined,
  );
  await page.goto('/app/settings');
  await expect(page).toHaveURL(new RegExp(`/app/settings/${SECTION}`));
  await expect(navItem(page, SECTION)).toHaveAttribute('aria-current', 'page');
});

test('reloading Settings never writes its section over one picked in another tab', async ({
  page,
  context,
}) => {
  await page.addInitScript(
    ([key, section]) => {
      if (sessionStorage.getItem('seeded') !== null) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(key, section);
    },
    [KEY, SECTION],
  );
  await page.goto('/app/settings?scenario=providers-fleet');
  await expect(navItem(page, SECTION)).toHaveAttribute('aria-current', 'page');
  const other = await context.newPage();
  await other.goto(HOME);
  await openSettings(other);
  await navItem(other, 'machines').click();
  await expect(navItem(other, 'machines')).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => stored(page)).toBe('machines');
  await page.reload();
  await expect(navItem(page, SECTION)).toHaveAttribute('aria-current', 'page');
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  expect(await stored(page)).toBe('machines');
});

test('choosing Settings from search while Settings is open keeps the section on screen and adds no Back step', async ({
  page,
}) => {
  await page.addInitScript(
    ([key, section]) => {
      if (sessionStorage.getItem('seeded') !== null) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(key, section);
    },
    [KEY, SECTION],
  );
  await page.goto(HOME);
  await openSettings(page);
  await expect(navItem(page, SECTION)).toHaveAttribute('aria-current', 'page');
  await navItem(page, 'machines').click();
  await expect(page).toHaveURL(/\/app\/settings\/machines\?/);
  const historyBefore = await page.evaluate(() => history.length);
  await page.keyboard.press('Meta+k');
  const search = page.getByRole('dialog', { name: '搜索' });
  await expect(search).toBeVisible();
  await search.locator('[data-row-kind="nav"]', { hasText: '设置' }).click();
  await expect(search).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/settings\/machines\?/);
  await expect(navItem(page, 'machines')).toHaveAttribute('aria-current', 'page');
  expect(await page.evaluate(() => history.length)).toBe(historyBefore);
  await page.goBack();
  await expect(settings(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\?scenario=providers-fleet$/);
});

test('a legacy Settings link remembers the section it shows when search reopens Settings', async ({
  page,
}) => {
  await page.goto('/app/settings/projects?scenario=providers-fleet');
  await expect(navItem(page, 'account')).toHaveAttribute('aria-current', 'page');
  const search = page.getByRole('dialog', { name: '搜索' });
  const settingsFromSearch = async () => {
    await page.keyboard.press('Meta+k');
    await expect(search).toBeVisible();
    await search.locator('[data-row-kind="nav"]', { hasText: '设置' }).click();
    await expect(search).toHaveCount(0);
  };
  await settingsFromSearch();
  await expect(navItem(page, 'account')).toHaveAttribute('aria-current', 'page');
  await navItem(page, 'machines').click();
  await expect(page).toHaveURL(/\/app\/settings\/machines\?/);
  await page.goBack();
  await expect(navItem(page, 'account')).toHaveAttribute('aria-current', 'page');
  await settingsFromSearch();
  await expect(page).toHaveURL(/\/app\/settings\/account\?/);
  await expect(navItem(page, 'account')).toHaveAttribute('aria-current', 'page');
});
