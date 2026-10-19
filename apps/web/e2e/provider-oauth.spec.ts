import { expect, type Page, test } from '@playwright/test';

// #231 OAuth 链在 #355 picker 形态下的钉扎(spec 11 §A5:授权链全留,
// preset 仅在 dialog 内出现;§A6:OAuth 族行带徽标)。钉的失败方式:
// 1. OAuth 徽标行 = 族表(OAUTH_FAMILIES)已接线的 PROVIDER_OAUTH_PRESET_IDS
//    成员——现仅 GitHub Copilot;openai-codex 族未接线(#385:徽标摘除,
//    行禁用 + 右端「暂未开通」注记,点击零动作——不发 authorize、不进表单、
//    不关窗);xai 双通道行不带徽标(oauthLabel 只在其密钥表单内)。
//    已接线徽标行点击有后端面(live = POST authorize),非 #222 死钮。
// 2. fixture 点击已接线徽标行 = accept 律(点连接即关窗;live 面 = POST
//    authorize → 同页签跳走,真链路由 server test/oauth.test.ts 覆盖)
// 3. callback 着陆参 ?oauth=error&reason=denied → 自动重开弹窗(picker 面)
//    + inline 文案 + 清参(刷新不重放)
// 4. reason=exchange → 交换失败文案(#243 三译)
// 5. reason=state(#243:state 缺/过期改 302 着陆)→ 过期文案 + 重开弹窗
// 6. ?oauth=connected 静默着陆(不弹窗、无错误行)
// #944/#910 载体:.res-new → role+文案;.dlg-provider-preset →
// [data-preset-id];.dlg-provider-badge → '(OAuth)' 文案;
// .dlg-provider-note → '暂未开通' 文案;.dlg-provider-oauth-error →
// role=alert(错误行语义载体,随本票落 DOM)。

const PROVIDERS = '/app/resources/providers?scenario=01';

async function openDialog(page: Page) {
  await page.goto(PROVIDERS);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加模型服务' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('OAuth 徽标只骑已接线族(GitHub Copilot),codex 未接线行无徽标,xai 无徽标', async ({
  page,
}) => {
  const dialog = await openDialog(page);
  await expect(dialog.getByText('OAuth', { exact: true })).toHaveCount(1);
  await expect(
    dialog.locator('[data-preset-id]', { hasText: 'GitHub Copilot' }).getByText('OAuth', { exact: true }),
  ).toHaveCount(1);
  // #385:openai-codex 族表未接线——徽标摘除,行禁用 + 右端「暂未开通」注记
  const codex = dialog.locator('[data-preset-id]', { hasText: 'OpenAI Codex' });
  await expect(codex.getByText('OAuth', { exact: true })).toHaveCount(0);
  await expect(codex).toBeDisabled();
  await expect(codex.getByText('暂未开通')).toHaveText('暂未开通');
  // xai = api_key 行:picker 面不渲染其 oauthLabel(展示位在密钥表单内)
  await expect(dialog.locator('[data-preset-id]', { hasText: 'xAI' }).first()).not.toContainText(
    'SuperGrok',
  );
  await expect(dialog.getByText('SuperGrok')).toHaveCount(0);
});

// #385:未接线行点击零动作——不发 authorize(fixture accept 律不触发 = 不关窗)、
// 不进 api_key 表单,picker 面原样。
test('codex 未接线行点击零动作:不关窗、不进表单', async ({ page }) => {
  const dialog = await openDialog(page);
  const codex = dialog.locator('[data-preset-id]', { hasText: 'OpenAI Codex' });
  await codex.click({ force: true });
  await expect(page.getByRole('dialog', { name: '添加模型服务' })).toBeVisible();
  await expect(dialog.locator('#dlg-provider-id')).toHaveCount(0);
  await expect(codex).toBeDisabled();
});

test('fixture 面点已接线徽标行 = accept 律(关窗),重开列表仍在', async ({ page }) => {
  const dialog = await openDialog(page);
  await dialog.locator('[data-preset-id]', { hasText: 'GitHub Copilot' }).click();
  await expect(page.getByRole('dialog', { name: '添加模型服务' })).toBeHidden();
  const again = await openDialog(page);
  await expect(again.getByText('OAuth', { exact: true })).toHaveCount(1);
  await expect(again.getByRole('alert')).toHaveCount(0);
});

test('着陆参 oauth=error&reason=denied 自动重开弹窗 + 文案 + 清参', async ({ page }) => {
  await page.goto(`${PROVIDERS}&oauth=error&reason=denied`);
  const dialog = page.getByRole('dialog', { name: '添加模型服务' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveText('授权已被取消。');
  // 清参后刷新不重放
  await expect(page).toHaveURL((url) => !url.searchParams.has('oauth'));
  await page.reload();
  await expect(page.getByRole('dialog', { name: '添加模型服务' })).toHaveCount(0);
});

test('着陆参 oauth=error&reason=exchange 走交换失败文案', async ({ page }) => {
  await page.goto(`${PROVIDERS}&oauth=error&reason=exchange`);
  const dialog = page.getByRole('dialog', { name: '添加模型服务' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveText('令牌交换失败，请稍后重试。');
});

// #243：state 缺/过期 callback 改 302 着陆（不再裸 400）——reason=state 走
// 过期文案 + 自动重开弹窗，用户可原地重试。
test('着陆参 oauth=error&reason=state 走过期文案 + 重开弹窗', async ({ page }) => {
  await page.goto(`${PROVIDERS}&oauth=error&reason=state`);
  const dialog = page.getByRole('dialog', { name: '添加模型服务' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveText('连接已过期，请重新发起。');
});

test('着陆参 oauth=connected 静默：不弹窗、无错误行', async ({ page }) => {
  await page.goto(`${PROVIDERS}&oauth=connected&provider=github-copilot`);
  // 落参处理本身是观测面（URL 摘参）——SSE 长连接令 networkidle 永不落定
  // （本机实测 30s 恒超时），等处理完成的可观测信号而不是网络静默。
  await expect(page).toHaveURL((url) => !url.searchParams.has('oauth'), { timeout: 10_000 });
  await expect(page.getByRole('dialog', { name: '添加模型服务' })).toHaveCount(0);
});
