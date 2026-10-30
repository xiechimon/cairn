import { expect, test } from '@playwright/test';

test('filter popover separator is a 1px horizontal rule', async ({ page }) => {
  await page.goto('/app?scenario=board-tags&view=board');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  const separator = page.getByRole('dialog', { name: '筛选' }).locator('[data-slot="separator"]').first();
  await expect(separator).toHaveAttribute('data-orientation', 'horizontal');
  const box = await separator.boundingBox();
  expect(box?.height ?? 0).toBeCloseTo(1, 0);
});

test('horizontal tabs stack the list above the panel', async ({ page }) => {
  await page.goto('/app/resources/providers?scenario=10');
  const root = page.locator('[data-route="/app/resources/providers"] [data-slot="tabs"]').first();
  await expect(root).toHaveAttribute('data-orientation', 'horizontal');
  await expect(root).toHaveCSS('flex-direction', 'column');
});
