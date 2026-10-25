import { expect, test } from '@playwright/test';

const SETTINGS = '/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c';

test('settings: target branch is a static chip, not a button', async ({ page }) => {
  await page.goto(SETTINGS);
  const chip = page.getByText('main', { exact: true });
  await expect(chip).toBeVisible();

  await expect(chip.locator('svg')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /main/ })).toHaveCount(0);
});
