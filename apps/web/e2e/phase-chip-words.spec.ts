import { expect, type Page, test } from '@playwright/test';
import { pressAndExpect } from './helpers.js';

const FRESH_TITLE = 'r7 rebaseline probe';

const panel = (page: Page) => page.getByRole('dialog', { name: '搜索' });

async function openPanel(page: Page) {
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressAndExpect(page, 'Meta+k', panel(page));
}

test('side chat: the fresh task status reads `空闲`', async ({ page }) => {
  await page.goto('/app/todo/fresh-probe?scenario=23');
  await expect(page.getByTestId('side-chat-status')).toContainText('空闲');
});

test('search rows: fresh reads `待开始`, review `审核`, done `已完成`', async ({ page }) => {
  await page.goto('/app?scenario=22');
  await openPanel(page);
  await page.keyboard.type('probe');
  const rows = panel(page).locator('[data-row-kind="todo"]');
  await expect(rows).toHaveCount(3);
  const glyph = (title: string) => rows.filter({ hasText: title }).locator('[data-glyph]');
  await expect(glyph(FRESH_TITLE)).toHaveAttribute('aria-label', '待开始');
  await expect(glyph('r3 lifecycle probe」')).toHaveAttribute('aria-label', '审核');
  await expect(glyph('r3 lifecycle probe2')).toHaveAttribute('aria-label', '已完成');
  await expect(panel(page).getByText('待处理', { exact: true })).toHaveCount(0);
});
