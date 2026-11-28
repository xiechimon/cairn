import { expect, type Page, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock';

const SCENARIO = '/app?scenario=run-trace';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'zh'));
});

const markButton = (page: Page) => page.getByRole('button', { name: 'Coordinator 运行记录' });

test('a failed turn links to its run log, which leads with the failure and folds quiet tool calls', async ({
  page,
}) => {
  await page.goto(SCENARIO);
  const error = page.getByTestId('chief-turn-error');
  await expect(page.getByRole('link', { name: '运行记录' })).toHaveCount(2);
  await expect(page.getByTestId('chief-stopped').getByRole('link', { name: '运行记录' })).toHaveCount(1);
  await error.getByRole('link', { name: '运行记录' }).click();
  await expect(page).toHaveURL(/\/app\/runs\/turn-b\?scenario=run-trace$/);
  const run = page.getByTestId('run-page');
  await expect(page.getByTestId('run-failure')).toContainText('Runner error: ENOSPC');
  await expect(run.getByText('4 次工具调用')).toBeVisible();
  await expect(run.getByText('ENOSPC: no space left on device')).toBeHidden();
  await run.getByText('4 次工具调用').click();
  await expect(run.getByText('acceptance.md', { exact: false }).first()).toBeVisible();
  await page.getByTestId('run-failure').getByRole('button', { name: '看出错的那一步' }).click();
  await expect(run.getByText('ENOSPC: no space left on device, write')).toBeVisible();
  await page.getByTestId('run-problems-only').click();
  await expect(run.getByText('4 次工具调用')).toHaveCount(0);
  await expect(page.getByTestId('run-item-error')).toBeVisible();
  await page.getByTestId('run-problems-only').click();
  await expect(run.getByText('4 次工具调用')).toBeVisible();
  await expect(run.getByText('Runner error: ENOSPC').first()).toBeVisible();
  await expect(page.getByTestId('run-list').locator('a[aria-current="page"]')).toHaveAttribute(
    'data-run-row',
    'turn-b',
  );
  await expect(page.getByTestId('run-scope-thread')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('run-list').locator('a[data-run-row="turn-s"]').click();
  await expect(page).toHaveURL(/\/app\/runs\/turn-s/);
  await expect(page.getByTestId('run-item-stopped')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/app\?scenario=run-trace$/);
  await expect(page.getByTestId('run-page')).toHaveCount(0);
  await expect(markButton(page)).not.toBeFocused();
});

test('the stopped turn row links to its run log', async ({ page }) => {
  await page.goto(SCENARIO);
  await page.getByTestId('chief-stopped').getByRole('link', { name: '运行记录' }).click();
  await expect(page).toHaveURL(/\/app\/runs\/turn-s/);
  await page.getByTestId('run-page').getByRole('button', { name: /read/ }).click();
  await expect(page.getByTestId('run-page').getByText('暂无输出')).toBeVisible();
});

test('the hint shows once, opens the run window, and stays gone after a reload', async ({
  page,
}) => {
  await page.goto(SCENARIO);
  const hint = page.getByTestId('run-trace-hint');
  await expect(hint).toContainText('点这里看每一轮做了什么');
  const composer = await page.getByTestId('chief-composer-block').boundingBox();
  const hintBox = await hint.boundingBox();
  expect(composer).not.toBeNull();
  expect(hintBox).not.toBeNull();
  expect(hintBox!.y + hintBox!.height).toBeLessThan(composer!.y);
  await hint.getByRole('button', { name: '点这里看每一轮做了什么' }).click();
  await expect(page.getByTestId('run-list')).toBeVisible();
  await expect(hint).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('run-list')).toHaveCount(0);
  await expect(markButton(page)).toBeFocused();
  await page.reload();
  await expect(page.getByTestId('chief-turn-error')).toBeVisible();
  await expect(hint).toHaveCount(0);
});

test('keyboard opening the hint and spiral restores focus on close', async ({ page }) => {
  await page.goto(SCENARIO);
  const hintButton = page.getByTestId('run-trace-hint').getByRole('button', {
    name: '点这里看每一轮做了什么',
  });
  await hintButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('run-list')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(markButton(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('run-list')).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(markButton(page)).toBeFocused();
});

test('closing the hint with × also retires it', async ({ page }) => {
  await page.goto(SCENARIO);
  await page.getByTestId('run-trace-hint-close').click();
  await expect(page.getByTestId('run-trace-hint')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('chief-turn-error')).toBeVisible();
  await expect(page.getByTestId('run-trace-hint')).toHaveCount(0);
});

test('the spiral opens the run window on the newest turn; 全部 adds other conversations and task runs', async ({
  page,
}) => {
  await page.goto(SCENARIO);
  await markButton(page).click();
  await expect(page).toHaveURL(/\/app\/runs\/?\?thread=thread-run-trace&scenario=run-trace$/);
  const list = page.getByTestId('run-list');
  const rows = list.locator('a[data-run-row]');
  await expect(rows.first()).toHaveAttribute('data-run-row', 'turn-s');
  await expect(rows.first()).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('run-item-stopped')).toBeVisible();
  await expect(page.getByTestId('route-dialog-head').getByRole('button')).toHaveCount(1);
  await expect(page.getByTestId('run-export')).toBeVisible();
  await expect(page.getByTestId('run-list-problems')).toHaveAttribute('aria-pressed', 'false');
  await expect(rows).toHaveCount(20);
  await expect(list.locator('a[data-run-row="turn-channel"]')).toHaveCount(0);
  await expect(list.locator('a[data-run-row="build-r"]')).toHaveCount(0);
  await expect(list.getByRole('list', { name: '今天' })).toBeVisible();
  await list.locator('[aria-hidden="true"]').last().scrollIntoViewIfNeeded();
  await expect(rows).toHaveCount(25);
  await page.getByTestId('run-scope-all').click();
  await expect(page).toHaveURL(/scope=all/);
  const task = list.locator('a[data-run-row="build-r"]');
  await expect(task).toContainText('修复设置页 390 宽度下的横向滚动');
  await expect(task).toContainText('r3-lifecycle · 1 次工具调用 · 11 分钟');
  await expect(list.locator('a[data-run-row="turn-channel"]')).toContainText(
    '这个项目的发布说明写到哪了',
  );
  await task.click();
  await expect(page).toHaveURL(/\/app\/runs\/build-r\?thread=thread-run-trace&scope=all/);
  await expect(task).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('run-page')).toContainText('去掉了设置列表的固定最小宽度');
  await page.getByTestId('run-list-problems').click();
  await expect(rows.first()).toHaveAttribute('data-run-row', 'turn-s');
  await expect(list.locator('a[data-run-row="build-r"]')).toHaveCount(0);
  await expect(list.locator('a[data-run-row="turn-b"] svg[role="img"]')).toHaveAttribute(
    'aria-label',
    '未完成',
  );
  await page.getByTestId('run-list-problems').click();
  await expect(task).toBeVisible();
  await page.getByTestId('run-scope-thread').click();
  await expect(list.locator('a[data-run-row="build-r"]')).toHaveCount(0);
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/runs\/turn-b/);
  await expect(page.getByTestId('run-failure')).toContainText('Runner error: ENOSPC');
});

test('with no runs the window is one sentence', async ({ page }) => {
  await page.goto('/app?scenario=run-trace-empty');
  await markButton(page).click();
  await expect(page.getByTestId('run-list-nothing')).toHaveText('暂无运行记录');
  await expect(page.getByTestId('run-list')).toHaveCount(0);
});

test('an empty conversation still offers 全部, and an empty problems filter can be turned off', async ({
  page,
}) => {
  await page.goto('/app/runs?thread=thread-quiet&scenario=run-trace');
  await expect(page.getByTestId('run-list-empty')).toHaveText('暂无运行记录');
  await page.getByTestId('run-scope-all').click();
  await expect(page.locator('a[data-run-row="build-r"]')).toBeVisible();
  await page.goto('/app/runs?thread=thread-channel&problems=1&scenario=run-trace');
  await expect(page.getByTestId('run-list-empty')).toHaveText('暂无出问题的记录');
  await page.getByTestId('run-list-problems').click();
  await expect(page.locator('a[data-run-row="turn-channel"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('a task run opened by itself lists every run with no scope switch', async ({ page }) => {
  await page.goto('/app/runs/build-r?scenario=run-trace');
  const list = page.getByTestId('run-list');
  await expect(list.locator('a[data-run-row="build-r"]')).toHaveAttribute('aria-current', 'page');
  await expect(list.locator('a[data-run-row="turn-channel"]')).toBeVisible();
  await expect(page.getByTestId('run-scope-all')).toHaveCount(0);
  await page.getByTestId('run-list-problems').click();
  await page.getByTestId('run-list-problems').click();
  await expect(page).toHaveURL(/\/app\/runs\/build-r\?scenario=run-trace$/);
});

test('export saves the run as a JSON file', async ({ page }) => {
  await page.goto('/app/runs/turn-b?scenario=run-trace');
  await expect(page.getByTestId('run-failure')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTestId('run-export').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('cairn-run-turn-b.json');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/app\?scenario=run-trace$/);
  await expect(markButton(page)).not.toBeFocused();
});

test('a missing run says so in one sentence', async ({ page }) => {
  await page.goto('/app/runs/nope?scenario=run-trace');
  await expect(page.getByTestId('run-missing')).toContainText('找不到这条运行记录');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/app\?scenario=run-trace$/);
});

test.describe('narrow window', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the hint fits, the list fills the screen and a row pushes to its trace with a way back', async ({
    page,
  }) => {
    await page.goto(SCENARIO);
    const hint = page.getByTestId('run-trace-hint');
    await expect(hint).toBeVisible();
    const box = await hint.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await markButton(page).first().click();
    const column = page.getByTestId('run-list-column');
    await expect(column.locator('a[data-run-row]').first()).toBeVisible();
    expect((await column.boundingBox())!.width).toBeGreaterThan(380);
    await expect(page.getByTestId('run-page')).toHaveCount(0);
    expect(
      await page.getByTestId('run-list').evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await column.locator('a[data-run-row="turn-b"]').click();
    await expect(page.getByTestId('run-failure')).toBeVisible();
    await expect(column).toHaveCount(0);
    await page.getByTestId('run-back').click();
    await expect(page).toHaveURL(/\/app\/runs\/?\?thread=thread-run-trace&scenario=run-trace$/);
    await expect(column.locator('a[data-run-row="turn-b"]')).toBeVisible();
  });
});

test('live: the error row, the turn list and the run page call the team-scoped run endpoints', async ({
  page,
}) => {
  const asked: string[] = [];
  const trace = {
    kind: 'coordinator',
    id: 'step-9',
    title: '修看板计数',
    threadId: THREAD.id,
    todoId: null,
    status: 'failed',
    startedAt: 10,
    finishedAt: 20,
    models: ['claude-sonnet-5'],
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    failure: { text: 'Runner error: ENOSPC', itemId: null },
    items: [
      { kind: 'user', id: 'user-step-9', at: 10, text: '修看板计数' },
      { kind: 'error', id: 'chief-err-step-9', at: 20, text: 'Runner error: ENOSPC' },
    ],
  };
  await mockLive(
    page,
    {
      threads: [THREAD],
      messages: [
        { id: 'm1', role: 'user', content: '修看板计数', createdAt: 10 },
        {
          id: 'chief-err-step-9',
          role: 'system',
          content: JSON.stringify({ kind: 'chief_turn_error', message: 'Runner error: ENOSPC' }),
          createdAt: 20,
        },
      ],
    },
    (path, route, json) => {
      if (path === '/api/teams/t1/runs/step-9') {
        asked.push(path);
        return json(trace);
      }
      if (path === '/api/teams/t1/runs') {
        asked.push(`${path}?${new URL(route.request().url()).searchParams}`);
        if (asked.filter((p) => p.startsWith('/api/teams/t1/runs?')).length <= 2)
          return route.fulfill({ status: 500, body: 'boom' });
        return json({
          runs: [
            {
              id: 'step-9',
              kind: 'coordinator',
              threadId: THREAD.id,
              at: 10,
              status: 'failed',
              firstLine: '修看板计数',
              woke: false,
              source: null,
              toolCount: 0,
              durationMs: 10,
            },
          ],
          nextCursor: null,
        });
      }
      return undefined;
    },
  );
  await page.goto('/app');
  await markButton(page).click();
  const failed = page.getByTestId('run-list-error');
  await expect(failed).toContainText('未能加载运行记录');
  await failed.getByRole('button', { name: '重试' }).click();
  await expect(
    page.getByTestId('run-list').locator('a[data-run-row="step-9"][aria-current="page"]'),
  ).toBeVisible();
  await expect(page.getByTestId('run-failure')).toContainText('Runner error: ENOSPC');
  expect(asked).toContain(`/api/teams/t1/runs?problems=0&thread=${THREAD.id}`);
  expect(asked).toContain('/api/teams/t1/runs/step-9');
  await page.keyboard.press('Escape');
  await page.getByTestId('chief-turn-error-card').getByRole('link', { name: '运行记录' }).click();
  await expect(page).toHaveURL(/\/app\/runs\/step-9/);
  await expect(page.getByTestId('run-failure')).toContainText('Runner error: ENOSPC');
});
