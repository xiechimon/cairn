import { expect, type Page, test } from '@playwright/test';

const SCENARIO = '/app?scenario=run-trace';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'zh'));
});

const markButton = (page: Page) => page.getByRole('button', { name: 'Coordinator 运行记录' });

test('the mark opens the trace tab beside the conversation, with the ledger and the inspector', async ({
  page,
}) => {
  await page.goto(SCENARIO);
  await expect(page.getByTestId('trace-tab')).toBeVisible();
  await markButton(page).click();
  await expect(page).toHaveURL(/trace=1/);
  const view = page.getByTestId('run-trace-view');
  await expect(view).toBeVisible();
  await expect(page.getByTestId('run-trace-inspector')).toBeVisible();
  await expect(view.getByText('再把 CONTRIBUTING.md 的验收部分补全')).toBeVisible();
  await expect(view.getByText('自动唤醒').first()).toBeVisible();
  await expect(view.getByText(/provenance=/)).toHaveCount(0);
  await view.locator('[data-run-row="turn-s"] button').first().click();
  await expect(page.getByTestId('run-trace-inspector')).toHaveCount(0);
  await view.locator('[data-run-row="turn-s"] button').first().click();
  await expect(page.getByTestId('run-trace-inspector')).toBeVisible();
  await page.getByTestId('trace-tab-chat').click();
  await expect(view).toHaveCount(0);
  await expect(page.getByTestId('home-c')).toBeVisible();
  await page.getByTestId('trace-tab').click();
  await expect(page.getByTestId('run-trace-view')).toBeVisible();
});

test('a failed turn opens the trace tab on its run and its first failed step', async ({ page }) => {
  await page.goto(SCENARIO);
  await page.getByTestId('chief-turn-error').getByRole('link', { name: '看轨迹' }).click();
  await expect(page).toHaveURL(/trace=1/);
  await expect(page).toHaveURL(/run=turn-b/);
  const inspector = page.getByTestId('run-trace-inspector');
  await expect(inspector).toContainText('ENOSPC: no space left on device, write');
  await expect(inspector).toContainText('错误');
});

test('the wake row reads as a wake, a model step reports its own usage, and one notification is one row', async ({
  page,
}) => {
  await page.goto(`${SCENARIO}&trace=1&run=turn-w`);
  const view = page.getByTestId('run-trace-view');
  const row = view.locator('[data-run-row="turn-w"]');
  await expect(row.getByText('自动唤醒 · 任务失败')).toBeVisible();
  await expect(row.getByText(/^notify_user/)).toHaveCount(1);
  await expect(view.getByText(/使用 mcp__/)).toHaveCount(0);
  await page.locator('[data-run-item="model-turn-w-1"]').click();
  const inspector = page.getByTestId('run-trace-inspector');
  await expect(inspector).toContainText('claude-sonnet-5');
  await expect(inspector).toContainText('输入 4900 · 输出 310');
  await page.locator('[data-run-item="call_notify"]').click();
  await expect(inspector).toContainText('任务 #11 完成');
});

test('the wake filter and the problems filter keep only their runs', async ({ page }) => {
  await page.goto(`${SCENARIO}&trace=1`);
  const view = page.getByTestId('run-trace-view');
  await page.getByTestId('trace-filter-problems').click();
  await expect(view.locator('[data-run-row="turn-b"]')).toBeVisible();
  await expect(view.locator('[data-run-row="turn-a"]')).toHaveCount(0);
  await page.getByTestId('trace-filter-wake').click();
  await expect(view.locator('[data-run-row="turn-w"]')).toBeVisible();
  await expect(view.locator('[data-run-row="turn-b"]')).toHaveCount(0);
});

test('a task opens the same trace view, scoped to its own runs', async ({ page }) => {
  await page.goto(`${SCENARIO}&thread=r3-contributing&taskTrace=1`);
  const panel = page.getByTestId('side-chat-panel');
  const view = panel.getByTestId('run-trace-view');
  await expect(view).toBeVisible();
  await expect(page.getByTestId('home-c').getByTestId('run-trace-view')).toHaveCount(0);
  await expect(view.locator('[data-run-row="build-r"]')).toBeVisible();
  await expect(view.getByText('再把 CONTRIBUTING.md 的验收部分补全')).toHaveCount(0);
  await panel.getByTestId('trace-tab-chat').click();
  await expect(panel.getByTestId('run-trace-view')).toHaveCount(0);
});

test('an empty conversation shows the same tab and one empty sentence', async ({ page }) => {
  await page.goto('/app?scenario=run-trace-empty&trace=1');
  const view = page.getByTestId('run-trace-view');
  await expect(view).toBeVisible();
  await expect(page.getByTestId('run-trace-empty')).toHaveText('暂无轨迹');
  await expect(page.getByTestId('run-trace-inspector')).toHaveCount(0);
});

test('an old run bookmark lands on the same trace tab', async ({ page }) => {
  await page.goto('/app/runs/turn-b?scenario=run-trace');
  await expect(page).toHaveURL(/\/app\?/);
  await expect(page).toHaveURL(/trace=1/);
  await expect(page).toHaveURL(/run=turn-b/);
  const view = page.getByTestId('run-trace-view');
  await expect(view.locator('[data-run-row="turn-b"]')).toBeVisible();
  await expect(page.getByTestId('run-trace-inspector')).toBeVisible();
});

test('390px keeps one pane and the back control reaches the inspector', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(SCENARIO);
  await markButton(page).click();
  const view = page.getByTestId('run-trace-view');
  await expect(view).toBeVisible();
  await expect(page.getByTestId('run-trace-inspector')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await view.locator('[data-run-row="turn-w"] button').first().click();
  await view.locator('[data-run-item="model-turn-w-1"]').click();
  const inspector = page.getByTestId('run-trace-inspector');
  await expect(inspector).toBeVisible();
  await inspector.getByRole('button', { name: '返回轨迹' }).click();
  await expect(page.getByTestId('run-trace-inspector')).toHaveCount(0);
});
