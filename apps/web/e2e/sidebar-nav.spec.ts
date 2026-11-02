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

  const schedules = page.getByRole('complementary').getByRole('button', { name: '定时' });
  await schedules.click();

  await expect(page).toHaveURL('/app/schedules?scenario=01');
  expect(await page.evaluate(() => window.__spaCanary)).toBe('alive');
  await expect(schedules).toHaveAttribute('aria-current', 'page');

  const board = page
    .getByRole('complementary')
    .locator('[data-slot="sidebar-nav-row"]', { hasText: '首页' });
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
  await expect(
    page.getByRole('complementary').getByRole('link', { name: '定时' }),
  ).toBeVisible();
});

test('/zh/install redirects to /app (unmatched-path divergence, 01 §8)', async ({ page }) => {
  await page.goto('/zh/install');
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('complementary')).toBeVisible();
});

test('hover tints the row — dark default + light theme', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const row = page.getByRole('complementary').getByRole('button', { name: '定时' });

  expect(await pillBg(row)).toBe('rgba(0, 0, 0, 0)');
  await row.hover();
  await expect.poll(() => pillBg(row)).toBe('rgba(230, 232, 226, 0.05)');

  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
  await page.goto('/app?scenario=01');
  const lightRow = page.getByRole('complementary').getByRole('button', { name: '定时' });
  await lightRow.hover();
  await expect.poll(() => pillBg(lightRow)).toBe('rgb(220, 222, 215)');
});

test('rail hover tints the row', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
  await page.goto('/app?scenario=03');
  const row = page.getByRole('complementary').getByRole('link', { name: '定时' });

  expect(await pillBg(row)).toBe('rgba(0, 0, 0, 0)');
  await row.hover();
  await expect.poll(() => pillBg(row)).toBe('rgba(230, 232, 226, 0.05)');
});

test('selected row keeps its sheet fill under hover', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const board = page
    .getByRole('complementary')
    .locator('[data-slot="sidebar-nav-row"]', { hasText: '首页' });
  await expect(board).toHaveAttribute('aria-current', 'page');

  const sheet = await tokenBg(page, '--sidebar-active');
  await board.hover();

  await page.waitForTimeout(250);
  expect(await pillBg(board)).toBe(sheet);
  await expect(board).toHaveAttribute('aria-current', 'page');
});

for (const locale of ['zh', 'en']) {
  for (const layout of ['expanded', 'rail', 'phone']) {
    test(`navigation names match page titles: ${locale} ${layout}`, async ({ page }) => {
      const home = locale === 'zh' ? '首页' : 'Home';
      const schedules = locale === 'zh' ? '定时' : 'Schedules';
      await page.addInitScript(({ locale, layout }) => {
        localStorage.setItem('cairn.locale', locale);
        localStorage.setItem('cairn.sidebar-collapsed', layout === 'rail' ? '1' : '0');
      }, { locale, layout });
      if (layout === 'phone') await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/app?scenario=01');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(home);
      if (layout === 'phone') await page.getByRole('button', { name: locale === 'zh' ? '展开侧边栏' : 'Expand sidebar' }).click();
      const sidebar = page.locator('.board-sidebar');
      await expect(sidebar.locator('[aria-current="page"]')).toHaveAccessibleName(new RegExp(home));
      await expect(sidebar.getByRole('button', {
        name: layout === 'rail'
          ? locale === 'zh' ? '收起项目' : 'Collapse Project'
          : locale === 'zh' ? '项目' : 'Project',
        exact: true,
      })).toBeVisible();
      await sidebar.getByRole(layout === 'rail' ? 'link' : 'button', { name: schedules, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(schedules);
      if (layout === 'phone') await page.getByRole('button', { name: locale === 'zh' ? '展开侧边栏' : 'Expand sidebar' }).click();
      await expect(sidebar.locator('[aria-current="page"]')).toHaveAccessibleName(schedules);
      if (layout === 'rail') await sidebar.getByRole('link', { name: new RegExp(home) }).click();
      else await sidebar.locator('[data-slot="sidebar-nav-row"]').filter({ hasText: home }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(home);
      if (layout === 'phone') await page.getByRole('button', { name: locale === 'zh' ? '展开侧边栏' : 'Expand sidebar' }).click();
      await expect(sidebar.locator('[aria-current="page"]')).toHaveAccessibleName(new RegExp(home));
    });
  }
}
