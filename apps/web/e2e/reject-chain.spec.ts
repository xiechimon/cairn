import { expect, test } from '@playwright/test';

test('reject loop: request changes → v2 → diff → confirm', async ({ page }) => {
  await page.goto('/app/todo/r8-15?scenario=chain');

  // confirm v1 surface
  await expect(page.getByTestId('phase-chip')).toHaveText(/确认/);
  await expect(page.locator('.doc-pane-select').nth(1)).toHaveText(/v1/);

  await page.locator('.composer-send').click();
  await expect(page.getByTestId('phase-chip')).toHaveText(/规划中/);
  await expect(page.locator('.chat-streaming-label')).toHaveText('处理中...');

  // v2 lands (r8 68)
  await expect(page.getByTestId('phase-chip')).toHaveText(/确认/, { timeout: 5000 });
  await expect(page.locator('.chat-plan-title').last()).toHaveText('方案 · v2');

  // version dropdown (r8 63)
  await page.locator('.doc-range-wrap .doc-pane-select').click();
  await expect(page.locator('.version-menu-row')).toHaveCount(3);
  await expect(page.locator('.version-menu-row').first()).toHaveText(/v2 · 刚刚/);

  await page.getByRole('menuitem', { name: '与其他版本对比…' }).click();
  await expect(page.locator('.version-menu--sub')).toHaveText('上一版本');
  await page.getByRole('menuitem', { name: '上一版本' }).click();
  await expect(page.locator('.doc-range-chip')).toHaveText(/v1 → v2/);
  await expect(page.locator('.doc-file-row')).toHaveText(/plan\.md/);

  // expand the unified hunks (r8 66)
  await page.getByRole('button', { name: '全部展开' }).click();
  await expect(page.locator('.diff-hunk-head').first()).toHaveText('@@ -1,9 +1,10 @@');
  await expect(page.locator('.diff-line--add').first()).toBeVisible();

  await page.locator('.detail-head-action').click();
  await expect(page.getByTestId('phase-chip')).toHaveText(/执行中/);
  await expect(page.locator('.chat-streaming-label').last()).toHaveText('处理中...');
});
