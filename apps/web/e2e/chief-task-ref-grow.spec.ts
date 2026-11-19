import { expect, type Page, test } from '@playwright/test';
import { createTodoRow, mockLive, type Row, TASK, THREAD } from './chief-home-mock';

const SECOND = { ...TASK, id: 'todo-2', seqNum: 10, title: '模型设置删掉任务行' };
const streamUrl = `/api/conversations/${THREAD.id}/stream`;

async function openRunningTurn(page: Page) {
  const messages: Row[] = [
    { id: 'ask', role: 'user', content: '评估派发方式，再改模型设置', createdAt: 10 },
    createTodoRow('create-1', TASK, 20),
  ];
  await mockLive(page, {
    threads: [{ ...THREAD, activeRun: { phase: 'chief' } as unknown as null }],
    messages,
    todos: [TASK, SECOND],
  });
  await page.goto('/app');
  const refs = page.getByTestId('home-c').getByTestId('chief-task-refs');
  await expect(refs.getByTestId('chief-task-ref')).toHaveText([/^修复看板拖拽后计数不刷新/]);
  await page.waitForFunction(
    (u) => window.__es.some((es) => es.url.includes(u)),
    streamUrl,
  );
  const message = createTodoRow('create-2', SECOND, 30);
  messages.push(message);
  await page.evaluate(
    ([u, e]) => window.__es.find((es) => es.url.includes(u as string))?.emit(e),
    [streamUrl, { type: 'message', message }] as const,
  );
  await expect(refs.getByTestId('chief-task-ref')).toHaveCount(2);
  return refs;
}

test('a task dispatched in a running turn grows on that turn, and one already there when the page opened does not @motion', async ({
  page,
}) => {
  const refs = await openRunningTurn(page);
  const lines = refs.locator('[data-slot="task-ref-line"]');
  await expect(lines.nth(0)).not.toHaveAttribute('data-grow');
  await expect(lines.nth(1)).toHaveAttribute('data-grow', '');
  await expect(page.getByTestId('chief-task-started')).toHaveCount(0);
  await expect(page.getByTestId('chief-task-refs')).toHaveCount(1);
  await expect
    .poll(() =>
      lines
        .nth(1)
        .locator('[data-slot="task-ref-elbow"]')
        .evaluate((node) => getComputedStyle(node).animationName),
    )
    .toBe('task-ref-draw');
});

test('under reduced motion the new branch shows drawn at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const refs = await openRunningTurn(page);
  const grown = refs.locator('[data-slot="task-ref-line"]').nth(1);
  await expect(grown).toHaveAttribute('data-grow', '');
  expect(
    await grown
      .locator('[data-slot="task-ref-elbow"]')
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe('none');
  expect(
    await grown
      .getByTestId('chief-task-ref')
      .locator('.grow-pop')
      .evaluate((node) => getComputedStyle(node).opacity),
  ).toBe('1');
});

test('a task that finishes while the page is open draws its check; one already done when it opened does not @motion', async ({
  page,
}) => {
  const done = { ...SECOND, phase: 'done' };
  const state = {
    threads: [THREAD],
    messages: [
      { id: 'ask', role: 'user', content: '评估派发方式，再改模型设置', createdAt: 10 },
      createTodoRow('create-1', TASK, 20),
      createTodoRow('create-2', done, 21),
      { id: 'answer', role: 'assistant', content: '开了两个任务。', createdAt: 30 },
    ],
    todos: [TASK, done],
  };
  await mockLive(page, state);
  await page.goto('/app');
  const tiles = page.getByTestId('home-c').getByTestId('chief-task-ref').locator('[data-sealed]');
  await expect(page.getByTestId('home-c').getByTestId('chief-task-ref')).toHaveCount(2);
  await expect(tiles).toHaveCount(0);
  await page.waitForFunction(() => window.__es.some((es) => es.url.includes('/api/teams/t1/stream')));
  state.todos = [{ ...TASK, phase: 'done' }, done];
  await page.evaluate(() =>
    (
      window.__es.find((es) => es.url.includes('/api/teams/t1/stream')) as unknown as {
        onerror: () => void;
      }
    ).onerror(),
  );
  await expect(tiles).toHaveCount(1);
  expect(
    await tiles.locator('mask path').evaluate((node) => getComputedStyle(node).animationName),
  ).toBe('grow-cut-draw');
});
