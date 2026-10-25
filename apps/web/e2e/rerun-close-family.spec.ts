import { expect, test } from '@playwright/test';

const RERUN = '/app/todo/r8-12?scenario=56';
const REUSE = '/app/todo/r8-15?scenario=75';

for (const [name, route] of [
  ['rerun dialog (scenario 56)', RERUN],
  ['reuse panel (scenario 75)', REUSE],
] as const) {
  test(`X button closes the ${name}`, async ({ page }) => {
    await page.goto(route);
    const overlay = page.locator('.overlay');
    await expect(overlay).toBeVisible();
    await page.locator('.overlay-close').click();
    await expect(overlay).toBeHidden();
  });

  test(`Escape closes the ${name}`, async ({ page }) => {
    await page.goto(route);
    const overlay = page.locator('.overlay');
    await expect(overlay).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  });

  test(`backdrop click closes the ${name}; panel clicks do not`, async ({ page }) => {
    await page.goto(route);
    const overlay = page.locator('.overlay');
    await expect(overlay).toBeVisible();

    await page.locator('.overlay-title').click();
    await expect(overlay).toBeVisible();

    await page.mouse.click(20, 20);
    await expect(overlay).toBeHidden();
  });
}

test('reuse panel back button returns to the rerun dialog', async ({ page }) => {
  await page.goto(REUSE);
  await expect(page.locator('.overlay-title')).toHaveText('复用方案');
  await page.locator('.overlay-back').click();

  await expect(page.locator('.overlay-title')).toHaveText('开始任务');
  await expect(page.locator('.overlay')).toBeVisible();
});
