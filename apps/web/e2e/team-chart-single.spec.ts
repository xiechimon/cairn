import { expect, type Page, test } from '@playwright/test';

const LINK_W = 44;

async function openChart(page: Page, scenario: string) {
  await page.goto(`/app/team?scenario=${scenario}`);
  await page.getByRole('tab', { name: 'chart' }).click();
}

test('chart 组织图：只有根节点时不画连接线与括号', async ({ page }) => {
  await openChart(page, 'team-org-chart-single');
  await expect(page.getByTestId('team-chart-node')).toHaveCount(1);
  await expect(page.getByTestId('team-chart-name')).toHaveText('solo-root');
  await expect(page.getByTestId('team-chart-link')).toHaveCount(0);
  await expect(page.getByTestId('team-chart-bracket')).toHaveCount(0);
});

test('chart 组织图：单个子节点直连，无括号，连接线对齐子卡中心', async ({ page }) => {
  await openChart(page, 'team-org-chart-pair');
  const child = page.getByTestId('team-chart-children').getByTestId('team-chart-node');
  await expect(child).toHaveCount(1);
  await expect(page.getByTestId('team-chart-bracket')).toHaveCount(0);
  const link = await page.getByTestId('team-chart-link').boundingBox();
  const box = await child.boundingBox();
  expect(link).not.toBeNull();
  expect(box).not.toBeNull();
  expect(link?.width).toBe(LINK_W);
  expect(link?.height).toBe(1);
  expect(Math.round(link!.x + link!.width)).toBe(Math.round(box!.x));
  expect(Math.abs(link!.y + link!.height / 2 - (box!.y + box!.height / 2))).toBeLessThanOrEqual(1);
});

test('chart 组织图：零成员不渲染连接线与括号', async ({ page }) => {
  await openChart(page, 'team-org-chart-empty');
  await expect(page.getByTestId('team-agents-empty')).toContainText('暂无成员');
  await expect(page.getByTestId('team-chart-node')).toHaveCount(0);
  await expect(page.getByTestId('team-chart-link')).toHaveCount(0);
  await expect(page.getByTestId('team-chart-bracket')).toHaveCount(0);
});
