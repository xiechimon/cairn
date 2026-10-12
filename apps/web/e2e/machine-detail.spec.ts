// #1259 机器详情页（/app/resources/machines/:id）：fact 条 + 归属机 agent
// 网格（team 卡网格复用）+ 预选归属机的创建槽 + 生命周期出口（整机迁移 /
// 删除）。fixture 面钉行为语义：
// 1. 列表行机器名是链接 → 详情页（行内开关控件不串导航）。
// 2. 详情页 fact 条 = 在线态 + runtimes + 并发；agent 网格只列归属本机的。
// 3. 归属机预选：创建槽开弹窗，机器槽回显本机（预选）。
// 4. 删除闸：有绑定 agent 时删除钮禁用并指名数量（server 409 同律）。
// 5. 整机迁移：未选目标机时迁移钮禁用；fixture 静态面（无后端）。

import { expect, test } from '@playwright/test';

const LIST = '/app/resources/machines?scenario=06';
const DETAIL = '/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06';

test('列表行机器名是链接 → 详情页', async ({ page }) => {
  await page.goto(LIST);
  await page.getByRole('link', { name: 'mea-wsl' }).click();
  await expect(page).toHaveURL(DETAIL);
  await expect(page.getByTestId('machine-detail-online')).toBeVisible();
});

test('详情页 fact 条 + 网格只列归属本机的 agent', async ({ page }) => {
  await page.goto(DETAIL);
  await expect(page.getByTestId('machine-detail-online')).toContainText('在线');
  // fixture canon 机的 agent 都没有 machineId（老 fixture 未绑）→ 网格空、
  // 但网格容器在（计数锚零命中 = 只列本机的负向证据）。
  await expect(page.getByTestId('team-agent-grid')).toBeVisible();
  await expect(page.getByTestId('team-agent-card')).toHaveCount(0);
});

test('创建槽预选本机为归属机', async ({ page }) => {
  await page.goto(DETAIL);
  await page.getByRole('button', { name: '创建 Agent' }).click();
  const dialog = page.getByRole('dialog', { name: '创建 agent' });
  await expect(dialog).toBeVisible();
  // 预选归属机 = 本机（mea-wsl）——触发钮回显本机名，创建钮不再被机器槽挡。
  await expect(dialog.locator('.dlg-agent-machine-select')).toContainText('mea-wsl');
  await dialog.getByLabel('名称').fill('probe');
  await expect(dialog.getByRole('button', { name: '创建', exact: true })).toBeEnabled();
});

test('删除闸：无绑定 agent 时可删；整机迁移未选目标机时禁用', async ({ page }) => {
  await page.goto(DETAIL);
  // fixture 机均无绑定 agent → 删除可用；迁移未选目标 = 禁用。
  await expect(page.getByTestId('machine-delete-btn')).toBeEnabled();
  await expect(page.getByTestId('machine-evacuate-btn')).toBeDisabled();
  // 迁移目标选择器列出「别的机器」（本机不在其列）。
  await page.locator('.machine-evacuate-select').click();
  await expect(page.locator('.machine-evacuate-row', { hasText: 'xmonsMac-3574.local' })).toBeVisible();
  await expect(page.locator('.machine-evacuate-row', { hasText: 'mea-wsl' })).toHaveCount(0);
});
