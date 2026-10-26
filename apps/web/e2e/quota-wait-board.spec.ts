import { expect, test } from '@playwright/test';

const QUOTA = '/app?scenario=quota-wait';

test('suspended card carries the `等额度` chip, plain building cards do not (two pins of the card state)', async ({ page }) => {
  await page.goto(QUOTA);
  const waiting = page.locator('[data-todo-id="quota-waiting-1"]');
  await expect(waiting).toBeVisible();

  await expect(waiting.locator('[data-todo-quota="quota"]')).toHaveText('等额度');

  const plain = page.locator('[data-todo-id="quota-plain-1"]');
  await expect(plain).toBeVisible();
  await expect(plain.locator('[data-todo-quota]')).toHaveCount(0);
});

test('board banner names the relay lane and the event type (banner half)', async ({ page }) => {
  await page.goto(QUOTA);
  const banner = page.locator('[data-quota-banner]');

  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Relay 186');
  await expect(banner).toContainText('额度空');

  await expect(banner).toContainText(/\d{2}:\d{2} 自动探测/);
});

test('detail header chip says `等额度` not `执行中` (header half of the card state)', async ({ page }) => {
  await page.goto(QUOTA);
  await page.locator('[data-todo-id="quota-waiting-1"] .todo-card-link').click();
  await expect(page.getByTestId('phase-chip')).toContainText('等额度');
});

test('no-suspend baseline: 01 scenario board has zero banners and zero chips (legacy zero regression)', async ({ page }) => {
  await page.goto('/app?scenario=01&view=board');
  await expect(page.locator('[data-quota-banner]')).toHaveCount(0);
  await expect(page.locator('[data-todo-quota]')).toHaveCount(0);
});
