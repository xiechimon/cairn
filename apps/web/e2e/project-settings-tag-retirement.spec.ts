import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`project settings show only 通用 and 记忆 at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
      await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c');
      const nav = page.getByRole('navigation', { name: '设置分区' });
      await expect(nav.getByRole('link')).toHaveText(['通用', '记忆']);
      await nav.getByRole('link', { name: '记忆', exact: true }).click();
      await expect(page.getByTestId('memory-list')).toBeVisible();
      await nav.getByRole('link', { name: '通用', exact: true }).click();
      await expect(page.getByText('想做什么', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
}
