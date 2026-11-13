import { expect, type Page, test } from '@playwright/test';

const PROVIDERS = '/app/resources/providers?scenario=01';

async function openPicker(page: Page) {
  await page.goto(PROVIDERS);
  await page.getByRole('button', { name: '添加服务商' }).click();
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
  const xai = dialog.locator('[data-preset-id="xai"]');
  await expect(xai).toHaveCount(1);
  await expect(dialog.locator('[data-preset-id]', { hasText: 'xAI' })).toHaveCount(1);
  await expect(dialog.locator('[data-preset-id="google-vertex"]').getByText('VertexAI')).toHaveCount(
    0,
  );
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
  await expect(dialog.locator('#dlg-provider-label')).toHaveValue('DeepSeek');
  const connection = dialog.getByRole('button', { name: /连接设置/ });
  await expect(connection).toContainText('api.deepseek.com');
  await expect(dialog.locator('#dlg-provider-baseurl')).toHaveCount(0);
  await connection.click();
  await expect(dialog.locator('#dlg-provider-id')).toHaveValue('deepseek');
  await expect(dialog.locator('#dlg-provider-baseurl')).toHaveValue('https://api.deepseek.com');

  await dialog.getByRole('button', { name: '返回' }).click();
  await dialog.locator('[data-preset-id="xai"]').click();
  await expect(dialog.locator('#dlg-provider-label')).toHaveValue('xAI');
  await expect(dialog.getByText('Sign in with SuperGrok or X Premium')).toBeVisible();
});

test('Anthropic folds its pi route behind a summary and picks the newest Claude of each family', async ({
  page,
}) => {
  const dialog = await openPicker(page);
  await dialog.locator('[data-preset-id="anthropic"]').click();
  await expect(dialog.locator('#dlg-provider-label')).toHaveValue('Anthropic');
  const connection = dialog.getByRole('button', { name: /连接设置/ });
  await expect(connection).toContainText('api.anthropic.com · Anthropic Messages · 原生鉴权');
  const chips = dialog.locator('[data-model-chip]');
  await expect(chips).toHaveCount(4);
  const picked = await chips.evaluateAll((els) => els.map((el) => el.getAttribute('data-model-chip')));
  expect(picked).toEqual([
    'claude-sonnet-5-5',
    'claude-opus-5-5',
    'claude-haiku-5-5',
    'claude-fable-5-1',
  ]);
  await expect(dialog.locator('[data-model-chip="claude-haiku-5-5"]')).toContainText('Claude Haiku 5.5');
  await expect(dialog.getByText('目录里还有 13 个模型')).toBeVisible();

  await dialog.locator('[data-model-chip="claude-fable-5-1"]').getByRole('button', { name: '移除模型' }).click();
  await expect(chips).toHaveCount(3);

  await dialog.getByRole('button', { name: '添加模型', exact: true }).click();
  const search = page.getByLabel('搜索模型或输入 ID');
  await search.fill('opus-4-8');
  await page.getByRole('button', { name: /Claude Opus 4\.8/ }).click();
  await expect(dialog.locator('[data-model-chip="claude-opus-4-8"]')).toBeVisible();

  await dialog.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.getByLabel('搜索模型或输入 ID').fill('claude-relay-preview');
  await page.getByRole('button', { name: '添加自定义模型「claude-relay-preview」' }).click();
  await expect(dialog.locator('[data-model-chip="claude-relay-preview"]')).toBeVisible();

  await connection.click();
  await expect(dialog.locator('#dlg-provider-id')).toHaveValue('anthropic');
  await expect(dialog.locator('#dlg-provider-baseurl')).toHaveValue('https://api.anthropic.com');
  await expect(dialog.getByRole('combobox', { name: 'API 协议' })).toContainText(
    'Anthropic Messages',
  );
  await expect(dialog.locator('#dlg-provider-authheader')).not.toBeChecked();
  await dialog.locator('#dlg-provider-baseurl').fill('https://relay.example.com');
  await expect(connection).toContainText('relay.example.com');
  await expect(dialog.getByRole('button', { name: '添加模型服务' })).toBeEnabled();
});

test('a gateway preset starts with no models and finds them by search', async ({ page }) => {
  const dialog = await openPicker(page);
  await dialog.locator('[data-preset-id="openrouter"]').click();
  await expect(dialog.locator('[data-model-chip]')).toHaveCount(0);
  await dialog.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.getByLabel('搜索模型或输入 ID').fill('anthropic/claude-sonnet');
  await page.keyboard.press('Enter');
  await expect(dialog.locator('[data-model-chip]')).toHaveCount(1);
});

test('a templated base URL blocks the submit until its placeholders are replaced', async ({
  page,
}) => {
  const dialog = await openPicker(page);
  await dialog.locator('[data-preset-id="cloudflare-workers-ai"]').click();
  const baseUrl = dialog.locator('#dlg-provider-baseurl');
  await expect(baseUrl).toHaveValue(/\{CLOUDFLARE_ACCOUNT_ID\}/);
  const submit = dialog.getByRole('button', { name: '添加模型服务' });
  await expect(submit).toBeDisabled();
  await expect(dialog.getByText('把 Base URL 中的占位符换成你的账户值')).toBeVisible();
  await baseUrl.fill('https://api.cloudflare.com/client/v4/accounts/acc-1/ai/v1');
  await expect(submit).toBeEnabled();
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
  for (const id of ['relay-a', 'relay-b', 'relay-c']) {
    await dialog.getByRole('button', { name: '添加模型', exact: true }).click();
    await page.getByLabel('搜索模型或输入 ID').fill(id);
    await page.keyboard.press('Enter');
  }
  await expect(dialog.locator('[data-model-chip]')).toHaveCount(3);
  const submit = dialog.getByRole('button', { name: '添加模型服务' });
  // the panel is overflow:hidden with no max-height — the body must scroll so a
  // tall form never pushes the submit out of the viewport (live finding)
  await expect(submit).toBeInViewport();
  await submit.click();
  await expect(page.getByRole('dialog', { name: '添加模型服务' })).toBeHidden();
});
