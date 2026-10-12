import { expect, type Page, test } from '@playwright/test';

// team chart 组织图（本轮修复：chart 布局此前恒渲染 `暂无成员` 字面量，
// 与同一份数据下的 grid 自相矛盾 —— grid 顶栏 `3 个成员` 并画出卡片，
// chart 却说没有成员）。
//
// 本文件是冻结的验收面：每条断言对应一条对 todos.dev/app/team chart 布局的
// DOM 实测（2026-09-30），几何数值照抄实测值，不是推测；场景清单在循环
// iteration 0 定稿后不再改动（改断言 = 改尺子 = 作弊，由 Guard 校验文件哈希）。
//
// #947/#910 载体重钉：类名 locator（.team-chart-*）退役——chart 内部全是
// 无 role 的结构 div，换 data-testid 二级载体（节点/名字/模型行/皇冠/服务商
// 徽标/连接线/括号/子列/节点栈）；根节点身份由皇冠徽标承载（crown 只渲染在
// 总管绑定 agent 上 = 原 --root 修饰类的语义载体，#910 裁定 3 状态类归
// 行为）；创建位 = getByRole('button', {name:'创建 Agent'})。**几何数值零
// 改动**——220×56 / 44×1 / 28 / 圆角 8 / dashed 全部等值迁移（token
// utility 承载），尺子没动，只换了握尺子的地方。
//
// 参考实测（chat 布局，团队 2 agent + 1 绑定总管）：
//   node 卡 220×56 / radius 8 / 1px --border-default / bg --surface
//   头像 32 圆；名字 12px/500；模型行 10px mono --text-dim
//   根节点带皇冠徽标（/api/teams/{id}/chief 的 agent.agentId 指向它）
//   每节点第二行 = 服务商徽标胶囊(18×18, p3, bg --surface-secondary) + 模型行
//   根→子列之间横向 1px 连接线 44 宽（--border-strong）
//   子列左缘 28 宽括号连接件（上/左/下三边，左圆角 7），跨首→末子节点中心
//   `创建 Agent` 在 chart 里是虚线节点卡，位于子列末位

const NODE_H = 56;
const LINK_W = 44;
const BRACKET_W = 28;

/** 进 chart 布局并等 tablist 落地。 */
async function openChart(page: Page, scenario: string) {
  await page.goto(`/app/team?scenario=${scenario}`);
  await page.getByRole('tab', { name: 'chart' }).click();
}

test('chart 组织图：每个成员 agent 渲染成一个节点', async ({ page }) => {
  await openChart(page, 'team-org-chart');
  await expect(page.getByTestId('team-chart-node')).toHaveCount(3);
  await expect(page.getByText('暂无成员')).toHaveCount(0);
});

test('chart 组织图：根节点是总管绑定的 agent', async ({ page }) => {
  await openChart(page, 'team-org-chart');
  // 根 = 戴皇冠的节点（crown 只渲染在总管绑定 agent 上）
  const root = page
    .getByTestId('team-chart-node')
    .filter({ has: page.getByTestId('team-chart-crown') });
  await expect(root).toHaveCount(1);
  await expect(root.getByTestId('team-chart-name')).toHaveText('r3-builder');
  // 其余两个成员落子列
  await expect(
    page.getByTestId('team-chart-children').getByTestId('team-chart-node'),
  ).toHaveCount(2);
});

test('chart 组织图：皇冠徽标只出现在根节点上', async ({ page }) => {
  await openChart(page, 'team-org-chart');
  await expect(page.getByTestId('team-chart-crown')).toHaveCount(1);
  const root = page
    .getByTestId('team-chart-node')
    .filter({ has: page.getByTestId('team-chart-crown') });
  await expect(root.getByTestId('team-chart-crown')).toHaveCount(1);
  await expect(
    page
      .getByTestId('team-chart-node')
      .filter({ hasNot: page.getByTestId('team-chart-crown') })
      .getByTestId('team-chart-crown'),
  ).toHaveCount(0);
});

test('chart 组织图：每个节点带服务商徽标与模型行', async ({ page }) => {
  await openChart(page, 'team-org-chart');
  await expect(page.getByTestId('team-chart-provider')).toHaveCount(3);
  const models = await page.getByTestId('team-chart-model').allTextContents();
  expect(models.map((m) => m.trim())).toEqual([
    'claude-sonnet-5 · 默认',
    'qwen3.8-max',
    'glm-5.3-flash',
  ]);
  const names = await page.getByTestId('team-chart-name').allTextContents();
  expect(names.map((n) => n.trim())).toEqual(['r3-builder', 'r5-scribe', 'r9-scout']);
});

test('chart 组织图：创建 Agent 是子列末位的虚线节点卡', async ({ page }) => {
  await openChart(page, 'team-org-chart');
  const create = page.getByRole('button', { name: '创建 Agent' });
  await expect(create).toHaveCount(1);
  await expect(create).toContainText('创建 Agent');
  const shape = await create.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      border: cs.borderTopStyle,
      radius: cs.borderTopLeftRadius,
      height: el.getBoundingClientRect().height,
    };
  });
  expect(shape.border).toBe('dashed');
  expect(shape.radius).toBe('8px');
  expect(shape.height).toBe(NODE_H);
  // 子列末位 = 节点栈的最后一个（`.team-chart-children > *` 枚举的是括号列
  // 与节点栈两列本身，恒取不到卡片）
  await expect(page.getByTestId('team-chart-nodes').locator('> *').last()).toContainText(
    '创建 Agent',
  );
});

test('chart 组织图：根与子列之间有 44×1 横向连接线', async ({ page }) => {
  await openChart(page, 'team-org-chart');
  const box = await page.getByTestId('team-chart-link').boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width).toBe(LINK_W);
  expect(box?.height).toBe(1);
});

test('chart 组织图：子列左缘括号连接件跨首末子节点中心', async ({ page }) => {
  await openChart(page, 'team-org-chart');
  const bracket = await page.getByTestId('team-chart-bracket').boundingBox();
  const first = await page
    .getByTestId('team-chart-children')
    .getByTestId('team-chart-node')
    .first()
    .boundingBox();
  const last = await page.getByRole('button', { name: '创建 Agent' }).boundingBox();
  expect(bracket).not.toBeNull();
  expect(bracket?.width).toBe(BRACKET_W);
  expect(Math.round(bracket!.y)).toBe(Math.round(first!.y + first!.height / 2));
  expect(Math.round(bracket!.y + bracket!.height)).toBe(
    Math.round(last!.y + last!.height / 2),
  );
});

test('chart 组织图：零成员团队显示 暂无成员 且不渲染节点', async ({ page }) => {
  await openChart(page, 'team-org-chart-empty');
  await expect(page.getByText('暂无成员')).toHaveText('暂无成员');
  await expect(page.getByTestId('team-chart-node')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '创建 Agent' })).toHaveCount(0);
  await expect(page.getByTestId('team-chart-link')).toHaveCount(0);
});

test('chart 组织图：切回 grid 仍渲染网格卡与成员数', async ({ page }) => {
  await page.goto('/app/team?scenario=team-org-chart');
  await page.getByRole('tab', { name: 'chart' }).click();
  await page.getByRole('tab', { name: 'grid' }).click();
  await expect(page.getByTestId('team-agent-card')).toHaveCount(3);
  await expect(page.getByText('3 个成员')).toContainText('3 个成员');
});

test('chart 组织图：布局选择刷新后持久', async ({ page }) => {
  await page.goto('/app/team?scenario=team-org-chart');
  await page.getByRole('tab', { name: 'chart' }).click();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'chart' })).toHaveAttribute('aria-selected', 'true');
});

// #1246 单链态（team-org-chart-single：成员即根，子列只剩创建槽）。括号列
// 按 ≥2 子设计，单链下塌成 0 高叠边短横 + 28px 断口——修复为跳过括号列
// 直连。以下断言为新增尺子，只钉单链面；既有 ≥2 / 0 态断言不动。
test('chart 组织图单链：不渲染括号列，link 直连创建槽', async ({ page }) => {
  await openChart(page, 'team-org-chart-single');
  // 单链态成员卡只有根节点
  await expect(page.getByTestId('team-chart-node')).toHaveCount(1);
  await expect(page.getByText('暂无成员')).toHaveCount(0);
  // 无括号元素（塌片消失）
  await expect(page.getByTestId('team-chart-bracket')).toHaveCount(0);
  // link 仍 44×1
  const link = await page.getByTestId('team-chart-link').boundingBox();
  expect(link).not.toBeNull();
  expect(link?.width).toBe(LINK_W);
  expect(link?.height).toBe(1);
  // 无断口：link 右缘 x == 创建槽左缘 x（精确相等）
  const create = await page.getByRole('button', { name: '创建 Agent' }).boundingBox();
  expect(create).not.toBeNull();
  expect(link!.x + link!.width).toBe(create!.x);
  // 同轴：link 中心 y 与创建槽中心 y 差 ≤1px
  const linkCenterY = link!.y + link!.height / 2;
  const createCenterY = create!.y + create!.height / 2;
  expect(Math.abs(linkCenterY - createCenterY)).toBeLessThanOrEqual(1);
});
