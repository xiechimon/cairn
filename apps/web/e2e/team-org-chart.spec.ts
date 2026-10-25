import { expect, type Page, test } from '@playwright/test';

const NODE_H = 56;
const LINK_W = 44;
const BRACKET_W = 28;

async function openChart(page: Page, scenario: string) {
  await page.goto(`/app/team?scenario=${scenario}`);
  await page.getByRole('tab', { name: 'chart' }).click();
}

test('org chart: every member agent renders as one node', async ({ page }) => {
  await openChart(page, 'team-org-chart');
  await expect(page.getByTestId('team-chart-node')).toHaveCount(3);
  await expect(page.getByText('暂无成员')).toHaveCount(0);
});

test('org chart: the root node is the agent bound to the chief', async ({ page }) => {
  await openChart(page, 'team-org-chart');

  const root = page
    .getByTestId('team-chart-node')
    .filter({ has: page.getByTestId('team-chart-crown') });
  await expect(root).toHaveCount(1);
  await expect(root.getByTestId('team-chart-name')).toHaveText('r3-builder');

  await expect(
    page.getByTestId('team-chart-children').getByTestId('team-chart-node'),
  ).toHaveCount(2);
});

test('org chart: the crown badge appears only on the root node', async ({ page }) => {
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

test('org chart: every node carries a provider badge and a model row', async ({ page }) => {
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

test('org chart: nodes are Paper cards, `创建 Agent` only in the top bar', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
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
  expect(shape.radius).toBe('20px');
  expect(shape.bg).toBe('rgb(255, 253, 246)');
  expect(shape.shadow).toContain('0px 0px 0px 1px');
  expect(shape.height).toBe(NODE_H);
  expect(shape.width).toBe(220);
  await expect(page.getByRole('button', { name: '创建 Agent' })).toHaveCount(1);
  await expect(
    page.getByTestId('page-topbar').getByRole('button', { name: '创建 Agent' }),
  ).toBeVisible();
  await expect(page.getByTestId('team-chart-nodes').getByRole('button')).toHaveCount(0);
});

test('org chart: a 44×1 horizontal connector between the root and child columns', async ({ page }) => {
  await openChart(page, 'team-org-chart');
  const box = await page.getByTestId('team-chart-link').boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width).toBe(LINK_W);
  expect(box?.height).toBe(1);
});

test('org chart: bracket connector on the child column left edge spans the first and last child node centers', async ({ page }) => {
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

test('org chart: a zero-member team shows the `暂无成员` empty state and renders no nodes', async ({ page }) => {
  await openChart(page, 'team-org-chart-empty');
  await expect(page.getByTestId('team-agents-empty')).toContainText('暂无成员');
  await expect(page.getByTestId('team-chart-node')).toHaveCount(0);
  await expect(page.getByTestId('team-agents-empty').getByRole('button')).toHaveCount(0);
  await expect(page.getByTestId('team-chart-link')).toHaveCount(0);
});

test('org chart: switching back to grid still renders grid cards and member counts', async ({ page }) => {
  await page.goto('/app/team?scenario=team-org-chart');
  await page.getByRole('tab', { name: 'chart' }).click();
  await page.getByRole('tab', { name: 'grid' }).click();
  await expect(page.getByTestId('team-agent-card')).toHaveCount(3);
  await expect(page.getByText('3 个成员')).toContainText('3 个成员');
});

test('org chart: layout choice persists across reload', async ({ page }) => {
  await page.goto('/app/team?scenario=team-org-chart');
  await page.getByRole('tab', { name: 'chart' }).click();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'chart' })).toHaveAttribute('aria-selected', 'true');
});
