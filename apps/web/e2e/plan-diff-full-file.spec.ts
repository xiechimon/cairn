import { expect, test } from '@playwright/test';

const ROUTE = '/app/todo/r8-15?scenario=66';

test('initial render shows the hunk face and the `显示完整文件` button, no full text (initial render unpolluted)', async ({ page }) => {
  await page.goto(ROUTE);
  await expect(page.getByText('@@ -1,9 +1,10 @@')).toBeVisible();
  await expect(page.getByRole('button', { name: '显示完整文件' })).toBeVisible();
  await expect(page.getByTestId('diff-full')).toHaveCount(0);
});

test('click expands inline to the full version text: hunks hidden, line numbers continuous, button flips to `显示差异`', async ({ page }) => {
  await page.goto(ROUTE);
  await page.getByRole('button', { name: '显示完整文件' }).click();
  const full = page.getByTestId('diff-full');
  await expect(full).toBeVisible();

  await expect(full).toContainText('## Context');
  await expect(full).toContainText('提交：改动完成后需创建一次 commit');
  await expect(full).toContainText('## 验证');

  await expect(full.locator('[data-kind]')).toHaveCount(10);
  await expect(full.locator('[data-no="new"]').first()).toHaveText('1');
  await expect(full.locator('[data-no="new"]').last()).toHaveText('10');

  await expect(page.getByText('@@ -1,9 +1,10 @@')).toHaveCount(0);
  await expect(page.locator('[data-kind="add"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '显示差异' })).toBeVisible();
});

test('click again returns to the hunk face, button copy flips back to `显示完整文件`', async ({ page }) => {
  await page.goto(ROUTE);
  await page.getByRole('button', { name: '显示完整文件' }).click();
  await expect(page.getByTestId('diff-full')).toBeVisible();
  await page.getByRole('button', { name: '显示差异' }).click();
  await expect(page.getByTestId('diff-full')).toHaveCount(0);
  await expect(page.getByText('@@ -1,9 +1,10 @@')).toBeVisible();
  await expect(page.locator('[data-kind="add"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '显示完整文件' })).toBeVisible();
});
