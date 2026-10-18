import { expect, type Page, test } from '@playwright/test';

// 删除 Agent（XMON-19 / B2）：概览页脚入口 + DeleteConfirm 家族二次确认。
//
// canon 出处（本票实测，非转述）：2026-10-01 登录原版走了一遍全流程（入口 →
// 确认层 → 取消 → 删除 → 落点），文案与落点均为实测；产线 bundle 的 i18n 语料
// （agent_modal.remove / remove_title / remove_confirm）是第二源，两源逐字一致。
// 落点实测 = `/app/team`，无提示条。
//
// 每例钉一个失败方式：
// 1. 入口缺失 —— 概览页脚没有删除钮（或长在别的 tab 上）。
// 2. 弹层形状不对 —— 点开不出确认层，或标题/正文不是 canon 原文（自造句）。
// 3. 家族律关闭失守 —— 取消 / X / Esc / backdrop 关不掉，或关闭时误删误跳。
// 4. 确认后落点错 / 名单没动 —— 不跳团队页，或跳走后被删的卡还在。
// 5. 误伤邻居 —— 同团队另一个 Agent 的卡随行消失。
//
// fixture 场景 = 'agent-delete'：r3-builder 详情记录 + 两行 roster
// （r3-builder 与 r3-qa）——「删掉一个还剩一个」才有牙。
const DETAIL = '/app/resources/agents/r3-builder?scenario=agent-delete';
const TEAM = '/app/team?scenario=agent-delete';
const CANON_TITLE = '删除 Agent？';
const CANON_BODY = '将「r3-builder」移出团队？该 Agent 进行中的任务将被停止。';

async function openConfirm(page: Page) {
  await page.goto(DETAIL);
  await page.locator('.agent-delete').click();
  const dialog = page.locator('.delete-confirm');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('概览页脚有删除入口，点开二次确认（canon 原文逐字）', async ({ page }) => {
  await page.goto(DETAIL);
  // 入口在概览 tab 的页脚（状态行之下，r3 §4 位置）
  await expect(page.locator('.agent-overview .agent-danger .agent-delete')).toHaveText(
    '删除 Agent',
  );
  const dialog = await openConfirm(page);
  await expect(dialog).toHaveAttribute('role', 'alertdialog');
  await expect(dialog.locator('.delete-confirm-title')).toHaveText(CANON_TITLE);
  await expect(dialog.locator('.delete-confirm-summary')).toHaveText(CANON_BODY);
  await expect(dialog.locator('.delete-confirm-cancel')).toHaveText('取消');
  // Paper 对话框次操作 = 文字按钮（DIALOG_TEXT_BUTTON）：text-ui 13.5px/20px。
  // 载体仍走类名别名（壳级输出的摘除权属 #952，本票不越权改冻结件）。
  await expect(dialog.locator('.delete-confirm-cancel')).toHaveCSS('font-size', '13.5px');
  await expect(dialog.locator('.delete-confirm-cancel')).toHaveCSS('line-height', '20px');
  await expect(dialog.locator('.delete-confirm-delete')).toHaveText('删除');
});

test('入口只在概览 tab：记忆 / 权限 tab 不渲染', async ({ page }) => {
  await page.goto(DETAIL);
  const detail = page.locator('.agent-detail');
  for (const tab of [1, 2]) {
    await detail.locator('.agent-tab').nth(tab).click();
    await expect(page.locator('.agent-delete')).toHaveCount(0);
  }
  await detail.locator('.agent-tab').nth(0).click();
  await expect(page.locator('.agent-delete')).toHaveCount(1);
});

test('家族律关闭：取消 / X / Esc / backdrop —— 不删不跳', async ({ page }) => {
  let dialog = await openConfirm(page);
  await dialog.locator('.delete-confirm-cancel').click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/agent-delete/);

  dialog = await openConfirm(page);
  await dialog.locator('.delete-confirm-close').click();
  await expect(dialog).toBeHidden();

  dialog = await openConfirm(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  dialog = await openConfirm(page);
  // raw mouse click 落背板：force click 按元素中心落点，居中弹层正好压住
  // 背板中心，事件会落到弹层上（project-settings-delete 同款）。
  await page.mouse.click(20, 20);
  await expect(dialog).toBeHidden();

  // 四路径走完仍未离开详情页
  await expect(page).toHaveURL(DETAIL);
  await expect(page.locator('.agent-detail')).toBeVisible();
});

test('确认删除 → 落团队页，被删卡消失、邻居卡还在', async ({ page }) => {
  const dialog = await openConfirm(page);
  await dialog.locator('.delete-confirm-delete').click();
  await expect(page).toHaveURL(/\/app\/team/);

  const cards = page.getByTestId('team-agent-card');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('r3-qa');
  await expect(cards.filter({ hasText: 'r3-builder' })).toHaveCount(0);
  // 创建槽仍在（删完还能建回来）
  await expect(page.getByRole('button', { name: '创建 Agent' })).toBeVisible();
});

test('会话内回退到详情路由落「找不到该 Agent」态，不白屏', async ({ page }) => {
  const dialog = await openConfirm(page);
  await dialog.locator('.delete-confirm-delete').click();
  await expect(page).toHaveURL(/\/app\/team/);

  // 回退（同文档 SPA 历史，同会话=覆面仍在）。刻意不用 goto —— fixture
  // 删除覆面是会话级内存集，整页重载会还原（fixtures/deletions.ts 契约）。
  await page.goBack();
  await expect(page).toHaveURL(/agent-delete/);
  await expect(page.locator('.agent-missing')).toHaveText('找不到该 Agent。它可能已被删除。');
});