import { expect, test } from '@playwright/test';

const LIST = '/app/resources/machines?scenario=06';
const DETAIL = '/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06';

test('list row machine name is a link → detail page', async ({ page }) => {
  await page.goto(LIST);
  await page.getByRole('link', { name: 'mea-wsl' }).click();
  await expect(page).toHaveURL(DETAIL);
  await expect(page.getByTestId('machine-detail-online')).toBeVisible();
});

test('detail page fact strip + grid lists only agents bound to this machine', async ({ page }) => {
  await page.goto(DETAIL);
  await expect(page.getByTestId('machine-detail-online')).toContainText('在线');

  await expect(page.getByTestId('team-agent-grid')).toBeVisible();
  await expect(page.getByTestId('team-agent-card')).toHaveCount(0);
});

test('create slot preselects this machine as the owner machine', async ({ page }) => {
  await page.goto(DETAIL);
  await page.getByRole('button', { name: '创建 Agent' }).click();
  const dialog = page.getByRole('dialog', { name: '创建 agent' });
  await expect(dialog).toBeVisible();

  await expect(dialog.locator('.dlg-agent-machine-select')).toContainText('mea-wsl');
  await dialog.getByLabel('名称').fill('probe');
  await expect(dialog.getByRole('button', { name: '创建', exact: true })).toBeEnabled();
});

test('delete gate: deletable with no bound agents; disabled when a whole-machine migrate has no target picked', async ({ page }) => {
  await page.goto(DETAIL);

  await expect(page.getByRole('button', { name: '删除', exact: true })).toBeEnabled();
  await expect(page.getByTestId('machine-evacuate-btn')).toBeDisabled();

  await page.locator('.machine-evacuate-select').click();
  await expect(page.locator('.machine-evacuate-row', { hasText: 'xmonsMac-3574.local' })).toBeVisible();
  await expect(page.locator('.machine-evacuate-row', { hasText: 'mea-wsl' })).toHaveCount(0);
});

test('danger-zone delete opens a confirm layer first, cancel does not delete', async ({ page }) => {
  await page.goto(DETAIL);
  const danger = page.locator('.settings-card').last();
  await expect(danger).toContainText('删除机器');
  let deletes = 0;
  page.on('request', (req) => {
    if (req.method() === 'DELETE') deletes += 1;
  });
  await danger.getByRole('button', { name: '删除', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: '删除机器' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('mea-wsl');
  await confirm.getByRole('button', { name: '取消' }).click();
  await expect(confirm).toBeHidden();
  expect(deletes).toBe(0);
  await expect(page).toHaveURL(DETAIL);
});
