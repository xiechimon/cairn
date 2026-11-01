import { expect, type Page, test } from '@playwright/test';

const SCENARIO = 'sidebar-snooze';

const row = (page: Page, title: string) =>
  page.getByTestId('sidebar-thread-row').filter({ hasText: title });
const snoozedGroup = (page: Page) => page.getByTestId('group-snoozed');
const snoozedCount = async (page: Page) =>
  Number(await page.getByTestId('group-snoozed-count').textContent());
const toast = (page: Page) => page.locator('[data-sonner-toast]').first();

async function openSnoozeMenu(page: Page, title: string) {
  await row(page, title).hover();
  await row(page, title).getByTestId('thread-row-menu').click();
  await page.getByTestId('thread-row-snooze').hover();
  await expect(page.getByTestId('thread-snooze-menu')).toBeVisible();
}

test('the snooze submenu sits right after Mark as unread with the four choices', async ({
  page,
}) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await row(page, 'active thread A').hover();
  await row(page, 'active thread A').getByTestId('thread-row-menu').click();
  const items = page.getByRole('menuitem');
  await expect(items.nth(0)).toHaveAttribute('data-testid', 'thread-row-mark-unread');
  await expect(items.nth(1)).toHaveAttribute('data-testid', 'thread-row-snooze');

  await page.getByTestId('thread-row-snooze').hover();
  const choices = page.getByTestId('thread-snooze-menu').getByRole('menuitem');
  await expect(choices).toHaveText([
    '需要时（智能体唤醒）N',
    '明天 09:00T',
    '下周一M',
    '选择时间…P',
  ]);
});

test('snooze until needed: confirm dialog, toast with Undo, row leaves the list, Undo restores it', async ({
  page,
}) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await expect(row(page, 'active thread A')).toHaveCount(1);
  expect(await snoozedCount(page)).toBe(1);

  await openSnoozeMenu(page, 'active thread A');
  await page.getByTestId('thread-snooze-needed').click();

  const dialog = page.getByRole('dialog', { name: '暂停，直到需要我' });
  await expect(dialog).toBeVisible();
  await expect(row(page, 'active thread A')).toHaveCount(1);
  await dialog.getByTestId('snooze-confirm').click();
  await expect(dialog).toBeHidden();

  await expect(toast(page)).toContainText('线程已暂停');
  await expect(toast(page).getByRole('button', { name: '撤销' })).toBeVisible();
  await expect(row(page, 'active thread A')).toHaveCount(0);
  await expect(row(page, 'active thread B')).toHaveCount(1);
  expect(await snoozedCount(page)).toBe(2);

  await toast(page).getByRole('button', { name: '撤销' }).click();
  await expect(row(page, 'active thread A')).toHaveCount(1);
  expect(await snoozedCount(page)).toBe(1);
});

test('cancelling the confirm dialog leaves the thread where it was', async ({ page }) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await openSnoozeMenu(page, 'active thread A');
  await page.getByTestId('thread-snooze-needed').click();
  const dialog = page.getByRole('dialog', { name: '暂停，直到需要我' });
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, 'active thread A')).toHaveCount(1);
  expect(await snoozedCount(page)).toBe(1);
});

test('a timed preset snoozes without a confirm dialog and Undo restores it', async ({ page }) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await openSnoozeMenu(page, 'active thread B');
  await page.getByTestId('thread-snooze-tomorrow').click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(toast(page)).toContainText('线程已暂停');
  await expect(row(page, 'active thread B')).toHaveCount(0);
  expect(await snoozedCount(page)).toBe(2);

  await toast(page).getByRole('button', { name: '撤销' }).click();
  await expect(row(page, 'active thread B')).toHaveCount(1);
  expect(await snoozedCount(page)).toBe(1);
});

test('Next Monday snoozes the thread too', async ({ page }) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await openSnoozeMenu(page, 'active thread B');
  await page.getByTestId('thread-snooze-monday').click();
  await expect(row(page, 'active thread B')).toHaveCount(0);
  expect(await snoozedCount(page)).toBe(2);
});

test('Pick a time opens a date-time dialog that rejects the past and snoozes on confirm', async ({
  page,
}) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await openSnoozeMenu(page, 'active thread B');
  await page.getByTestId('thread-snooze-pick').click();

  const dialog = page.getByRole('dialog', { name: '选择唤醒时间' });
  await expect(dialog).toBeVisible();
  const input = dialog.getByTestId('snooze-pick-input');
  await input.fill('2020-01-01T09:00');
  await expect(dialog.getByTestId('snooze-pick-confirm')).toBeDisabled();

  const future = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  await input.fill(
    `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T09:30`,
  );
  await expect(dialog.getByTestId('snooze-pick-confirm')).toBeEnabled();
  await dialog.getByTestId('snooze-pick-confirm').click();

  await expect(row(page, 'active thread B')).toHaveCount(0);
  expect(await snoozedCount(page)).toBe(2);
});

test('the snoozed group is collapsed by default, lists snoozed threads with Unsnooze, and survives reload', async ({
  page,
}) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await expect(snoozedGroup(page)).toBeVisible();
  await expect(page.getByTestId('snoozed-thread-row')).toHaveCount(0);

  await page.getByTestId('group-snoozed-toggle').click();
  const snoozedRow = page.getByTestId('snoozed-thread-row').filter({ hasText: 'sleeping thread C' });
  await expect(snoozedRow).toHaveCount(1);
  await expect(snoozedRow.locator('svg.lucide-alarm-clock-off')).toBeVisible();

  await snoozedRow.hover();
  await snoozedRow.getByTestId('snoozed-row-menu').click();
  await page.getByTestId('thread-row-unsnooze').click();
  await expect(snoozedGroup(page)).toHaveCount(0);
  await expect(row(page, 'sleeping thread C')).toHaveCount(1);

  await page.reload();
  await expect(row(page, 'sleeping thread C')).toHaveCount(1);
  await expect(snoozedGroup(page)).toHaveCount(0);
});

test('a snooze survives a reload', async ({ page }) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await openSnoozeMenu(page, 'active thread B');
  await page.getByTestId('thread-snooze-tomorrow').click();
  await expect(row(page, 'active thread B')).toHaveCount(0);
  await page.reload();
  await expect(row(page, 'active thread B')).toHaveCount(0);
  expect(await snoozedCount(page)).toBe(2);
});
