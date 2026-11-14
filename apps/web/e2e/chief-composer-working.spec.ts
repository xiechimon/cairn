import { expect, test } from '@playwright/test';

test('the line under the composer shows context usage, not a turn timer', async ({ page }) => {
  await page.goto('/app?scenario=chief-draft');
  const line = page.getByTestId('home-c');
  const meter = line.getByTestId('composer-context-meter');
  await expect(meter).toBeVisible();
  await expect(meter).toHaveText('');
  await expect(meter).toHaveAttribute('aria-label', '已用 2.4万 / 20万, 7万时自动压缩');
  await expect(line.getByText(/工作中 ·|Working ·/)).toHaveCount(0);
  await meter.hover();
  const tip = page.locator('[data-slot="tooltip-content"]');
  await expect(tip).toContainText('已用 2.4万 / 20万');
  await expect(tip).toContainText('7万时自动压缩');
});

test('an idle coordinator shows the same context line and still no timer', async ({ page }) => {
  await page.goto('/app?scenario=111');
  await expect(page.getByTestId('chief-composer-input')).toBeVisible();
  await expect(page.getByTestId('home-c').getByTestId('composer-context-meter')).toBeVisible();
  await expect(page.getByText(/工作中 ·|Working ·/)).toHaveCount(0);
});
