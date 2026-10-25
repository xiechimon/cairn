import { expect, test } from '@playwright/test';

test.describe('a browser set to English', () => {
  test.use({ locale: 'en-US' });

  test('opens the workbench in English with no stored choice', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Workbench' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('keeps a stored Chinese choice', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cairn-locale', 'zh'));
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  });
});

test.describe('a browser set to Chinese', () => {
  test.use({ locale: 'zh-CN' });

  test('opens the workbench in Chinese with no stored choice', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  });

  test('keeps a stored English choice', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cairn-locale', 'en'));
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Workbench' })).toBeVisible();
  });
});
