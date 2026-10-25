import { expect, type Page, test } from '@playwright/test';

const PROVIDERS = '/app/resources/providers?scenario=01';

async function openPicker(page: Page) {
  await page.goto(PROVIDERS);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加模型服务' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openCustomForm(page: Page) {
  const dialog = await openPicker(page);
  await dialog.getByRole('button', { name: '自定义端点' }).click();
  await expect(dialog.locator('#dlg-provider-id')).toBeVisible();
  return dialog;
}

test('topbar `新建` opens the picker: 38 preset rows, search, `自定义端点` entry, no dead submit', async ({
  page,
}) => {
  const dialog = await openPicker(page);
  await expect(dialog).toHaveAccessibleName('添加模型服务');
  await expect(dialog.getByLabel('搜索服务商...')).toBeVisible();
  await expect(dialog.locator('[data-preset-id]')).toHaveCount(38);
  await expect(dialog.getByRole('button', { name: '自定义端点' })).toHaveText('自定义端点');

  await expect(dialog.locator('[data-preset-id]').first()).toContainText('GitHub Copilot');

  await expect(dialog.getByRole('button', { name: '添加模型服务' })).toHaveCount(0);
});

test('search filters by display name and id, case-insensitive; empty query restores 38', async ({
  page,
}) => {
  const dialog = await openPicker(page);
  const search = dialog.getByLabel('搜索服务商...');
  await search.fill('deepseek');
  await expect(dialog.locator('[data-preset-id]')).toHaveCount(1);
  await expect(dialog.locator('[data-preset-id]').first()).toContainText('DeepSeek');
  await search.fill('MOONSHOT');
  await expect(dialog.locator('[data-preset-id]')).toHaveCount(2);
  await search.fill('z-ai');
  await expect(dialog.locator('[data-preset-id]')).toHaveCount(2);
  await search.fill('no-such-provider');
  await expect(dialog.locator('[data-preset-id]')).toHaveCount(0);
  await search.fill('');
  await expect(dialog.locator('[data-preset-id]')).toHaveCount(38);
});

test('OAuth badge rides wired family rows only (github-copilot); codex unwired carries a note, xai none', async ({
  page,
}) => {
  const dialog = await openPicker(page);
  await expect(dialog.getByText('OAuth', { exact: true })).toHaveCount(1);
  await expect(
    dialog.locator('[data-preset-id]', { hasText: 'GitHub Copilot' }).getByText('OAuth', { exact: true }),
  ).toHaveCount(1);

  const codex = dialog.locator('[data-preset-id]', { hasText: 'OpenAI Codex' });
  await expect(codex.getByText('OAuth', { exact: true })).toHaveCount(0);
  await expect(codex).toBeDisabled();
  await expect(codex.getByText('暂未开通')).toHaveText('暂未开通');
  const xai = dialog.locator('[data-preset-id]', { hasText: 'xAI' });
  await expect(xai).toHaveCount(1);
  await expect(xai.getByText('OAuth', { exact: true })).toHaveCount(0);

  await expect(dialog.getByText('SuperGrok')).toHaveCount(0);
});

test('`自定义端点` opens the existing form (fields and defaults unchanged); `返回` walks back', async ({
  page,
}) => {
  const dialog = await openPicker(page);
  await dialog.getByRole('button', { name: '自定义端点' }).click();
  await expect(dialog.locator('#dlg-provider-id')).toHaveValue('');
  await expect(dialog.locator('#dlg-provider-label')).toBeVisible();
  await expect(dialog.locator('#dlg-provider-baseurl')).toBeVisible();
  await expect(dialog.locator('#dlg-provider-apikey')).toBeVisible();

  await expect(dialog.getByRole('combobox', { name: 'API 协议' })).toContainText(
    'OpenAI Completions',
  );
  await expect(dialog.locator('#dlg-provider-authheader')).toBeChecked();
  await expect(dialog.getByRole('button', { name: '添加模型服务' })).toBeDisabled();

  await dialog.getByRole('button', { name: '返回' }).click();
  await expect(dialog.locator('[data-preset-id]')).toHaveCount(38);
  await expect(dialog.locator('#dlg-provider-id')).toHaveCount(0);
});

test('api_key row enters its preset key form prefilled; xai form shows the oauthLabel', async ({
  page,
}) => {
  const dialog = await openPicker(page);
  await dialog.locator('[data-preset-id]', { hasText: 'DeepSeek' }).click();
  await expect(dialog.locator('#dlg-provider-id')).toHaveValue('deepseek');
  await expect(dialog.locator('#dlg-provider-label')).toHaveValue('DeepSeek');

  await expect(dialog.locator('#dlg-provider-baseurl')).toHaveValue('');

  await dialog.getByRole('button', { name: '返回' }).click();
  await dialog.locator('[data-preset-id]', { hasText: 'xAI' }).click();
  await expect(dialog.locator('#dlg-provider-id')).toHaveValue('xai');
  await expect(dialog.locator('#dlg-provider-label')).toHaveValue('xAI');
  await expect(dialog.getByText('Sign in with SuperGrok or X Premium')).toBeVisible();
});

test('family law: X, Escape and backdrop dismiss; panel clicks do not', async ({ page }) => {
  let dialog = await openPicker(page);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByRole('dialog', { name: '添加模型服务' })).toBeHidden();

  dialog = await openPicker(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '添加模型服务' })).toBeHidden();

  dialog = await openPicker(page);
  await dialog.getByTestId('dialog-head').click();
  await expect(page.getByRole('dialog', { name: '添加模型服务' })).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(page.getByRole('dialog', { name: '添加模型服务' })).toBeHidden();
});

test('providerId/label/baseUrl gate the submit; protocol select swaps', async ({ page }) => {
  const dialog = await openCustomForm(page);
  const submit = dialog.getByRole('button', { name: '添加模型服务' });
  await expect(submit).toBeDisabled();
  await dialog.locator('#dlg-provider-id').fill('relay-355');
  await expect(submit).toBeDisabled();
  await dialog.locator('#dlg-provider-label').fill('R 355 网关');
  await expect(submit).toBeDisabled();
  await dialog.locator('#dlg-provider-baseurl').fill('https://relay-355.example.com/v1');
  await expect(submit).toBeEnabled();
  // protocol select swaps the value
  const api = dialog.getByRole('combobox', { name: 'API 协议' });
  await api.click();
  await page.getByRole('option', { name: 'Anthropic Messages' }).click();
  await expect(api).toContainText('Anthropic Messages');
});

test('fixture submit closes the dialog (accept law) and reopens a clean picker', async ({
  page,
}) => {
  const dialog = await openCustomForm(page);
  await dialog.locator('#dlg-provider-id').fill('relay-355');
  await dialog.locator('#dlg-provider-label').fill('R 355 网关');
  await dialog.locator('#dlg-provider-baseurl').fill('https://relay-355.example.com/v1');
  await dialog.getByRole('button', { name: '添加模型服务' }).click();
  await expect(page.getByRole('dialog', { name: '添加模型服务' })).toBeHidden();

  const again = await openPicker(page);
  await expect(again.locator('[data-preset-id]')).toHaveCount(38);
  await expect(again.getByLabel('搜索服务商...')).toHaveValue('');
  await again.getByRole('button', { name: '自定义端点' }).click();
  await expect(again.locator('#dlg-provider-id')).toHaveValue('');
  await expect(again.locator('#dlg-provider-label')).toHaveValue('');
  await expect(again.locator('#dlg-provider-baseurl')).toHaveValue('');
  await expect(again.locator('#dlg-provider-apikey')).toHaveValue('');
  await expect(again.getByRole('button', { name: '添加模型服务' })).toBeDisabled();
});

test('model rows keep the submit reachable (dialog body scrolls)', async ({ page }) => {
  const dialog = await openCustomForm(page);
  await dialog.locator('#dlg-provider-id').fill('relay-355');
  await dialog.locator('#dlg-provider-label').fill('R 355 网关');
  await dialog.locator('#dlg-provider-baseurl').fill('https://relay-355.example.com/v1');
  const addModel = dialog.getByRole('button', { name: '添加模型', exact: true });
  await addModel.click();
  await addModel.click();
  await addModel.click();
  await expect(dialog.locator('[aria-label="模型 ID"]')).toHaveCount(3);
  const submit = dialog.getByRole('button', { name: '添加模型服务' });
  // the panel is overflow:hidden with no max-height — the body must scroll so a
  // tall form never pushes the submit out of the viewport (live finding)
  await expect(submit).toBeInViewport();
  await submit.click();
  await expect(page.getByRole('dialog', { name: '添加模型服务' })).toBeHidden();
});
