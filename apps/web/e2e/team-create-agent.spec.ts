import { expect, type Page, test } from '@playwright/test';

// Issue #170: the team-page 创建 Agent action joins the dialog family. The
// dialog rides DialogShell (#68 family law: X / Esc / backdrop close), the
// form is name-first (r2 §8.1 capture 20: 标题/头像行/名称/服务商告警+
// 配置链接/创建), and fixture submission follows the accept-dialog
// precedent (#148: close-on-submit, no backend). Each test pins one
// failure mode:
// 1. the top-bar 创建 Agent button opens the dialog
// 2. family-law close: X / Esc / backdrop, panel clicks survive
// 3. empty name keeps 创建 disabled; typing lifts it (r2 07 muted indigo)
// 4. fixture submit closes the dialog
// 5. chart layout drops the grid; 创建 Agent stays in the top bar
// 6. 配置服务商 SPA-navigates to the providers route, scenario rides
//    along (#121 Link discipline)

const TEAM = '/app/team?scenario=12';

async function openDialog(page: Page) {
  await page.goto(TEAM);
  await page.getByRole('button', { name: '创建 Agent' }).click();
  const dialog = page.getByRole('dialog', { name: '创建 agent' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('the top-bar 创建 Agent opens the dialog', async ({ page }) => {
  const dialog = await openDialog(page);
  await expect(dialog).toHaveAccessibleName('创建 agent');
  await expect(dialog.getByLabel('名称')).toBeVisible();
  // #1259：scenario 12 无机器 → 机器告警行（归属机必填，创建不可能）；
  // 原「尚未配置模型服务商」面让位——服务商告警只在有机器无候选时出
  // （team-no-sources 场景钉，见配置服务商导航测试）。
  await expect(dialog.getByText('还没有接入机器')).toBeVisible();
  await expect(dialog.getByRole('link', { name: '接入机器' })).toBeVisible();
});

test('family law: X, Escape and backdrop dismiss; panel clicks do not', async ({ page }) => {
  let dialog = await openDialog(page);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeHidden();

  dialog = await openDialog(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeHidden();

  dialog = await openDialog(page);
  await dialog.getByTestId('dialog-head').click();
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeHidden();
});

test('empty name keeps 创建 disabled; #1259 归属机未选同样禁用；选齐提交关闭', async ({
  page,
}) => {
  // 名字闸 + 归属机闸的场景得有机器——scenario 06（resources canon 两机）。
  await page.goto('/app/team?scenario=06');
  await page.getByRole('button', { name: '创建 Agent' }).click();
  const dialog = page.getByRole('dialog', { name: '创建 agent' });
  await expect(dialog).toBeVisible();
  const create = dialog.getByRole('button', { name: '创建', exact: true });
  await expect(create).toBeDisabled();
  await dialog.getByLabel('名称').fill('r7 probe agent');
  // 只有名字不够：归属机未选仍禁用。
  await expect(create).toBeDisabled();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: 'xmonsMac-3574.local' }).click();
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeHidden();
});

test('chart layout drops the grid; 创建 Agent stays in the top bar', async ({ page }) => {
  await page.goto(TEAM);
  await page.getByRole('tab', { name: 'chart' }).click();
  // scenario 12 的团队有 1 个成员 —— chart 出组织图（#490）。grid 整格退场，
  // 创建入口只有顶栏这一个（组织图里不再画虚线创建节点）。
  await expect(page.getByTestId('team-chart-node')).toHaveCount(1);
  await expect(page.getByText('暂无成员')).toHaveCount(0);
  await expect(page.getByTestId('team-agent-grid')).toHaveCount(0);
  const create = page.getByRole('button', { name: '创建 Agent' });
  await expect(create).toHaveCount(1);
  await expect(page.getByTestId('page-topbar').getByRole('button', { name: '创建 Agent' })).toBeVisible();
  await create.click();
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeVisible();
});

test('配置服务商 SPA-navigates to the providers route, scenario rides along', async ({ page }) => {
  // #1259：服务商告警行退成信息性（有机器无候选才出）——team-no-sources。
  await page.goto('/app/team?scenario=team-no-sources');
  await page.getByRole('button', { name: '创建 Agent' }).click();
  const dialog = page.getByRole('dialog', { name: '创建 agent' });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__spaMarker = 'alive';
  });
  await dialog.getByRole('link', { name: '配置服务商' }).click();
  await expect(page).toHaveURL('/app/resources/providers?scenario=team-no-sources');
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__spaMarker)).toBe(
    'alive',
  );
});

test('无机器时「接入机器」SPA-navigates to the machines route', async ({ page }) => {
  const dialog = await openDialog(page);
  await dialog.getByRole('link', { name: '接入机器' }).click();
  await expect(page).toHaveURL('/app/resources/machines?scenario=12');
});
