import { expect, type Page, test } from '@playwright/test';

const STATES = '/app/settings/machines?scenario=computer-grants-states';

const settings = (page: Page) => page.getByRole('dialog', { name: '设置' });
const itemOf = (page: Page, machine: string) =>
  settings(page).getByTestId('machine-item').filter({ hasText: machine });

test('computer grants fold into the meta line and the drawer shows both grants', async ({
  page,
}) => {
  await page.goto(STATES);
  const capable = itemOf(page, 'capable-mac');
  const meta = capable.getByTestId('computer-grants-meta');
  await expect(meta).toContainText('电脑控制');
  await meta.click();
  const rows = capable.getByTestId('computer-grants-drawer').locator('li');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('浏览器');
  await expect(rows.nth(0)).toContainText('默认开启');
  await expect(rows.nth(1)).toContainText('桌面和命令');
  await expect(rows.nth(0).getByTestId('computer-grant-switch-browserOverride')).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('an explicit off shows in the meta count and the switch is off', async ({ page }) => {
  await page.goto(STATES);
  const off = itemOf(page, 'no-browser-mac');
  const meta = off.getByTestId('computer-grants-meta');
  await expect(meta).toContainText('1 项已关');
  await meta.click();
  const row = off.getByTestId('computer-grant-browserOverride');
  await expect(row).toContainText('已关闭');
  await expect(row.getByTestId('computer-grant-switch-browserOverride')).toHaveAttribute(
    'aria-checked',
    'false',
  );
  const desktop = off.getByTestId('computer-grant-desktopOverride');
  await expect(desktop).toContainText('默认开启');
});

test('an unsupported machine explains the disabled switch and keeps rows visible when overrides exist', async ({
  page,
}) => {
  await page.goto(STATES);
  const plain = itemOf(page, 'plain-mac');
  await expect(plain.getByTestId('computer-grants-meta')).toHaveCount(0);
  const pinned = itemOf(page, 'pinned-mac');
  await pinned.getByTestId('computer-grants-meta').click();
  await expect(pinned.getByTestId('computer-grant-browserOverride')).toContainText('已开启');
  await expect(
    pinned.getByTestId('computer-grant-switch-browserOverride'),
  ).toHaveAttribute('aria-checked', 'true');
});
