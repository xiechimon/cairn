import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`settings omit categories at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
      await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c');
      await expect(page.locator('.prj-set-card')).toBeVisible();
      await expect(page.getByRole('tab', { name: '标签', exact: true })).toHaveCount(0);
      for (const name of ['基本信息', '仓库', '记忆']) {
        await expect(page.getByRole('tab', { name, exact: true })).toBeVisible();
      }
      await page.getByRole('tab', { name: '仓库', exact: true }).click();
      await expect(page.locator('.prj-set-card')).toBeVisible();
      await page.getByRole('tab', { name: '基本信息', exact: true }).click();
      await expect(page.locator('.prj-set-card')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
}
