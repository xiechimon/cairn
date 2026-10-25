import { expect, type Locator, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    __spaCanary?: string;
  }
}

/** Computed background of a row (Paper Grouped sidebar: the row carries
 *  its own fill; the ::before pill layer retired). */
function pillBg(locator: Locator) {
  return locator.evaluate((el) => getComputedStyle(el).backgroundColor);
}

/** A token resolved to its computed rgb()/rgba() form. */
function tokenBg(page: Page, token: string) {
  return page.evaluate((v) => {
    const el = document.createElement('div');
    el.style.backgroundColor = `var(${v})`;
    document.body.append(el);
    const out = getComputedStyle(el).backgroundColor;
    el.remove();
    return out;
  }, token);
}

/** Plant the canary after load; any document navigation wipes it. */
async function plantCanary(page: Page) {
  await page.evaluate(() => {
    window.__spaCanary = 'alive';
  });
}

test('nav rows hop client-side: no reload, pill + aria-current follow', async ({ page }) => {
  await page.goto('/app?scenario=01');
  await plantCanary(page);

  const schedules = page.getByRole('complementary').getByRole('link', { name: '定时' });
  await schedules.click();

  await expect(page).toHaveURL('/app/schedules?scenario=01');
  expect(await page.evaluate(() => window.__spaCanary)).toBe('alive');
  await expect(schedules).toHaveAttribute('aria-current', 'page');

  const board = page.getByRole('link', { name: '工作台' });
  await expect(board).not.toHaveAttribute('aria-current', 'page');
});

test('subrow and team name hop client-side too', async ({ page }) => {

  await page.addInitScript(() => localStorage.setItem('cairn.sidebarResourcesCollapsed', '0'));
  await page.goto('/app?scenario=01');
  await plantCanary(page);

  await page.getByRole('link', { name: '技能' }).click();
  await expect(page).toHaveURL('/app/resources/skills?scenario=01');
  expect(await page.evaluate(() => window.__spaCanary)).toBe('alive');

  await page.getByRole('link', { name: 'Cairn' }).click();
  await expect(page).toHaveURL('/app/team?scenario=01');
  expect(await page.evaluate(() => window.__spaCanary)).toBe('alive');

  await expect(page.getByRole('link', { name: 'Cairn' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('rail rows hop client-side', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
  await page.goto('/app?scenario=03');
  await plantCanary(page);

  await page.getByRole('complementary').getByRole('link', { name: '定时' }).click();
  await expect(page).toHaveURL('/app/schedules?scenario=03');
  expect(await page.evaluate(() => window.__spaCanary)).toBe('alive');
});

test('install-app entries are gone from both sidebar states', async ({ page }) => {
  await page.goto('/app?scenario=01');

  await expect(page.getByRole('link', { name: /安装/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /安装/ })).toHaveCount(0);
  await expect(page.locator('a[href^="/zh/install"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Xmon Dai' })).toBeVisible();
});

test('collapsed rail carries no install icon', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
  await page.goto('/app?scenario=03');
  await expect(page.getByRole('link', { name: /安装/ })).toHaveCount(0);
  await expect(page.getByRole('complementary').getByRole('link', { name: '定时' })).toBeVisible();
});

test('/zh/install redirects to /app (unmatched-path divergence, 01 §8)', async ({ page }) => {
  await page.goto('/zh/install');
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('complementary')).toBeVisible();
});

test('hover tints the row — dark default + light theme', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const row = page.getByRole('complementary').getByRole('link', { name: '定时' });

  expect(await pillBg(row)).toBe('rgba(0, 0, 0, 0)');
  await row.hover();
  // --sidebar-hover dark = 5% warm white over the sidebar layer (#128),
  // reached over the 150ms color step
  await expect.poll(() => pillBg(row)).toBe('rgba(255, 252, 248, 0.05)');

  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
  await page.goto('/app?scenario=01');
  const lightRow = page.getByRole('complementary').getByRole('link', { name: '定时' });
  await lightRow.hover();
  // --sidebar-hover light = DESIGN.md hover #e8dec5 (Paper Grouped sidebar)
  await expect.poll(() => pillBg(lightRow)).toBe('rgb(232, 222, 197)');
});

test('rail hover tints the row', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
  await page.goto('/app?scenario=03');
  const row = page.getByRole('complementary').getByRole('link', { name: '定时' });

  expect(await pillBg(row)).toBe('rgba(0, 0, 0, 0)');
  await row.hover();
  await expect.poll(() => pillBg(row)).toBe('rgba(255, 252, 248, 0.05)');
});

test('selected row keeps its sheet fill under hover', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const board = page.getByRole('link', { name: '工作台' });
  await expect(board).toHaveAttribute('aria-current', 'page');

  const sheet = await tokenBg(page, '--hover-1');
  await board.hover();

  await page.waitForTimeout(250);
  expect(await pillBg(board)).toBe(sheet);
  await expect(board).toHaveAttribute('aria-current', 'page');
});
