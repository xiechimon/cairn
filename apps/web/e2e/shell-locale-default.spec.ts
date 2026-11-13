import { expect, type Page, test } from '@playwright/test';

const workbench = (page: Page, name: string) =>
  page.getByRole('complementary').getByRole('button', { name, exact: true });

test.describe('a browser set to English', () => {
  test.use({ locale: 'en-US' });

  test('opens the workbench in English with no stored choice', async ({ page }) => {
    await page.goto('/app');
    await expect(workbench(page, 'Search')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('keeps a stored Chinese choice', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cairn-locale', 'zh'));
    await page.goto('/app');
    await expect(workbench(page, '搜索')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  });
});

test.describe('a browser set to Chinese', () => {
  test.use({ locale: 'zh-CN' });

  test('opens the workbench in Chinese with no stored choice', async ({ page }) => {
    await page.goto('/app');
    await expect(workbench(page, '搜索')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  });

  test('keeps a stored English choice', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cairn-locale', 'en'));
    await page.goto('/app');
    await expect(workbench(page, 'Search')).toBeVisible();
  });
});
