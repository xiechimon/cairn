import { expect, test } from '@playwright/test';

test('a running coordinator turn shows its elapsed time in the composer', async ({
  page,
}) => {
  await page.goto('/app?scenario=chief-working');
  const working = page.getByTestId('chief-composer-working');
  await expect(working).toHaveText(/^Working · 1:12$|^工作中 · 1:12$/);
});

test('an idle coordinator shows no timer', async ({ page }) => {
  await page.goto('/app?scenario=111');
  await expect(page.getByTestId('chief-composer-input')).toBeVisible();
  await expect(page.getByTestId('chief-composer-working')).toHaveCount(0);
});
