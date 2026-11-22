import { expect, type Page, test } from '@playwright/test';

const SECRETS = '/app/resources/secrets?scenario=secrets-list';
const TITLE = '添加密钥或环境变量';

async function openDialog(page: Page) {
  await page.goto(SECRETS);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: TITLE });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('topbar `新建` opens the add dialog with name, value and the `机密` checkbox', async ({
  page,
}) => {
  const dialog = await openDialog(page);
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveAttribute('placeholder', 'MY_VAR');
  await expect(dialog.getByLabel('值', { exact: true })).toBeVisible();
  await expect(dialog.getByText('加密保存在 Cairn 服务器上。')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /机密/ })).not.toBeChecked();
  await dialog.getByTestId('secret-kind').click();
  await expect(dialog.getByRole('checkbox')).toHaveCount(1);
  await expect(dialog.getByLabel('登录网站', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('名称', { exact: true }).fill('LOGIN_PASSWORD');
  await dialog.getByLabel('值', { exact: true }).fill('synthetic-password');
  await expect(dialog.getByRole('button', { name: '添加', exact: true })).toBeEnabled();
});

test('family law: X, Escape and backdrop dismiss; panel clicks do not', async ({ page }) => {
  let dialog = await openDialog(page);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByRole('dialog', { name: TITLE })).toBeHidden();

  dialog = await openDialog(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: TITLE })).toBeHidden();

  dialog = await openDialog(page);
  await dialog.getByTestId('dialog-head').click();
  await expect(page.getByRole('dialog', { name: TITLE })).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(page.getByRole('dialog', { name: TITLE })).toBeHidden();
});

test('a lowercase name shows the format line and blocks submit; an env var may be empty, a secret may not', async ({
  page,
}) => {
  const dialog = await openDialog(page);
  const submit = dialog.getByRole('button', { name: '添加', exact: true });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('名称', { exact: true }).fill('my_var');
  await expect(dialog.getByRole('alert')).toHaveText('名称要符合环境变量格式（例如 MY_VAR）');
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('名称', { exact: true }).fill('MY_VAR');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(submit).toBeEnabled();
  await dialog.getByRole('checkbox', { name: /机密/ }).click();
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('值', { exact: true }).fill('sk-test-170');
  await expect(submit).toBeEnabled();
});

test('a secret-looking name does not scold about the empty value until the field was blurred', async ({
  page,
}) => {
  const dialog = await openDialog(page);
  const alert = dialog.getByRole('alert');
  const submit = dialog.getByRole('button', { name: '添加', exact: true });
  await dialog.getByLabel('名称', { exact: true }).fill('LANGFUSE_SECRET_KEY');
  await expect(dialog.getByRole('checkbox', { name: /机密/ })).toBeChecked();
  await expect(alert).toHaveCount(0);
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('值', { exact: true }).focus();
  await dialog.getByLabel('名称', { exact: true }).focus();
  await expect(alert).toHaveText('机密的值不能为空');
  await dialog.getByLabel('值', { exact: true }).fill('sk-live');
  await expect(alert).toHaveCount(0);
  await expect(submit).toBeEnabled();
});

test('a credential-looking name ticks `机密` on its own; a manual toggle wins over later names', async ({
  page,
}) => {
  const dialog = await openDialog(page);
  const box = dialog.getByRole('checkbox', { name: /机密/ });
  await expect(box).not.toBeChecked();
  await dialog.getByLabel('名称', { exact: true }).fill('LANGFUSE_SECRET_KEY');
  await expect(box).toBeChecked();
  await dialog.getByLabel('名称', { exact: true }).fill('NODE_ENV');
  await expect(box).not.toBeChecked();
  await dialog.getByLabel('名称', { exact: true }).fill('STRIPE_API_KEY');
  await expect(box).toBeChecked();
  await box.click();
  await expect(box).not.toBeChecked();
  await dialog.getByLabel('名称', { exact: true }).fill('GH_TOKEN');
  await expect(box).not.toBeChecked();
});

test('a cancelled draft is gone when the dialog opens again', async ({ page }) => {
  let dialog = await openDialog(page);
  await dialog.getByLabel('名称', { exact: true }).fill('LEFT_OVER');
  await dialog.getByLabel('值', { exact: true }).fill('sk-draft');
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: '新建', exact: true }).click();
  dialog = page.getByRole('dialog', { name: TITLE });
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('值', { exact: true })).toHaveValue('');
});

test('the empty page offers one add action, in the empty state', async ({ page }) => {
  await page.goto('/app/resources/secrets?scenario=01');
  await expect(page.getByTestId('resource-empty').getByRole('button', { name: '添加' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新建', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('secret-bulk')).toBeVisible();
});

test('converting an empty env var opens with its name prefilled and `机密` ticked, and waits for the value field before the empty-value error', async ({
  page,
}) => {
  await page.goto(SECRETS);
  await page.getByTestId('resource-row').filter({ hasText: 'DEBUG' }).getByTestId('secret-menu').click();
  await page.getByTestId('secret-menu-convert').click();
  const dialog = page.getByRole('dialog', { name: '编辑 DEBUG' });
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue('DEBUG');
  await expect(dialog.getByRole('checkbox', { name: /机密/ })).toBeChecked();
  await expect(dialog.getByLabel('值', { exact: true })).toBeFocused();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '保存并转为机密', exact: true })).toBeDisabled();
  await dialog.getByLabel('名称', { exact: true }).focus();
  await expect(dialog.getByRole('alert')).toHaveText('机密的值不能为空');
  await dialog.getByLabel('值', { exact: true }).fill('1');
  await expect(dialog.getByRole('button', { name: '保存并转为机密', exact: true })).toBeEnabled();
});

test('fixture submit closes the dialog (accept law)', async ({ page }) => {
  const dialog = await openDialog(page);
  await dialog.getByLabel('名称', { exact: true }).fill('STRIPE_API_KEY');
  await dialog.getByLabel('值', { exact: true }).fill('sk-test-170');
  await dialog.getByRole('button', { name: '添加', exact: true }).click();
  await expect(page.getByRole('dialog', { name: TITLE })).toBeHidden();
});

test('list shows env values, hides secret values, and the row menu offers `转为机密` only for env vars', async ({
  page,
}) => {
  await page.goto('/app/resources/secrets?scenario=secrets-list');
  const env = page.getByTestId('resource-row').filter({ hasText: 'NODE_ENV' });
  await expect(env.getByTestId('secret-value')).toHaveText('development');
  const secret = page.getByTestId('resource-row').filter({ hasText: 'STRIPE_API_KEY' });
  await expect(secret.getByTestId('secret-value')).toHaveCount(0);
  await expect(secret).toContainText('机密');

  await env.getByTestId('secret-menu').click();
  await expect(page.getByTestId('secret-menu-convert')).toBeVisible();
  await page.keyboard.press('Escape');
  await secret.getByTestId('secret-menu').click();
  await expect(page.getByTestId('secret-menu-edit')).toBeVisible();
  await expect(page.getByTestId('secret-menu-convert')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('textbox', { name: '按名称筛选' }).fill('node');
  await expect(page.getByTestId('resource-row')).toHaveCount(1);
});
