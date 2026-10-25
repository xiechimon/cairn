import { expect, type Page, test } from '@playwright/test';

const SECRETS = '/app/resources/secrets?scenario=01';

async function openDialog(page: Page) {
  await page.goto(SECRETS);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加密钥' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('topbar `新建` opens the `添加密钥` dialog with the captured fields', async ({ page }) => {
  const dialog = await openDialog(page);
  await expect(dialog).toHaveAccessibleName('添加密钥');

  await expect(dialog.getByLabel('名称（环境变量名）')).toHaveAttribute(
    'placeholder',
    'STRIPE_API_KEY',
  );
  await expect(dialog.getByLabel('描述（可选）')).toHaveAttribute('placeholder', '该密钥的用途');
  await expect(dialog.getByLabel('值')).toHaveAttribute('placeholder', '粘贴密钥的值');
  await expect(dialog.getByText('值将加密存储')).toContainText('值将加密存储');
});

test('family law: X, Escape and backdrop dismiss; panel clicks do not', async ({ page }) => {
  let dialog = await openDialog(page);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByRole('dialog', { name: '添加密钥' })).toBeHidden();

  dialog = await openDialog(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '添加密钥' })).toBeHidden();

  dialog = await openDialog(page);
  await dialog.getByTestId('dialog-head').click();
  await expect(page.getByRole('dialog', { name: '添加密钥' })).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(page.getByRole('dialog', { name: '添加密钥' })).toBeHidden();
});

test('empty name or value keeps the submit disabled; filling lifts it', async ({ page }) => {
  const dialog = await openDialog(page);
  const submit = dialog.getByRole('button', { name: '添加密钥' });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('名称（环境变量名）').fill('STRIPE_API_KEY');
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('值').fill('sk-test-170');
  await expect(submit).toBeEnabled();
});

test('fixture submit closes the dialog (accept law)', async ({ page }) => {
  const dialog = await openDialog(page);
  await dialog.getByLabel('名称（环境变量名）').fill('STRIPE_API_KEY');
  await dialog.getByLabel('值').fill('sk-test-170');
  await dialog.getByRole('button', { name: '添加密钥' }).click();
  await expect(page.getByRole('dialog', { name: '添加密钥' })).toBeHidden();
});
