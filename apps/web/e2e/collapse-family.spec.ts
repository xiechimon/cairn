import { expect, type Page, test } from '@playwright/test';

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

  await expect(page.getByRole('link', { name: '新建项目' })).toBeVisible();

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
