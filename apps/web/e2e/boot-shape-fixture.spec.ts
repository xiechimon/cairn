import { expect, test } from '@playwright/test';

test('a sample-data board leaves the boot skeleton shape alone', async ({ page }) => {
  await page.goto('/app?scenario=board-drag-matrix&view=board');
  await expect(page.locator('[data-todo-id]').first()).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => localStorage.getItem('cairn-boot-shape'))).toBeNull();
});
