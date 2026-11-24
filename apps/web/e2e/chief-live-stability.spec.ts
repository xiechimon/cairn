import { expect, type Page, test } from '@playwright/test';
import { createTodoRow, mockLive, type Row, TASK, THREAD } from './chief-home-mock';
import { offsetFrom, remounts, watchRemounts } from './live-stability';

const SECOND = { ...TASK, id: 'todo-2', seqNum: 10, title: '模型设置删掉任务行' };
const streamUrl = `/api/conversations/${THREAD.id}/stream`;
const REPLY = '我开了两个任务：[#9](todo:todo-1) 和 [#10](todo:todo-2)。';

const emit = (page: Page, ev: unknown) =>
  page.evaluate(([u, e]) => window.__es.find((es) => es.url.includes(u as string))?.emit(e), [streamUrl, ev] as const);

test('C23: a whole Coordinator turn never rebuilds or moves what it already showed @motion', async ({ page }) => {
  const messages: Row[] = [{ id: 'ask', role: 'user', content: '评估派发方式，再改模型设置', createdAt: 10 }];
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
  await watchRemounts(page, ['chief-bubble', 'research-report-card', 'md-task']);

  for (const [n, task] of [TASK, SECOND].entries()) {
    const message = createTodoRow(`create-${n}`, task, 20 + n);
    messages.push(message);
    await emit(page, { type: 'message', message });
  }
  const user = home.getByTestId('chief-bubble').first();
  await expect(home.getByTestId('chief-task-started')).toHaveCount(0);
  await expect(home.getByTestId('chief-task-started-said')).toHaveCount(0);

  await emit(page, { type: 'text_delta', text: REPLY });
  await expect(home.getByTestId('chief-reply')).toContainText('我开了两个任务');
  const words = home.locator('a[data-slot="task-mention"]');
  await expect(words).toHaveCount(2);
  const reply = home.getByTestId('chief-reply').first();
  const settledAt = await offsetFrom(user, reply);

  const answer: Row = { id: 'answer', role: 'assistant', content: REPLY, createdAt: 40 };
  messages.push(answer);
  running = false;
  await emit(page, { type: 'message', message: answer });
  await emit(page, { type: 'step', step: { id: 'ask', status: 'done' } });
  await expect(home.getByTestId('typing-dots')).toHaveCount(0);
  await expect(words).toHaveCount(2);
  await expect(home.getByTestId('chief-task-started-said')).toHaveCount(0);
  expect(await offsetFrom(user, reply)).toBe(settledAt);
  expect(await remounts(page)).toEqual([]);
});
