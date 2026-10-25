import { expect, type Page, test } from '@playwright/test';

const EMPTY_TASKS = '/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=r2-24b&tab=tasks';
const TITLE = '空项目第一个任务';

async function openDialog(page: Page) {
  await page.goto(EMPTY_TASKS);
  await expect(page.getByText('暂无内容')).toBeVisible();
  await page.getByRole('button', { name: '新建任务' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('the empty-state `新建任务` button opens the new-task dialog', async ({ page }) => {
  await openDialog(page);
});

test('the dialog preselects the route project on its chip', async ({ page }) => {
  const dialog = await openDialog(page);
  await expect(dialog.getByText('r3-lifecycle', { exact: true })).toBeVisible();
});

test('fixture save lands the first task row with the `刚刚` label', async ({ page }) => {
  const dialog = await openDialog(page);

  await dialog.getByRole('textbox').fill(TITLE);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await expect(page.getByText('暂无内容')).toHaveCount(0);
  const row = page.getByTestId('task-row').filter({ hasText: TITLE });
  await expect(row).toBeVisible();
  await expect(row).toContainText('刚刚');
});

test('Escape closes the dialog', async ({ page }) => {
  const dialog = await openDialog(page);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});
