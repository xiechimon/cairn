import { expect, type Page, test } from '@playwright/test';

const STATES = '/app/settings/machines?scenario=folder-grants-states';

const settings = (page: Page) => page.getByRole('dialog', { name: '设置' });
const itemOf = (page: Page, machine: string) =>
  settings(page).getByTestId('machine-item').filter({ hasText: machine });

test('folder grants fold into the meta line and the drawer shows each pin state', async ({
  page,
}) => {
  await page.goto(STATES);
  const bound = itemOf(page, 'folders-mac');
  await expect(bound.getByTestId('folder-grants-meta')).toContainText('6 个文件夹');
  await bound.getByTestId('folder-grants-meta').click();
  const rows = bound.getByTestId('folder-grant');
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(0)).toContainText('/Users/ian/cairn/workspaces');
  await expect(rows.nth(0)).toContainText('始终开放');
  await expect(rows.nth(1)).toContainText('/Users/ian/Code');
  await expect(rows.nth(1)).toContainText('已开放');
  await expect(rows.nth(1).getByTestId('folder-grant-switch')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(rows.nth(2)).toContainText('/Users/ian/Documents');
  await expect(rows.nth(2)).toContainText('未开放');
  await expect(rows.nth(3)).toContainText('待 Runner 确认');
  await expect(rows.nth(3).getByTestId('folder-grant-switch')).toHaveCount(0);
  await expect(rows.nth(4)).toContainText('路径无效');
  await expect(rows.nth(5)).toContainText('已不可用');
  await expect(rows.getByTestId('folder-grant-remove')).toHaveCount(5);
});

test('a machine without a bindable sandbox keeps the confirmed pin switch off', async ({
  page,
}) => {
  await page.goto(STATES);
  const plain = itemOf(page, 'plain-mac');
  await plain.getByTestId('folder-grants-meta').click();
  const confirmed = plain.getByTestId('folder-grant').filter({ hasText: '/srv/data' });
  await expect(confirmed).toContainText('未开放');
  await expect(confirmed.getByTestId('folder-grant-switch')).toBeDisabled();
  await confirmed
    .getByRole('button', { name: '启动边界还没准备好，暂时不能开放' })
    .click();
  await expect(page.locator('[data-sonner-toast]')).toContainText('启动边界还没准备好');
});

test('a machine with no grants renders no folder meta', async ({ page }) => {
  await page.goto(STATES);
  await expect(itemOf(page, 'bare-mac').getByTestId('folder-grants-meta')).toHaveCount(0);
});
