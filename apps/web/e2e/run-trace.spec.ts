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
  await page.getByTestId('run-next').click();
  await expect(page).toHaveURL(/\/app\/runs\/turn-s/);
  await expect(page.getByTestId('run-item-stopped')).toBeVisible();
  await expect(page.getByTestId('run-next')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/app\?scenario=run-trace$/);
  await expect(page.getByTestId('run-page')).toHaveCount(0);
});

test('the stopped turn row links to its run log', async ({ page }) => {
  await page.goto(SCENARIO);
  await page.getByTestId('chief-stopped').getByRole('link', { name: '运行记录' }).click();
  await expect(page).toHaveURL(/\/app\/runs\/turn-s/);
  await page.getByTestId('run-page').getByRole('button', { name: /read/ }).click();
  await expect(page.getByTestId('run-page').getByText('暂无输出')).toBeVisible();
});

test('the hint shows once, opens the turn list, and stays gone after a reload', async ({ page }) => {
  await page.goto(SCENARIO);
  const hint = page.getByTestId('run-trace-hint');
  await expect(hint).toContainText('点这里看每一轮做了什么');
  const composer = await page.getByTestId('chief-composer-block').boundingBox();
  const hintBox = await hint.boundingBox();
  expect(composer).not.toBeNull();
  expect(hintBox).not.toBeNull();
  expect(hintBox!.y + hintBox!.height).toBeLessThan(composer!.y);
  await hint.getByRole('button', { name: '点这里看每一轮做了什么' }).click();
  await expect(page.getByTestId('run-turns-popover')).toBeVisible();
  await expect(hint).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('run-turns-popover')).toHaveCount(0);
  await expect(markButton(page)).toBeFocused();
  await page.reload();
  await expect(page.getByTestId('chief-turn-error')).toBeVisible();
  await expect(hint).toHaveCount(0);
});

test('closing the hint with × also retires it', async ({ page }) => {
  await page.goto(SCENARIO);
  await page.getByTestId('run-trace-hint-close').click();
  await expect(page.getByTestId('run-trace-hint')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('chief-turn-error')).toBeVisible();
  await expect(page.getByTestId('run-trace-hint')).toHaveCount(0);
});

test('the avatar list shows problem turns first, can show all, pages on scroll, and works by keyboard', async ({
  page,
}) => {
  await page.goto(SCENARIO);
  await markButton(page).click();
  const list = page.getByTestId('run-turns');
  const rows = list.locator('a[data-run-turn]');
  await expect(rows.first()).toHaveAttribute('data-run-turn', 'turn-s');
  await expect(list.getByText('已停止')).toBeVisible();
  await expect(list.locator('a[data-run-turn="turn-a"]')).toHaveCount(0);
  await page.getByTestId('run-turns-problems').click();
  await expect(list.locator('a[data-run-turn="turn-a"]')).toHaveCount(1);
  await expect(rows).toHaveCount(20);
  await expect(list.getByRole('list', { name: '今天' })).toBeVisible();
  await expect(list.getByRole('list', { name: '昨天' })).toBeVisible();
  await list.locator('[aria-hidden="true"]').last().scrollIntoViewIfNeeded();
  await expect(rows).toHaveCount(25);
  const older = list.getByRole('list', { name: '更早' }).locator('a[data-run-turn]').first();
  await expect(older).toBeVisible();
  expect((await older.boundingBox())?.height).toBe((await rows.first().boundingBox())?.height);
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/runs\/turn-b/);
  await expect(page.getByTestId('run-turns-popover')).toHaveCount(0);
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
});

test('a missing run says so in one sentence', async ({ page }) => {
  await page.goto('/app/runs/nope?scenario=run-trace');
  await expect(page.getByTestId('run-missing')).toContainText('找不到这条运行记录');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/app\?scenario=run-trace$/);
});

test.describe('narrow window', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the hint sits under the avatar inside the window and the list fits', async ({ page }) => {
    await page.goto(SCENARIO);
    const hint = page.getByTestId('run-trace-hint');
    await expect(hint).toBeVisible();
    const box = await hint.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await markButton(page).first().click();
    const pop = await page.getByTestId('run-turns-popover').boundingBox();
    expect(pop!.x).toBeGreaterThanOrEqual(0);
    expect(pop!.x + pop!.width).toBeLessThanOrEqual(390);
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
    previousId: null,
    nextId: null,
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
      if (path === `/api/teams/t1/chief/threads/${THREAD.id}/turns`) {
        asked.push(`${path}?${new URL(route.request().url()).searchParams}`);
        if (asked.length <= 2) return route.fulfill({ status: 500, body: 'boom' });
        return json({
          turns: [
            { stepId: 'step-9', at: 10, problem: 'failed', firstLine: '修看板计数', woke: false, toolCount: 0, durationMs: 10 },
          ],
          nextCursor: null,
        });
      }
      return undefined;
    },
  );
  await page.goto('/app');
  await markButton(page).click();
  const failed = page.getByTestId('run-turns-error');
  await expect(failed).toContainText('未能加载运行记录');
  await failed.getByRole('button', { name: '重试' }).click();
  await expect(page.getByTestId('run-turns').locator('a[data-run-turn="step-9"]')).toBeVisible();
  expect(asked).toContain(`/api/teams/t1/chief/threads/${THREAD.id}/turns?problems=1`);
  await page.keyboard.press('Escape');
  await page.getByTestId('chief-turn-error-card').getByRole('link', { name: '运行记录' }).click();
  await expect(page.getByTestId('run-failure')).toContainText('Runner error: ENOSPC');
  expect(asked).toContain('/api/teams/t1/runs/step-9');
});
