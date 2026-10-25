import { expect, type Page, test } from '@playwright/test';

const TEAM = '/app/team?scenario=12';

async function openDialog(page: Page) {
  await page.goto(TEAM);
  await page.getByRole('button', { name: '创建 Agent' }).click();
  const dialog = page.getByRole('dialog', { name: '创建 agent' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('the top-bar `创建 Agent` opens the dialog', async ({ page }) => {
  const dialog = await openDialog(page);
  await expect(dialog).toHaveAccessibleName('创建 agent');
  await expect(dialog.getByLabel('名称')).toBeVisible();

  await expect(dialog.getByText('还没有接入机器')).toBeVisible();
  await expect(dialog.getByRole('link', { name: '接入机器' })).toBeVisible();
});

test('family law: X, Escape and backdrop dismiss; panel clicks do not', async ({ page }) => {
  let dialog = await openDialog(page);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeHidden();

  dialog = await openDialog(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeHidden();

  dialog = await openDialog(page);
  await dialog.getByTestId('dialog-head').click();
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeHidden();
});

test('empty name keeps `创建` disabled; #1259 owner machine unselected also disables; submit with both closes', async ({
  page,
}) => {

  await page.goto('/app/team?scenario=06');
  await page.getByRole('button', { name: '创建 Agent' }).click();
  const dialog = page.getByRole('dialog', { name: '创建 agent' });
  await expect(dialog).toBeVisible();
  const create = dialog.getByRole('button', { name: '创建', exact: true });
  await expect(create).toBeDisabled();
  await dialog.getByLabel('名称').fill('r7 probe agent');

  await expect(create).toBeDisabled();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: 'xmonsMac-3574.local' }).click();
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeHidden();
});

test('chart layout drops the grid; `创建 Agent` stays in the top bar', async ({ page }) => {
  await page.goto(TEAM);
  await page.getByRole('tab', { name: 'chart' }).click();

  await expect(page.getByTestId('team-chart-node')).toHaveCount(1);
  await expect(page.getByText('暂无成员')).toHaveCount(0);
  await expect(page.getByTestId('team-agent-grid')).toHaveCount(0);
  const create = page.getByRole('button', { name: '创建 Agent' });
  await expect(create).toHaveCount(1);
  await expect(page.getByTestId('page-topbar').getByRole('button', { name: '创建 Agent' })).toBeVisible();
  await create.click();
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeVisible();
});

test('`配置服务商` SPA-navigates to the providers route, scenario rides along', async ({ page }) => {

  await page.goto('/app/team?scenario=team-no-sources');
  await page.getByRole('button', { name: '创建 Agent' }).click();
  const dialog = page.getByRole('dialog', { name: '创建 agent' });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__spaMarker = 'alive';
  });
  await dialog.getByRole('link', { name: '配置服务商' }).click();
  await expect(page).toHaveURL('/app/resources/providers?scenario=team-no-sources');
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__spaMarker)).toBe(
    'alive',
  );
});

test('`接入机器` SPA-navigates to the machines route when there are no machines', async ({ page }) => {
  const dialog = await openDialog(page);
  await dialog.getByRole('link', { name: '接入机器' }).click();
  await expect(page).toHaveURL('/app/resources/machines?scenario=12');
});
