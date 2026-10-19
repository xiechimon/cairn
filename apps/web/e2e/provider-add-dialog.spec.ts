import { expect, type Page, test } from '@playwright/test';

// #355 (spec 11 §A6): 添加服务商 dialog = picker 形态——搜索框 + 38 行
// preset(目录 wire 真值 = shared PROVIDER_PRESET_IDS,显示名 = spec 11
// 实测名表)+ 底部「自定义端点」入口展开现有自定义表单(r3 §2 字段权威 =
// shared createProviderBodySchema:服务商 ID / 名称 / Base URL / API 协议 /
// API 密钥 + Bearer 复选 / 模型 rows)。api_key 行点击进该 preset 的密钥
// 表单 = 同一表单 + providerId/label 预填(目录未采 baseUrl/api,不发明)。
// Rides DialogShell (#68 family law) per the #170 canonical mode.
// Each test pins one failure mode:
// 1. 打开 = picker 面:38 行、搜索框、底部自定义端点入口、无 footer 死 submit
// 2. 搜索按显示名与 id 过滤(大小写不敏感);空查询回全量;零命中空列表
// 3. OAuth 徽标只骑族表已接线行(现仅 github-copilot);codex 未接线行
//    禁用 + 「暂未开通」注记(#385)
// 4. 自定义端点 → 表单字段与默认值同现状;返回列表可达
// 5. api_key 行 → 表单预填 providerId/label;xai 行 → 密钥表单内显 oauthLabel
// 6. family-law close: X / Esc / backdrop; panel clicks survive
// 7. 必填 gate + 协议段切换
// 8. fixture 提交关窗(accept 律),重开回干净 picker
// 9. 模型行撑溢时 submit 恒可达(body scrolls)
// #944/#910 载体:.res-new → role+文案;.dlg-provider-search → getByLabel;
// .dlg-provider-preset → [data-preset-id] 二级载体;.dlg-provider-custom/
// -create/-back/-model-add → getByRole(button)+文案(exact 防「添加模型」
// 前缀吞「添加模型服务」);.dlg-provider-seg-tab → 表单 Select
// (combobox「API 协议」,三个协议名放不进分段);.dlg-provider-badge/-note → 文案一级;
// #dlg-provider-* id 原样保留(§5.6)。#952/#910 重钉：壳级 .dlg/.dlg-title/
// .dlg-close → getByRole(dialog) 可及名 / getByRole(button 关闭)（§5.5）。

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

test('topbar 新建 opens the picker: 38 preset rows, search, 自定义端点 entry, no dead submit', async ({
  page,
}) => {
  const dialog = await openPicker(page);
  await expect(dialog).toHaveAccessibleName('添加模型服务');
  await expect(dialog.getByLabel('搜索服务商...')).toBeVisible();
  await expect(dialog.locator('[data-preset-id]')).toHaveCount(38);
  await expect(dialog.getByRole('button', { name: '自定义端点' })).toHaveText('自定义端点');
  // 目录序 = server providerPresets() wire 序(oauth 2 + xai 打头)
  await expect(dialog.locator('[data-preset-id]').first()).toContainText('GitHub Copilot');
  // #222:picker 面无必填字段,不得渲染禁用态 submit
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
  await expect(dialog.getByText('(OAuth)')).toHaveCount(1);
  await expect(
    dialog.locator('[data-preset-id]', { hasText: 'GitHub Copilot' }).getByText('(OAuth)'),
  ).toHaveCount(1);
  // #385:openai-codex 族表未接线——徽标摘除,行禁用 + 「暂未开通」注记
  const codex = dialog.locator('[data-preset-id]', { hasText: 'OpenAI Codex' });
  await expect(codex.getByText('(OAuth)')).toHaveCount(0);
  await expect(codex).toBeDisabled();
  await expect(codex.getByText('暂未开通')).toHaveText('暂未开通');
  const xai = dialog.locator('[data-preset-id]', { hasText: 'xAI' });
  await expect(xai).toHaveCount(1);
  await expect(xai.getByText('(OAuth)')).toHaveCount(0);
  // xai oauthLabel 的展示位 = 其密钥表单,picker 面不出现
  await expect(dialog.getByText('SuperGrok')).toHaveCount(0);
});

test('自定义端点 opens the existing form (fields and defaults unchanged); 返回 walks back', async ({
  page,
}) => {
  const dialog = await openPicker(page);
  await dialog.getByRole('button', { name: '自定义端点' }).click();
  await expect(dialog.locator('#dlg-provider-id')).toHaveValue('');
  await expect(dialog.locator('#dlg-provider-label')).toBeVisible();
  await expect(dialog.locator('#dlg-provider-baseurl')).toBeVisible();
  await expect(dialog.locator('#dlg-provider-apikey')).toBeVisible();
  // r3 §2 defaults: OpenAI Completions protocol active, Bearer checkbox on
  // (协议 = 表单 Select,选中值在 combobox 文案上)
  await expect(dialog.getByRole('combobox', { name: 'API 协议' })).toContainText(
    'OpenAI Completions',
  );
  await expect(dialog.locator('#dlg-provider-authheader')).toBeChecked();
  await expect(dialog.getByRole('button', { name: '添加模型服务' })).toBeDisabled();
  // 返回列表
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
  // 目录未采 baseUrl——留空由用户填,不发明
  await expect(dialog.locator('#dlg-provider-baseurl')).toHaveValue('');
  // 换 preset 进入 = 干净表单(不带上一 preset 的残值)
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

test('fixture submit closes the dialog (accept 律) and reopens a clean picker', async ({
  page,
}) => {
  const dialog = await openCustomForm(page);
  await dialog.locator('#dlg-provider-id').fill('relay-355');
  await dialog.locator('#dlg-provider-label').fill('R 355 网关');
  await dialog.locator('#dlg-provider-baseurl').fill('https://relay-355.example.com/v1');
  await dialog.getByRole('button', { name: '添加模型服务' }).click();
  await expect(page.getByRole('dialog', { name: '添加模型服务' })).toBeHidden();
  // reopen: picker 面全量列表 + 空搜索;表单字段随 open→false 边全重置
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
