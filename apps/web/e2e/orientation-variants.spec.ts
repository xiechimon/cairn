import { expect, test } from '@playwright/test';

test('horizontal tabs stack the list above the panel', async ({ page }) => {
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX/tasks?scenario=prj-tasks');
  const root = page.locator('[data-slot="tabs"]').first();
  await expect(root).toHaveAttribute('data-orientation', 'horizontal');
  await expect(root).toHaveCSS('flex-direction', 'column');
});
