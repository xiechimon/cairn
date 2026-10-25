import { expect, test } from '@playwright/test';

test('needs-you strip shows attention rows with a working action and hides when empty', async ({
  page,
}) => {
  await page.goto('/app?scenario=01');
  const strip = page.getByTestId('needs-you-strip');
  await expect(strip).toBeVisible();
  await expect(strip.locator('div').filter({ hasText: '待' }).first()).toBeVisible();
  const action = strip.getByRole('button').first();
  await expect(action).toBeVisible();
  await action.click();
  await expect(page).toHaveURL(/\/app/);

  await page.goto('/app?scenario=board-tags-empty');
  await expect(page.getByTestId('needs-you-strip')).toBeHidden();
});

test('the new-task bar opens the existing new-task surface', async ({ page }) => {
  await page.goto('/app?scenario=01');
  await page.getByTestId('board-new-task-bar').click();
  await expect(page.getByRole('dialog', { name: '新建任务' })).toBeVisible();
});

test('a 390px board stacks columns without horizontal scrolling or empty columns', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app?scenario=01');
  const scroller = page.getByTestId('board-scroller');
  await expect(scroller).toBeVisible();
  const metrics = await scroller.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    visibleColumns: [...element.querySelectorAll('.board-column')].filter(
      (column) => getComputedStyle(column).display !== 'none',
    ).length,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.visibleColumns).toBeLessThan(4);
  await expect(page.locator('[data-column-empty-new]')).toBeHidden();
});
