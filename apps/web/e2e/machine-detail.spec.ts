import { expect, type Page, test } from '@playwright/test';

const REMOTE = 'Kd8fG2hJ4mN9pQ1rStUvWx3';
const LIST = '/app/settings/machines?scenario=06';
const DETAIL = `${LIST}&machine=${REMOTE}`;

const row = (page: Page) => page.getByTestId('machine-item').filter({ hasText: 'mea-wsl' });

test('opening a machine row expands its detail in place', async ({ page }) => {
  await page.goto(LIST);
  await row(page).getByTestId('machine-toggle').click();
  await expect(page).toHaveURL(new RegExp(`machine=${REMOTE}`));
  await expect(page.getByTestId('machine-detail')).toBeVisible();
  await expect(row(page).getByTestId('machine-item-status')).toHaveText('在线');
});

test('menu gate: deletable; whole-machine migrate is disabled until a target is picked', async ({ page }) => {
  await page.goto(DETAIL);

  await row(page).getByTestId('machine-menu').click();
  await expect(page.getByTestId('machine-menu-delete')).toBeEnabled();
  await page.getByTestId('machine-menu-evacuate').click();
  await expect(page.getByTestId('machine-evacuate-btn')).toBeDisabled();

  await page.locator('.machine-evacuate-select').click();
  await expect(page.locator('.machine-evacuate-row', { hasText: 'xmonsMac-3574.local' })).toBeVisible();
  await expect(page.locator('.machine-evacuate-row', { hasText: 'mea-wsl' })).toHaveCount(0);
});

test('menu delete opens a confirm layer first, cancel does not delete', async ({ page }) => {
  await page.goto(DETAIL);
  let deletes = 0;
  page.on('request', (req) => {
    if (req.method() === 'DELETE') deletes += 1;
  });
  await row(page).getByTestId('machine-menu').click();
  await page.getByTestId('machine-menu-delete').click();
  const confirm = page.getByRole('alertdialog', { name: '删除 Runner' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('mea-wsl');
  await confirm.getByRole('button', { name: '取消' }).click();
  await expect(confirm).toBeHidden();
  expect(deletes).toBe(0);
  await expect(page).toHaveURL(new RegExp(`machine=${REMOTE}`));
});
