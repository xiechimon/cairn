import { expect, test } from '@playwright/test';

const QUOTA = '/app?scenario=quota-wait';

test('home banner names the relay lane and the event type', async ({ page }) => {
  await page.goto(QUOTA);
  const banner = page.locator('[data-quota-banner]');

  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Relay 186');
  await expect(banner).toContainText('额度空');

  await expect(banner).toContainText(/\d{2}:\d{2} 自动探测/);
});

test('side chat status says `等额度` not `运行中`', async ({ page }) => {
  await page.goto('/app/todo/quota-waiting-1?scenario=quota-wait');
  await expect(page.getByTestId('side-chat-status')).toContainText('等额度');
});

test('no-suspend baseline: the 01 scenario home has zero quota banners (legacy zero regression)', async ({ page }) => {
  await page.goto('/app?scenario=01');
  await expect(page.getByTestId('home-c')).toBeVisible();
  await expect(page.locator('[data-quota-banner]')).toHaveCount(0);
});
