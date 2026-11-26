import { expect, type Page, test } from '@playwright/test';
import { createTodoRow, mockLive, TASK, THREAD } from './chief-home-mock';

const RUNNING = { ...TASK, id: 'todo-1', seqNum: 9, title: '修复看板拖拽后计数不刷新', phase: 'building' };
const WAITING = { ...TASK, id: 'todo-2', seqNum: 10, title: '模型设置删掉任务行', phase: 'confirm' };
const DONE = { ...TASK, id: 'todo-3', seqNum: 11, title: '调研派发卡片的生成式 UI', phase: 'done' };

async function open(page: Page, todos: (typeof RUNNING)[], reply: string) {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'u1', role: 'user', content: '修计数、删任务行、再调研一下派发卡片', createdAt: 10 },
      ...todos.map((todo, n) => createTodoRow(`c${n}`, todo, 11 + n)),
      { id: 'r1', role: 'assistant', content: reply, createdAt: 20 },
    ],
    todos,
    tasks: [],
  });
  await page.goto('/app');
  return page.getByTestId('chief-stream');
}

test('a reply that created one task carries one branch above its bubble, and the branch opens the task', async ({
  page,
}) => {
  const stream = await open(page, [RUNNING], '开好了，它正在跑。');
  const trunk = stream.getByTestId('chief-task-trunk');
  await expect(trunk).toHaveCount(1);
  const refs = trunk.getByTestId('chief-task-ref');
  await expect(refs).toHaveCount(1);
  await expect(refs).toContainText(RUNNING.title);
  await expect(refs.locator('svg[data-glyph]')).toHaveCount(1);
  await expect(refs).toHaveAccessibleName(new RegExp(`${RUNNING.title}.*执行中`));
  await expect(trunk.locator('[data-slot="task-ref-elbow"]')).toHaveCount(1);
  await expect(stream.getByTestId('chief-task-started-said')).toHaveCount(0);
  const bubble = stream.locator('[data-slot="message-bubble"]').filter({ hasText: '开好了' });
  const rowBox = (await refs.boundingBox())!;
  const bubbleBox = (await bubble.boundingBox())!;
  expect(rowBox.y + rowBox.height, 'the branch sits above the reply bubble').toBeLessThanOrEqual(bubbleBox.y);
  expect(Math.abs(rowBox.x - bubbleBox.x), 'rows indent from the bubble edge').toBeLessThanOrEqual(40);
  await refs.click();
  await expect(page).toHaveURL(new RegExp(`thread=${RUNNING.id}`));
});

test('three tasks hang off one trunk with a branch each, in the order they were created', async ({ page }) => {
  const stream = await open(page, [RUNNING, WAITING, DONE], '开了三个任务：一个在跑，一个等你确认，调研已经做完。');
  const trunk = stream.getByTestId('chief-task-trunk');
  await expect(trunk).toHaveCount(1);
  const refs = trunk.getByTestId('chief-task-ref');
  await expect(refs).toHaveText([RUNNING.title, WAITING.title, DONE.title].map((title) => new RegExp(title)));
  await expect(trunk.locator('[data-slot="task-ref-elbow"]')).toHaveCount(3);
  await expect(trunk.locator('[data-slot="task-ref-trunk"]').first()).toBeVisible();
  for (const [n, glyph] of (['working', 'attention', 'done'] as const).entries()) {
    await expect(refs.nth(n).locator(`svg[data-glyph="${glyph}"]`)).toHaveCount(1);
  }
  await refs.first().hover();
  const card = page.getByTestId('chief-task-ref-hover');
  await expect(card).toBeVisible();
  await expect(card).toContainText(RUNNING.title);
  await expect(card).toContainText('项目');
});

test('a task the reply names in prose still hangs on the trunk; no 已建任务 line repeats it', async ({ page }) => {
  const stream = await open(page, [RUNNING], `已建任务 [#9](todo:${RUNNING.id})，正在跑。`);
  await expect(stream.getByTestId('chief-task-trunk').getByTestId('chief-task-ref')).toHaveCount(1);
  await expect(stream.getByTestId('chief-task-started-said')).toHaveCount(0);
});
