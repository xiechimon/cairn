import { expect, type Page, test } from '@playwright/test';

const REMOTE = 'Kd8fG2hJ4mN9pQ1rStUvWx3';
const LIST = '/app/settings/machines?scenario=06';
const DETAIL = `${LIST}&machine=${REMOTE}`;

const row = (page: Page) => page.getByTestId('machine-item').filter({ hasText: 'mea-wsl' });

test('machine names are plain text and do not expand a detail', async ({ page }) => {
  await page.goto(LIST);
  await row(page).getByTestId('machine-item-name').click();
  await expect(page).not.toHaveURL(new RegExp(`machine=${REMOTE}`));
  await expect(page.getByTestId('machine-detail')).toHaveCount(0);
  await expect(row(page).getByTestId('machine-item-status')).toHaveText('在线');
});

test('menu gate: deletable; evacuate entry is retired', async ({ page }) => {
  await page.goto(DETAIL);

  await row(page).getByTestId('machine-menu').click();
  await expect(page.getByTestId('machine-menu-delete')).toBeEnabled();
  await expect(page.getByTestId('machine-menu-evacuate')).toHaveCount(0);
});

test('menu delete opens a confirm layer first, cancel does not delete', async ({ page }) => {
  await page.goto(DETAIL);
  let deletes = 0;
  page.on('request', (req) => {
    if (req.method() === 'DELETE') deletes += 1;
  });
  await row(page).getByTestId('machine-menu').click();
  await page.getByTestId('machine-menu-delete').click();
  const confirm = page.getByRole('alertdialog', { name: '删除执行机' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('mea-wsl');
  await confirm.getByRole('button', { name: '取消' }).click();
  await expect(confirm).toBeHidden();
  expect(deletes).toBe(0);
  await expect(page).toHaveURL(new RegExp(`machine=${REMOTE}`));
});
