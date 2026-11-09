import { expect, test } from '@playwright/test';

const EMPTY_TASKS = '/app/project/ZAQczKCu0MOAzC1ZqcFlX/tasks?scenario=r2-24b';

test('the empty-state `新建任务` button lands on the home composer with no dialog', async ({ page }) => {
  await page.goto(EMPTY_TASKS);
  await expect(page.getByText('暂无内容')).toBeVisible();
  await page.getByRole('button', { name: '新建任务' }).click();
  await expect(page).toHaveURL(/\/app\?/);
  await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toBeFocused();
  await expect(page.getByRole('dialog', { name: '新建任务' })).toHaveCount(0);
});
