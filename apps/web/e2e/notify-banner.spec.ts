import { expect, type Page, test } from '@playwright/test';
import { stubNotification } from './helpers.js';

const banner = (page: Page) => page.getByRole('region', { name: '浏览器通知未开启' });

test('permission=default → banner renders the canon copy', async ({ page }) => {
  await stubNotification(page, 'default', 'granted');
  await page.goto('/app?scenario=notify-banner');

  await expect(banner(page)).toBeVisible();
  await expect(banner(page).getByText('浏览器通知未开启')).toHaveText('浏览器通知未开启');
  await expect(banner(page).getByText('标签页切换到后台时，通过桌面通知提醒你。')).toHaveText(
    '标签页切换到后台时，通过桌面通知提醒你。',
  );
  await expect(banner(page).getByRole('button', { name: '开启' })).toHaveText('开启');
});

test('fixture enable dismisses the banner without requesting real browser permission', async ({ page }) => {
  await stubNotification(page, 'default', 'granted');
  await page.goto('/app?scenario=notify-banner');

  await expect(banner(page)).toBeVisible();
  await banner(page).getByRole('button', { name: '开启' }).click();

  await expect(banner(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__permCalls)).toBe(0);
  expect(await page.evaluate(() => Notification.permission)).toBe('default');
});

test('scenarios without the flag never render the strip', async ({ page }) => {
  // even at a 'default' permission the fixture board stays banner-free —
  // the r7-baselined matrix rows depend on it
  await stubNotification(page, 'default', 'granted');
  await page.goto('/app?scenario=01');
  await expect(banner(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__permCalls)).toBe(0);
});
