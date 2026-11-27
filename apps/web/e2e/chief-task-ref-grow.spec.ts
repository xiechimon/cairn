import { expect, type Page, test } from '@playwright/test';
import { createTodoRow, mockLive, type Row, TASK, THREAD } from './chief-home-mock';
import { offsetFrom, remounts, watchRemounts } from './live-stability';

const SECOND = { ...TASK, id: 'todo-2', seqNum: 10, title: '模型设置删掉任务行' };
const THIRD = { ...TASK, id: 'todo-3', seqNum: 11, title: '补充派发文档说明' };
const streamUrl = `/api/conversations/${THREAD.id}/stream`;

const emit = (page: Page, ev: unknown) =>
  page.evaluate(
    ([u, e]) => window.__es.find((es) => es.url.includes(u as string))?.emit(e),
    [streamUrl, ev] as const,
  );

async function openRunningTurn(page: Page, extras: (typeof SECOND)[] = [SECOND]) {
  const messages: Row[] = [
    { id: 'ask', role: 'user', content: '评估派发方式，再改模型设置', createdAt: 10 },
    createTodoRow('create-1', TASK, 20),
  ];
  await mockLive(page, {
    threads: [{ ...THREAD, activeRun: { phase: 'chief' } as unknown as null }],
    messages,
    todos: [TASK, ...extras],
  });
  await page.goto('/app');
  const trunk = page.getByTestId('home-c').getByTestId('chief-task-trunk');
  await expect(trunk.getByTestId('chief-task-ref')).toHaveText([/^修复看板拖拽后计数不刷新/]);
  await page.waitForFunction((u) => window.__es.some((es) => es.url.includes(u)), streamUrl);
  const incoming = extras.map((todo, idx) => createTodoRow(`create-${idx + 2}`, todo, 30 + idx));
  messages.push(...incoming);
  await page.evaluate(
    ([u, list]) => {
      const es = window.__es.find((entry) => entry.url.includes(u as string));
      for (const message of list as Row[]) es?.emit({ type: 'message', message });
    },
    [streamUrl, incoming] as const,
  );
  await expect(trunk.getByTestId('chief-task-ref')).toHaveCount(1 + extras.length);
  return trunk;
}

test('a task dispatched in a running turn grows with 350ms sibling stagger, and one already there does not @motion', async ({
  page,
}) => {
  const trunk = await openRunningTurn(page, [SECOND, THIRD]);
  const lines = trunk.locator('[data-slot="task-ref-line"]');
  await expect(lines.nth(0)).not.toHaveAttribute('data-grow');
  await expect(lines.nth(1)).toHaveAttribute('data-grow', '');
  await expect(lines.nth(2)).toHaveAttribute('data-grow', '');
  await expect(page.getByTestId('chief-task-started')).toHaveCount(0);
  await expect(page.getByTestId('chief-task-trunk')).toHaveCount(1);
  expect(
    await lines.nth(1).evaluate((node) => getComputedStyle(node).getPropertyValue('--grow-delay').trim()),
  ).toBe('0ms');
  expect(
    await lines.nth(2).evaluate((node) => getComputedStyle(node).getPropertyValue('--grow-delay').trim()),
  ).toBe('350ms');
  await expect
    .poll(() =>
      lines
        .nth(1)
        .locator('[data-slot="task-ref-elbow"]')
        .evaluate((node) => getComputedStyle(node).animationName),
    )
    .toBe('task-ref-draw');
});

test('live dispatch keeps zero CLS, echoes on inline task word, never remounts trunk, and opens on click @motion', async ({
  page,
}) => {
  const messages: Row[] = [{ id: 'ask', role: 'user', content: '评估派发方式，再改模型设置', createdAt: 10 }];
  const replyText = '我开了两个任务：[#9](todo:todo-1) 和 [#10](todo:todo-2)。';
  let running = true;
  await mockLive(page, { threads: [THREAD], messages, todos: [TASK, SECOND] }, (path, _route, json) =>
    path === '/api/teams/t1/chief/threads'
      ? json([{ ...THREAD, activeRun: running ? { phase: 'chief' } : null }])
      : undefined,
  );
  await page.goto('/app');
  const home = page.getByTestId('home-c');
  await expect(home.getByTestId('typing-dots')).toBeVisible();
  await page.waitForFunction((u) => window.__es.some((es) => es.url.includes(u)), streamUrl);
  await watchRemounts(page, ['chief-bubble', 'chief-task-trunk', 'chief-task-ref']);

  const userBubble = home.getByTestId('chief-bubble').first();

  for (const [n, todo] of [TASK, SECOND].entries()) {
    const message = createTodoRow(`create-${n}`, todo, 20 + n);
    messages.push(message);
    await emit(page, { type: 'message', message });
  }

  const trunk = home.getByTestId('chief-task-trunk');
  await expect(trunk.getByTestId('chief-task-ref')).toHaveCount(2);
  const trunkOffset = await offsetFrom(userBubble, trunk);

  const lines = trunk.locator('[data-slot="task-ref-line"]');
  await expect(lines.nth(0)).toHaveAttribute('data-grow', '');
  await expect(lines.nth(1)).toHaveAttribute('data-grow', '');
  expect((await lines.nth(0).boundingBox())?.height).toBe(28);
  expect((await lines.nth(1).boundingBox())?.height).toBe(28);

  await emit(page, { type: 'text_delta', text: replyText });
  await expect(home.locator('a[data-slot="task-mention"]')).toHaveCount(2);
  await expect(lines.nth(0)).toHaveAttribute('data-echo', '');
  await expect(lines.nth(1)).toHaveAttribute('data-echo', '');
  expect(await offsetFrom(userBubble, trunk)).toBe(trunkOffset);

  const answer: Row = { id: 'answer', role: 'assistant', content: replyText, createdAt: 40 };
  messages.push(answer);
  running = false;
  await emit(page, { type: 'message', message: answer });
  await emit(page, { type: 'step', step: { id: 'ask', status: 'done' } });
  await expect(home.getByTestId('typing-dots')).toHaveCount(0);
  await expect(trunk.getByTestId('chief-task-ref')).toHaveCount(2);
  expect(await offsetFrom(userBubble, trunk)).toBe(trunkOffset);
  expect(await remounts(page)).toEqual([]);

  await trunk.getByTestId('chief-task-ref').first().click();
  await expect(page).toHaveURL(/thread=todo-1/);
});

test('reload and history draw all branches at once without grow animation', async ({ page }) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'ask', role: 'user', content: '开两个任务', createdAt: 10 },
      createTodoRow('c1', TASK, 11),
      createTodoRow('c2', SECOND, 12),
      { id: 'r1', role: 'assistant', content: '已建 [#9](todo:todo-1) 和 [#10](todo:todo-2)。', createdAt: 20 },
    ],
    todos: [TASK, SECOND],
  });
  await page.goto('/app');
  await expect(page.getByTestId('chief-task-trunk').getByTestId('chief-task-ref')).toHaveCount(2);
  await page.reload();
  const trunk = page.getByTestId('chief-task-trunk');
  await expect(trunk.getByTestId('chief-task-ref')).toHaveCount(2);
  await expect(trunk.locator('[data-grow]')).toHaveCount(0);
  const elbows = trunk.locator('[data-slot="task-ref-elbow"]');
  expect(await elbows.nth(0).evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  expect(await elbows.nth(1).evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
});

test('branch and inline task word highlight each other bidirectionally on hover', async ({ page }) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'ask', role: 'user', content: '开两个任务', createdAt: 10 },
      createTodoRow('c1', TASK, 11),
      createTodoRow('c2', SECOND, 12),
      { id: 'r1', role: 'assistant', content: '已建 [#9](todo:todo-1) 和 [#10](todo:todo-2)。', createdAt: 20 },
    ],
    todos: [TASK, SECOND],
  });
  await page.goto('/app');
  const trunk = page.getByTestId('chief-task-trunk');
  const lines = trunk.locator('[data-slot="task-ref-line"]');
  const refs = trunk.getByTestId('chief-task-ref');
  const words = page.getByTestId('chief-stream').locator('a[data-slot="task-mention"]');
  await expect(refs).toHaveCount(2);
  await expect(words).toHaveCount(2);

  await refs.nth(0).hover();
  await expect(lines.nth(0)).toHaveAttribute('data-hl', '');
  await expect(words.nth(0)).toHaveAttribute('data-hl', '');
  await expect(lines.nth(1)).not.toHaveAttribute('data-hl');
  await expect(words.nth(1)).not.toHaveAttribute('data-hl');
  await expect(lines.nth(1).locator('[data-slot="task-ref-trunk"]')).toHaveAttribute('data-hl', '');
  await expect(trunk.locator('> [data-slot="task-ref-guide"]')).toHaveAttribute('data-hl', '');

  await page.mouse.move(0, 0);
  await expect(page.locator('[data-hl]')).toHaveCount(0);

  await words.nth(1).hover();
  await expect(words.nth(1)).toHaveAttribute('data-hl', '');
  await expect(lines.nth(1)).toHaveAttribute('data-hl', '');
  await expect(words.nth(0)).not.toHaveAttribute('data-hl');
  await expect(lines.nth(0)).not.toHaveAttribute('data-hl');
  await expect
    .poll(async () => {
      const [stroke0, stroke1] = await Promise.all([
        lines.nth(0).locator('[data-slot="task-ref-elbow"]').evaluate((n) => getComputedStyle(n).stroke),
        lines.nth(1).locator('[data-slot="task-ref-elbow"]').evaluate((n) => getComputedStyle(n).stroke),
      ]);
      return stroke0 !== stroke1;
    })
    .toBe(true);
});

test('under reduced motion the new branch shows drawn at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const trunk = await openRunningTurn(page, [SECOND]);
  const grown = trunk.locator('[data-slot="task-ref-line"]').nth(1);
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
