import { expect, test } from '@playwright/test';
import { stubNotification } from './helpers.js';

test('account: `退出登录` / `删除` / `更换` removed (avatar stays)', async ({ page }) => {
  await page.goto('/app/account?scenario=13');
  await expect(page.locator('.account-card')).toBeVisible();
  await expect(page.locator('.account-logout')).toHaveCount(0);
  await expect(page.locator('.account-delete')).toHaveCount(0);
  await expect(page.locator('.account-swap')).toHaveCount(0);
  await expect(page.locator('.account-avatar [data-slot="avatar"]')).toBeVisible();

  await expect(page.locator('.account-card .settings-row')).toHaveCount(2);
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

test('legacy team URLs land on work routing', async ({ page }) => {
  for (const from of ['/app/team?scenario=12', '/app/settings/team?scenario=12']) {
    await page.goto(from);
    await expect(page).toHaveURL(/\/app\/settings\/work-routing\?scenario=12$/);
    await expect(
      page.getByRole('dialog', { name: '设置' }).locator('[data-settings-section="work-routing"]'),
    ).toHaveAttribute('aria-current', 'page');
  }
});
