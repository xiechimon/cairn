import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const SETTINGS = '/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c';
const PROJECT_NAME = 'r3-lifecycle';

const PROJECT_ROW = `aside [data-slot="sidebar-project-row"]:has-text("${PROJECT_NAME}")`;

async function openConfirm(page: Page) {
  await page.goto(SETTINGS);
  await page.getByRole('button', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('danger card renders and opens the project delete confirm', async ({ page }) => {
  await page.goto(SETTINGS);
  await expect(page.getByText('危险操作')).toHaveText('危险操作');
  await expect(page.getByText('删除项目', { exact: true })).toHaveText('删除项目');
  const dialog = await openConfirm(page);
  await expect(dialog).toHaveAttribute('role', 'alertdialog');
  await expect(dialog.getByText('确定删除该项目？此操作不可撤销。')).toBeVisible();
  await expect(dialog.getByText(PROJECT_NAME, { exact: true })).toHaveText(PROJECT_NAME);
  await expect(dialog.getByText(`输入 ${PROJECT_NAME} 以确认删除`)).toBeVisible();
});

test('family-law close: `取消` / X / Esc / backdrop — nothing deleted, no navigation', async ({
  page,
}) => {
  let dialog = await openConfirm(page);
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/settings/);

  dialog = await openConfirm(page);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toBeHidden();

  dialog = await openConfirm(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  dialog = await openConfirm(page);

  await page.mouse.click(20, 20);
  await expect(dialog).toBeHidden();

  await expect(page.locator(PROJECT_ROW)).toBeVisible();
});

test('confirm input gates the delete button — mismatch disables, exact match enables', async ({
  page,
}) => {
  const dialog = await openConfirm(page);
  const del = dialog.getByRole('button', { name: '删除' });
  const input = dialog.getByRole('textbox');
  await expect(del).toBeDisabled();
  await input.fill('not-the-project');
  await expect(del).toBeDisabled();

  await input.fill(` ${PROJECT_NAME} `);
  await expect(del).toBeDisabled();
  await input.fill(PROJECT_NAME);
  await expect(del).toBeEnabled();
});

test('confirm deletes and lands on the board with the project row gone', async ({ page }) => {
  const dialog = await openConfirm(page);
  await dialog.getByRole('textbox').fill(PROJECT_NAME);
  await dialog.getByRole('button', { name: '删除' }).click();
  await expect(page).toHaveURL('/app');

  await expect(page.locator(PROJECT_ROW)).toHaveCount(0);
});

test('while projects load, every tab shows the loading state instead of empty rows', async ({
  page,
}) => {
  await mockLive(page, { threads: [], messages: [], todos: [] });
  await page.route('**/api/projects?**', () => undefined);
  await page.route('**/api/projects', () => undefined);
  for (const tab of ['basic', 'repo', 'memory']) {
    await page.goto(`/app/project/p-loading/settings?tab=${tab}`);
    await expect(page.getByTestId('project-loading')).toBeVisible();
    await expect(page.locator('.prj-set-card')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
  }
});

test('an id the fixture does not list shows not found instead of an empty form', async ({
  page,
}) => {
  await page.goto('/app/project/nope-project/settings?scenario=activity');
  await expect(page.getByTestId('project-settings-missing')).toContainText('找不到这个项目');
  await expect(page.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
});
