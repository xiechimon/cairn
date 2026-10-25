import { expect, test } from '@playwright/test';

const ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27b';

test('initial render shows the hunk face and the `显示完整文件` button, no full text (initial render unpolluted)', async ({ page }) => {
  await page.goto(ROUTE);
  await expect(page.getByText('@@ -3,3 +3,4 @@')).toBeVisible();
  await expect(page.getByRole('button', { name: '显示完整文件' })).toBeVisible();
  await expect(page.getByTestId('diff-full')).toHaveCount(0);
});

test('click expands the full text inline: hunks hidden, full text with continuous line numbers, button flips to `显示差异`', async ({ page }) => {
  await page.goto(ROUTE);
  await page.getByRole('button', { name: '显示完整文件' }).click();
  const full = page.getByTestId('diff-full');
  await expect(full).toBeVisible();

  await expect(full).toContainText('# r3 probe');
  await expect(full).toContainText('r7 rebaseline probe');

  await expect(full.locator('[data-kind]')).toHaveCount(6);
  await expect(full.locator('[data-no="new"]').first()).toHaveText('1');
  await expect(full.locator('[data-no="new"]').last()).toHaveText('6');

  await expect(page.getByText('@@ -3,3 +3,4 @@')).toHaveCount(0);
  await expect(page.locator('[data-kind="add"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '显示差异' })).toBeVisible();
});

test('click again returns to the hunk face, button copy flips back to `显示完整文件`', async ({ page }) => {
  await page.goto(ROUTE);
  await page.getByRole('button', { name: '显示完整文件' }).click();
  await expect(page.getByTestId('diff-full')).toBeVisible();
  await page.getByRole('button', { name: '显示差异' }).click();
  await expect(page.getByTestId('diff-full')).toHaveCount(0);
  await expect(page.getByText('@@ -3,3 +3,4 @@')).toBeVisible();
  await expect(page.locator('[data-kind="add"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '显示完整文件' })).toBeVisible();
});
