import { expect, test } from '@playwright/test';

test('with-branch card: branch button visible and is the branch glyph, opens the branch and PR sheet', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const buttons = page.locator('.todo-card-branch');
  await expect(buttons.first()).toBeVisible();
  await expect(buttons.first().locator('svg circle')).toHaveCount(2);
  await buttons.first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('构建分支')).toBeVisible();
});

test('no-branch card: branch button not rendered', async ({ page }) => {

  await page.goto('/app?scenario=22d');
  await expect(page.locator('.todo-card-branch')).toHaveCount(3);
  const fresh = page.locator('[data-todo-id="r7-dark-fresh-probe-10"]');
  await expect(fresh.locator('.todo-card-branch')).toHaveCount(0);
});
