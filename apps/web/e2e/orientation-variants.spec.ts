import { expect, test } from '@playwright/test';

test('horizontal tabs stack the list above the panel', async ({ page }) => {
  await page.goto('/app/resources/providers?scenario=10');
  const root = page.locator('[data-route="/app/resources/providers"] [data-slot="tabs"]').first();
  await expect(root).toHaveAttribute('data-orientation', 'horizontal');
  await expect(root).toHaveCSS('flex-direction', 'column');
});
