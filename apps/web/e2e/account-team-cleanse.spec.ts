import { expect, test } from '@playwright/test';
import { stubNotification } from './helpers.js';

test('account: `退出登录` / `删除` / `更换` removed (avatar stays)', async ({ page }) => {
  await page.goto('/app/account?scenario=13');
  await expect(page.locator('.account-card')).toBeVisible();
  await expect(page.locator('.account-logout')).toHaveCount(0);
  await expect(page.locator('.account-delete')).toHaveCount(0);
  await expect(page.locator('.account-swap')).toHaveCount(0);
  await expect(page.locator('.account-avatar img')).toBeVisible();

  await expect(page.locator('.account-card .settings-row')).toHaveCount(3);
  await expect(page.locator('.account-card')).not.toContainText('邮箱');
});

test('account switch: default permission renders off; click requests and grants', async ({
  page,
}) => {
  await stubNotification(page, 'default', 'granted');
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => window.__permCalls)).toBe(1);
});

test('account switch: granted permission renders checked without a click', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await page.goto('/app/account');
  await expect(page.getByRole('switch', { name: '推送通知' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect(await page.evaluate(() => window.__permCalls)).toBe(0);
});

test('account switch: denied-state click lands the preference on-panel + interception explainer (#1031 semantic rewrite)', async ({ page }) => {
  await stubNotification(page, 'denied', 'denied');
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();

  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => window.__permCalls)).toBe(1);
  await expect(page.locator('.account-notify-blocked')).toContainText('重新允许');
});

test('team: `设置` routes to the account surface', async ({ page }) => {
  await page.goto('/app/team?scenario=12');
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/account/);
  await expect(page.locator('.account-card')).toBeVisible();
});

test('team: chart tab swaps to the org chart, persists, and returns', async ({ page }) => {
  await page.goto('/app/team?scenario=12');
  const gridTab = page.getByRole('tab', { name: 'grid' });
  const chartTab = page.getByRole('tab', { name: 'chart' });
  await expect(page.getByTestId('team-agent-card').first()).toBeVisible();

  await chartTab.click();
  await expect(page.getByTestId('team-chart-node')).toHaveCount(1);
  await expect(page.getByText('暂无成员')).toHaveCount(0);
  await expect(page.getByTestId('team-agent-card')).toHaveCount(0);
  await expect(page.getByTestId('team-agent-grid')).toHaveCount(0);
  await expect(page.getByText(/个成员/)).toHaveCount(0);
  await expect(chartTab).toHaveAttribute('aria-selected', 'true');
  await expect(gridTab).toHaveAttribute('aria-selected', 'false');

  // the choice survives a reload (cairn.teamMembersLayout)
  await page.reload();
  await expect(page.getByTestId('team-chart-node')).toBeVisible();

  // and the tablist is the way back — no trap in chart layout
  await page.getByRole('tab', { name: 'grid' }).click();
  await expect(page.getByTestId('team-agent-card').first()).toBeVisible();
  await expect(page.getByText(/个成员/)).toBeVisible();
});
