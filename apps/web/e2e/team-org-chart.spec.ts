import { expect, type Page, test } from '@playwright/test';

// team chart 组织图（本轮修复：chart 布局此前恒渲染 `暂无成员` 字面量，
// 与同一份数据下的 grid 自相矛盾 —— grid 顶栏 `3 个成员` 并画出卡片，
// chart 却说没有成员）。
//
// 结构与连接件几何沿用 todos.dev/app/team chart 布局的 DOM 实测（2026-09-30）：
// 节点 220×56、根→子列 44×1 连接线、子列左缘 28 宽括号跨首→末子节点中心。
// Paper 卡改造（docs/verify/paper-team-pages）：节点换成 Paper 卡（白底、
// --radius-card 10px、1px 环 + 轻投影）；创建 Agent 只在页面顶栏，组织图里
// 不再画虚线创建节点。载体：data-testid 二级（节点/名字/模型行/皇冠/服务商
// 徽标/连接线/括号/子列/节点栈），根节点身份由皇冠徽标承载。

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

test('chart 组织图：节点是 Paper 卡，创建 Agent 只在顶栏', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pacman-theme', 'light'));
  await openChart(page, 'team-org-chart');
  const shape = await page
    .getByTestId('team-chart-node')
    .first()
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        radius: cs.borderTopLeftRadius,
        bg: cs.backgroundColor,
        shadow: cs.boxShadow,
        height: el.getBoundingClientRect().height,
        width: el.getBoundingClientRect().width,
      };
    });
  expect(shape.radius).toBe('10px');
  expect(shape.bg).toBe('rgb(255, 255, 255)');
  expect(shape.shadow).toContain('0px 0px 0px 1px');
  expect(shape.height).toBe(NODE_H);
  expect(shape.width).toBe(220);
  await expect(page.getByRole('button', { name: '创建 Agent' })).toHaveCount(1);
  await expect(
    page.getByTestId('page-topbar').getByRole('button', { name: '创建 Agent' }),
  ).toBeVisible();
  await expect(page.getByTestId('team-chart-nodes').getByRole('button')).toHaveCount(0);
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
  const last = await page
    .getByTestId('team-chart-children')
    .getByTestId('team-chart-node')
    .last()
    .boundingBox();
  expect(bracket).not.toBeNull();
  expect(bracket?.width).toBe(BRACKET_W);
  expect(Math.round(bracket!.y)).toBe(Math.round(first!.y + first!.height / 2));
  expect(Math.round(bracket!.y + bracket!.height)).toBe(
    Math.round(last!.y + last!.height / 2),
  );
});

test('chart 组织图：零成员团队显示 暂无成员 空态且不渲染节点', async ({ page }) => {
  await openChart(page, 'team-org-chart-empty');
  await expect(page.getByTestId('team-agents-empty')).toContainText('暂无成员');
  await expect(page.getByTestId('team-chart-node')).toHaveCount(0);
  await expect(page.getByTestId('team-agents-empty').getByRole('button')).toHaveCount(0);
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
