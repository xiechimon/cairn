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

  const project = page.getByRole('complementary').locator('[data-slot="sidebar-project-row"]').first();
  await project.click();

  await expect(page).toHaveURL(/\/app\?scenario=01&project=/);
  expect(await page.evaluate(() => window.__spaCanary)).toBe('alive');
  await expect(project).toHaveAttribute('aria-current', 'page');

  const board = page
    .getByRole('complementary')
    .locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' });
  await expect(board).not.toHaveAttribute('aria-current', 'page');
});

test('settings sections hop client-side', async ({ page }) => {
  await page.goto('/app?scenario=01');
  await plantCanary(page);

  await page.getByTestId('sidebar-settings').click();
  const settings = page.getByRole('dialog', { name: '设置' });
  await settings.getByRole('link', { name: '技能' }).click();
  await expect(page).toHaveURL('/app/settings/skills?scenario=01');
  expect(await page.evaluate(() => window.__spaCanary)).toBe('alive');

  await settings.getByRole('link', { name: '模型选择' }).click();
  await expect(page).toHaveURL('/app/settings/work-routing?scenario=01');
  expect(await page.evaluate(() => window.__spaCanary)).toBe('alive');
});

test('peek rows hop client-side', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
  await page.goto('/app?scenario=03');
  await plantCanary(page);

  await page.getByTestId('sidebar-reopen').hover();
  await page.getByTestId('sidebar-peek').locator('[data-slot="sidebar-project-row"]').first().click();
  await expect(page).toHaveURL(/\/app\?scenario=03&project=/);
  expect(await page.evaluate(() => window.__spaCanary)).toBe('alive');
});

test('install-app entries are gone from both sidebar states', async ({ page }) => {
  await page.goto('/app?scenario=01');

  await expect(page.getByRole('link', { name: /安装/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /安装/ })).toHaveCount(0);
  await expect(page.locator('a[href^="/zh/install"]')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-settings')).toBeVisible();
});

test('/zh/install redirects to /app (unmatched-path divergence, 01 §8)', async ({ page }) => {
  await page.goto('/zh/install');
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('complementary')).toBeVisible();
});

test('hover tints the row — dark default + light theme', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const row = page.getByRole('complementary').locator('[data-slot="sidebar-project-row"]').first();

  expect(await pillBg(row)).toBe('rgba(0, 0, 0, 0)');
  await row.hover();
  await expect.poll(() => pillBg(row)).toBe('rgba(255, 255, 255, 0.075)');

  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
  await page.goto('/app?scenario=01');
  const lightRow = page
    .getByRole('complementary')
    .locator('[data-slot="sidebar-project-row"]')
    .first();
  await lightRow.hover();
  await expect.poll(() => pillBg(lightRow)).toBe('rgba(0, 0, 0, 0.06)');
});

test('selected row keeps its sheet fill under hover', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const board = page
    .getByRole('complementary')
    .locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' });
  await expect(board).toHaveAttribute('aria-current', 'page');

  const sheet = await tokenBg(page, '--sidebar-active');
  await board.hover();

  await page.waitForTimeout(250);
  expect(await pillBg(board)).toBe(sheet);
  await expect(board).toHaveAttribute('aria-current', 'page');
});

for (const locale of ['zh', 'en']) {
  for (const layout of ['expanded', 'peek', 'phone']) {
    test(`navigation names match page titles: ${locale} ${layout}`, async ({ page }) => {
      const home = 'Coordinator';
      await page.addInitScript(({ locale, layout }) => {
        localStorage.setItem('cairn.locale', locale);
        localStorage.setItem('cairn.sidebar-collapsed', layout === 'peek' ? '1' : '0');
      }, { locale, layout });
      if (layout === 'phone') await page.setViewportSize({ width: 390, height: 844 });
      const reveal = async () => {
        if (layout === 'phone') await page.getByRole('button', { name: locale === 'zh' ? '展开侧边栏' : 'Expand sidebar' }).click();
        if (layout === 'peek') {
          await page.mouse.move(700, 400);
          await page.getByTestId('sidebar-reopen').hover();
          await expect(page.getByTestId('sidebar-peek')).toHaveAttribute('data-open', '');
        }
      };
      await page.goto('/app?scenario=01');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(home);
      await reveal();
      const sidebar = page.locator('.board-sidebar');
      await expect(sidebar.locator('[aria-current="page"]')).toHaveAccessibleName(new RegExp(home));
      await expect(sidebar.getByRole('link', {
        name: locale === 'zh' ? '新建项目' : 'New project',
        exact: true,
      })).toBeVisible();
      await expect(sidebar.getByRole('button', { name: locale === 'zh' ? '项目' : 'Project', exact: true })).toHaveCount(0);
      await page.goto('/app/schedules?scenario=01');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(locale === 'zh' ? '定时' : 'Schedules');
      await reveal();
      await expect(sidebar.locator('[aria-current="page"]')).toHaveAccessibleName(locale === 'zh' ? '定时' : 'Schedules');
      await sidebar.locator('[data-slot="sidebar-nav-row"]').filter({ hasText: home }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(home);
      await reveal();
      await expect(sidebar.locator('[aria-current="page"]')).toHaveAccessibleName(new RegExp(home));
    });
  }
}
