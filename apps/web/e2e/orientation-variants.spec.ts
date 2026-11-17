import { expect, test } from '@playwright/test';

test('horizontal tabs stack the list above the panel', async ({ page }) => {
  await page.goto('/app?scenario=r3-93&pane=tasks');
  const root = page.locator('[data-slot="tabs"]').first();
  await expect(root).toHaveAttribute('data-orientation', 'horizontal');
  await expect(root).toHaveCSS('flex-direction', 'column');
});
