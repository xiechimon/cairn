import { expect, type Page, test } from '@playwright/test';

const projectRows = (page: Page) => page.locator('[data-slot="sidebar-project-row"]');
const skills = (page: Page) => page.getByRole('complementary').getByRole('link', { name: '技能' });

test('an owner group folds to its count, flips aria and survives reload', async ({ page }) => {
  await page.goto('/app?scenario=sidebar-ref');

  const header = page.getByTestId('project-group-header').filter({ hasText: '客户' });
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect(projectRows(page)).toHaveCount(4);
  await expect(page.getByRole('complementary').getByText('项目', { exact: true })).toHaveCount(0);

  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(projectRows(page)).toHaveText(['cairn', 'r3-lifecycle']);
  await expect(header.locator('[data-slot="group-count"]')).toHaveText('2');
  await expect(page.getByRole('link', { name: '新建项目' })).toBeVisible();
  await expect(skills(page)).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('project-group-header')).toHaveAttribute('aria-expanded', 'false');
  await expect(projectRows(page)).toHaveCount(2);

  await page.getByTestId('project-group-header').click();
  await page.reload();
  await expect(projectRows(page)).toHaveCount(4);
});

test('resources live in settings, not the sidebar', async ({ page }) => {
  await page.goto('/app?scenario=01');
  await expect(skills(page)).toHaveCount(0);
  await expect(page.locator('.sidebar-group', { hasText: '资源' })).toHaveCount(0);
  await page.getByTestId('sidebar-settings').click();
  const settings = page.getByRole('dialog', { name: '设置' });
  for (const name of ['技能', 'MCP', '密钥与环境变量', '执行机', '模型', 'API 密钥', '账号']) {
    await expect(settings.getByRole('link', { name, exact: true })).toBeVisible();
  }
});
