import { expect, type Page, test } from '@playwright/test';

// Issue #147 acceptance: the sidebar collapse family is live and persists.
// The 项目 / 资源 GroupHeaders hide their sub-rows (r2 §1.1) and flip their
// aria to 展开… (r6), in the expanded sidebar and in the rail alike. Every
// collapse survives a reload through its localStorage key — the project
// group rides the observed original key shape (cairn.sidebarProjectsCollapsed,
// r2 §1.5), the resource group the [推断] twin.
// (#351 裁定：看板列收起全家随 6→4 列收敛删除——列收起钮/窄条/持久键
// 不复存在，本 spec 只保留侧栏族。)

// Paper Grouped sidebar: 资源 folds by default (absent key = folded, "0" =
// open); 项目 keeps the #147 shape (absent = open, "1" = folded). Headers
// carry aria-expanded; the rail chevrons keep their 收起/展开 aria-label.

const projectRows = (page: Page) => page.locator('[data-testid="project-row"]');
const skills = (page: Page) => page.getByRole('complementary').getByRole('link', { name: '技能' });

test('sidebar group collapse hides sub-rows, flips aria, survives reload', async ({ page }) => {
  await page.goto('/app?scenario=01');

  const header = page.locator('.sidebar-group', { hasText: '项目' });
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect(projectRows(page)).toHaveCount(1);

  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(projectRows(page)).toHaveCount(0);
  // chevron tracks the collapse: down open, right collapsed
  await expect
    .poll(() =>
      page
        .locator('.sidebar-group--collapsed .sidebar-group-chevron')
        .first()
        .evaluate((el) => getComputedStyle(el).rotate),
    )
    .toBe('-90deg');
  // the 新建项目 plus stays reachable on the folded header
  await expect(page.getByRole('link', { name: '新建项目' })).toBeVisible();
  // the 资源 fold is independent (folded by default)
  await expect(skills(page)).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.sidebar-group', { hasText: '项目' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(projectRows(page)).toHaveCount(0);

  // expand again and that sticks too
  await page.locator('.sidebar-group', { hasText: '项目' }).click();
  await page.reload();
  await expect(projectRows(page)).toHaveCount(1);
});

test('rail group collapse hides member rows and survives reload', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
  await page.goto('/app?scenario=03');

  await expect(page.locator('.rail-row .project-avatar')).toBeVisible();
  await expect(page.locator('.rail-row[aria-label="技能"]')).toHaveCount(0);

  await page.locator('.rail-group[aria-label="展开资源"]').click();
  await expect(page.locator('.rail-row[aria-label="技能"]')).toBeVisible();

  await page.locator('.rail-group[aria-label="收起项目"]').click();
  await expect(page.locator('.rail-row .project-avatar')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.rail-group[aria-label="展开项目"]')).toBeVisible();
  await expect(page.locator('.rail-row .project-avatar')).toHaveCount(0);
  await expect(page.locator('.rail-row[aria-label="技能"]')).toBeVisible();
});

test('both sidebar groups persist side by side', async ({ page }) => {
  await page.goto('/app?scenario=01');
  await page.locator('.sidebar-group', { hasText: '资源' }).click();
  await page.locator('.sidebar-group', { hasText: '项目' }).click();

  await page.reload();
  await expect(skills(page)).toBeVisible();
  await expect(projectRows(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('cairn.sidebarResourcesCollapsed'))).toBe(
    '0',
  );
  expect(await page.evaluate(() => localStorage.getItem('cairn.sidebarProjectsCollapsed'))).toBe(
    '1',
  );
});
