import { expect, type Page, test } from '@playwright/test';

const VAULT = '/app/settings/vault?scenario=vault-list';
const VAULT_EMPTY = '/app/settings/vault?scenario=vault-empty';

for (const locale of ['zh', 'en'] as const) {
  test(`settings search finds the vault by site authorization (${locale})`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn.locale', value), locale);
    await page.goto('/app/settings/account?scenario=vault-list');
    await page.getByLabel(locale === 'zh' ? '搜索设置' : 'Search settings').fill(
      locale === 'zh' ? '授权' : 'authorization',
    );
    const result = page.locator('[data-settings-result="vault"]');
    await expect(result).toBeVisible();
    await result.click();
    await expect(page.getByTestId('settings-head')).toHaveText(locale === 'zh' ? '保险库' : 'Vault');
  });
}

test('the vault lists saved site logins masked and site authorizations with revoke', async ({
  page,
}) => {
  await page.goto(VAULT);
  await expect(page.getByRole('heading', { name: '保险库', exact: true })).toBeVisible();
  const pairs = page.getByTestId('resource-group').nth(0);
  await expect(pairs.getByText('GITHUB_COM', { exact: true })).toBeVisible();
  await expect(pairs.getByText('github.com', { exact: true })).toBeVisible();
  await expect(pairs.getByText('NOTION_SO', { exact: true })).toBeVisible();
  await expect(pairs.getByText('用户名和密码').first()).toBeVisible();
  await expect(page.getByText('alice@example.com')).toHaveCount(0);
  const grants = page.getByTestId('resource-group').nth(1);
  await expect(grants.getByText('github.com', { exact: true })).toBeVisible();
  await expect(grants.getByText('www.notion.so', { exact: true })).toBeVisible();
  await expect(grants.getByText('xmonsMac-3574.local', { exact: true }).first()).toBeVisible();
  await expect(grants.getByTestId('vault-grant-revoke')).toHaveCount(1);
  await expect(grants.getByText('已失效', { exact: true })).toBeVisible();
  await expect(grants.getByText('已撤销', { exact: true })).toBeVisible();
});

test('the empty vault shows one add action for logins and the empty grant line', async ({
  page,
}) => {
  await page.goto(VAULT_EMPTY);
  await expect(page.getByTestId('vault-empty')).toBeVisible();
  await expect(
    page.getByTestId('vault-empty').getByRole('button', { name: '添加登录', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('vault-new')).toHaveCount(0);
  await expect(page.getByText('还没有批准过的网站', { exact: true })).toBeVisible();
});

async function openAddDialog(page: Page) {
  await page.goto(VAULT);
  await page.getByTestId('vault-new').click();
  const dialog = page.getByRole('dialog', { name: '添加网站登录' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('the add dialog derives the name from the site and validates all fields', async ({
  page,
}) => {
  const dialog = await openAddDialog(page);
  const submit = dialog.getByRole('button', { name: '添加', exact: true });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('网站', { exact: true }).fill('https://github.com/login');
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue('GITHUB_COM');
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('用户名', { exact: true }).fill('alice@example.com');
  await dialog.getByLabel('密码', { exact: true }).fill('synthetic-password');
  await expect(submit).toBeEnabled();
});

test('a hand-edited name is kept and an invalid name blocks submit', async ({ page }) => {
  const dialog = await openAddDialog(page);
  await dialog.getByLabel('网站', { exact: true }).fill('github.com');
  await dialog.getByLabel('名称', { exact: true }).fill('my login');
  await dialog.getByLabel('网站', { exact: true }).fill('gitlab.com');
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue('my login');
  await expect(dialog.getByRole('alert')).toHaveText('名称要符合环境变量格式（例如 MY_VAR）');
  await dialog.getByLabel('用户名', { exact: true }).fill('alice');
  await dialog.getByLabel('密码', { exact: true }).fill('synthetic-password');
  await expect(dialog.getByRole('button', { name: '添加', exact: true })).toBeDisabled();
});

test('the row menu opens edit with the saved name and site, never the credentials', async ({
  page,
}) => {
  await page.goto(VAULT);
  await page.getByTestId('vault-entry-menu').first().click();
  await page.getByTestId('vault-entry-edit').click();
  const dialog = page.getByRole('dialog', { name: '编辑 GITHUB_COM' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('网站', { exact: true })).toHaveValue('github.com');
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue('GITHUB_COM');
  await expect(dialog.getByLabel('用户名', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('密码', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
});
