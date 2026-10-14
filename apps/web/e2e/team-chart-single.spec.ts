import { expect, type Page, test } from '@playwright/test';

// #1246：组织图括号列按 ≥2 子设计。子数 = 非根成员卡 + 末位创建槽。
// 成员 0 时子数是 1（只有创建槽），括号盒 top-7+bottom-7 把列高吃光，
// 边框塌成一条悬浮短横，w-7 坐标架把连接线与子卡隔开 28px。
// 单子跳过括号，44px 连接线直接接到子卡中心；2 子保留括号；0 成员仍是空态。

const LINK_W = 44;
const BRACKET_W = 28;

async function openChart(page: Page, scenario: string) {
  await page.goto(`/app/team?scenario=${scenario}`);
  await page.getByRole('tab', { name: 'chart' }).click();
}

test('chart 组织图：单子直连创建槽，无括号、无断口、连接线对齐子卡中心', async ({ page }) => {
  await openChart(page, 'team-org-chart-single');
  await expect(page.getByTestId('team-chart-node')).toHaveCount(1);
  await expect(page.getByTestId('team-chart-name')).toHaveText('solo-root');
  await expect(page.getByTestId('team-chart-bracket')).toHaveCount(0);

  const link = await page.getByTestId('team-chart-link').boundingBox();
  const child = await page.getByRole('button', { name: '创建 Agent' }).boundingBox();
  expect(link).not.toBeNull();
  expect(child).not.toBeNull();
  expect(link?.width).toBe(LINK_W);
  expect(link?.height).toBe(1);
  expect(Math.round(link!.x + link!.width)).toBe(Math.round(child!.x));
  expect(
    Math.abs(link!.y + link!.height / 2 - (child!.y + child!.height / 2)),
  ).toBeLessThanOrEqual(1);
});

test('chart 组织图：双子仍用括号跨首末子节点中心', async ({ page }) => {
  await openChart(page, 'team-org-chart-pair');
  await expect(
    page.getByTestId('team-chart-children').getByTestId('team-chart-node'),
  ).toHaveCount(1);
  const link = await page.getByTestId('team-chart-link').boundingBox();
  expect(link?.width).toBe(LINK_W);
  expect(link?.height).toBe(1);

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

test('chart 组织图：零成员不渲染连接线与括号', async ({ page }) => {
  await openChart(page, 'team-org-chart-empty');
  await expect(page.getByText('暂无成员')).toHaveText('暂无成员');
  await expect(page.getByTestId('team-chart-node')).toHaveCount(0);
  await expect(page.getByTestId('team-chart-link')).toHaveCount(0);
  await expect(page.getByTestId('team-chart-bracket')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '创建 Agent' })).toHaveCount(0);
});
