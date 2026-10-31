import { expect, type Page, test } from '@playwright/test';

const DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27';
const panel = (page: Page) => page.getByRole('dialog', { name: '搜索' });

async function openPalette(page: Page) {
  await page.goto(DETAIL);
  await expect(page.getByTestId('detail-head')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(panel(page)).toBeVisible();
}

test('on a task page, ⌘K carries the task as context and lists its commands first', async ({
  page,
}) => {
  await openPalette(page);
  const title = await page.getByTestId('detail-title').textContent();
  await expect(panel(page).getByTestId('search-context')).toContainText(title ?? '');
  const rows = panel(page).locator('[data-row-index]');
  await expect(rows.first()).toHaveAttribute('data-row-kind', 'command');
  await expect(panel(page).getByRole('button', { name: '编辑分配…' })).toBeVisible();
  await expect(panel(page).getByText('前往', { exact: true })).toBeVisible();
});

test('typing filters commands and results together', async ({ page }) => {
  await openPalette(page);
  await page.keyboard.type('更多');
  await expect(panel(page).locator('[data-row-kind="command"]')).toHaveCount(1);
  await expect(panel(page).getByRole('button', { name: '更多操作…' })).toBeVisible();
});

test('Backspace on an empty box drops the context; a command closes the palette and runs', async ({
  page,
}) => {
  await openPalette(page);
  await page.keyboard.press('Backspace');
  await expect(panel(page).getByTestId('search-context')).toHaveCount(0);
  await expect(panel(page).locator('[data-row-kind="command"]')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(panel(page).getByTestId('search-context')).toBeVisible();
  await panel(page).getByRole('button', { name: '更多操作…' }).click();
  await expect(panel(page)).toBeHidden();
  await expect(page.getByRole('menu')).toBeVisible();
});
