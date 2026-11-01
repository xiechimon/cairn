import { expect, type Page, test } from '@playwright/test';

const ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=19';

async function openAssignDialog(page: Page) {
  await page.goto(ROUTE);
  await expect(page.getByTestId('detail-head')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('dialog', { name: '搜索' }).getByRole('button', { name: '编辑分配…' }).click();
  const dialog = page.getByRole('dialog', { name: '选择执行 Agent' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('edit assignment opens the agent pick dialog with search + bound row checked', async ({ page }) => {
  const dialog = await openAssignDialog(page);
  await expect(dialog).toHaveAccessibleName('选择执行 Agent');

  await expect(dialog.getByPlaceholder('搜索 Agent…')).toBeVisible();
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await expect(dialog.getByRole('option').getByText('r3-builder')).toHaveText('r3-builder');

  await expect(dialog.getByRole('option')).toHaveAttribute('aria-selected', 'true');
});

test('fixture pick closes the dialog (accept law)', async ({ page }) => {
  const dialog = await openAssignDialog(page);
  await dialog.getByRole('option').click();
  await expect(page.getByRole('dialog', { name: '选择执行 Agent' })).toBeHidden();
});

test('assign dialog family law: X, Escape and backdrop dismiss; panel clicks do not', async ({
  page,
}) => {
  let dialog = await openAssignDialog(page);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByRole('dialog', { name: '选择执行 Agent' })).toBeHidden();

  dialog = await openAssignDialog(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '选择执行 Agent' })).toBeHidden();

  dialog = await openAssignDialog(page);
  await dialog.getByTestId('dialog-head').click();
  await expect(page.getByRole('dialog', { name: '选择执行 Agent' })).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(page.getByRole('dialog', { name: '选择执行 Agent' })).toBeHidden();
});

test('assign dialog search filters the list; no match shows the empty row', async ({ page }) => {
  const dialog = await openAssignDialog(page);

  await dialog.getByPlaceholder('搜索 Agent…').fill('不存在');
  await expect(dialog.getByRole('option')).toHaveCount(0);
  await expect(dialog.getByText('没有匹配的 Agent')).toHaveText('没有匹配的 Agent');
  await dialog.getByPlaceholder('搜索 Agent…').fill('r3');
  await expect(dialog.getByRole('option')).toHaveCount(1);
});
