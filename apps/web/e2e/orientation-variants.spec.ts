import { expect, test } from '@playwright/test';

test('horizontal tabs stack the list above the panel', async ({ page }) => {
  await page.goto('/app/resources/agents/r3-builder?scenario=agent-detail');
  const root = page.locator('[data-slot="tabs"]').first();
  await expect(root).toHaveAttribute('data-orientation', 'horizontal');
  await expect(root).toHaveCSS('flex-direction', 'column');
});
