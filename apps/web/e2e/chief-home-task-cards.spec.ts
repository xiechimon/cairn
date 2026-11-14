import { expect, test } from '@playwright/test';
import { createdTodoMessage as created } from '../test/fixtures/chief-create-todo.js';
import { mockLive, TASK as BASE_TASK, taskEntry, THREAD } from './chief-home-mock';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

const TASK = { ...BASE_TASK, title: created.content.call.arguments.title };

const report = (id: string, line: string, createdAt: number) => ({
  id,
  role: 'system',
  content: JSON.stringify({
    kind: 'thread-report',
    todoId: TASK.id,
    phase: 'review',
    seqNum: TASK.seqNum,
    title: TASK.title,
    line,
  }),
  createdAt,
});

const MESSAGES = [
  { id: 'm1', role: 'user', content: 'Block internal addresses in hooks and CI', createdAt: 10 },
  created,
  { id: 'm3', role: 'assistant', content: 'Created #9 in cairn and forwarded your words.', createdAt: 13 },
  report('m4', 'Reproduced the leak in a commit', 20),
  report('m5', 'prepush has the check; CI is next', 30),
];

const needsInput = (n: number) =>
  taskEntry({
    id: `todo-${n}`,
    seqNum: n,
    title: `Waiting task ${n}`,
    phase: 'confirm',
    owner: 'owner',
    section: 'needs_input',
  });

const MENTIONING = MESSAGES.map((message) =>
  message.id === 'm3'
    ? { ...message, content: `Created [#${TASK.seqNum}](todo:${TASK.id}) in cairn and forwarded your words.` }
    : message,
);

test('a task the Coordinator created is one reference row below the reply that announced it, with no card', async ({
  page,
}) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: MESSAGES,
    todos: [TASK],
    tasks: [taskEntry({ section: 'working', title: TASK.title })],
  });
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  const reply = stream
    .getByTestId('chief-msg')
    .filter({ hasText: 'Created #9 in cairn and forwarded your words.' });
  const ref = stream.getByTestId('chief-task-ref');
  await expect(ref).toHaveCount(1);
  await expect(reply.getByTestId('chief-task-ref')).toHaveCount(1);
  await expect(ref).toHaveText(new RegExp(`^${TASK.title}`));
  await expect(ref).toHaveAttribute('data-phase', 'building');
  await expect(ref.locator('svg[data-glyph="progress"]')).toHaveCount(1);
  await expect(ref).toHaveAccessibleName(new RegExp(`${TASK.title}.*Running`));
  await expect(reply.locator('[data-slot="task-ref-elbow"]')).toHaveCount(1);
  await expect(reply.locator('[data-slot="task-ref-trunk"]')).toHaveCount(0);
  await expect(stream.locator('[data-slot="task-card"]')).toHaveCount(0);
  await expect(stream.getByTestId('chief-task-card')).toHaveCount(0);
  await expect(stream.getByTestId('chief-task-started')).toHaveCount(0);
  await expect(stream.getByTestId('chief-task-created')).toHaveCount(0);
  await expect(stream).not.toContainText('Latest:');
  await expect(stream).not.toContainText('updates:');
  const tileBox = await ref.locator('span.grid').boundingBox();
  const bubbleBox = await reply.getByTestId('chief-reply-bubble').boundingBox();
  expect(tileBox!.y - (bubbleBox!.y + bubbleBox!.height)).toBe(10);
  await ref.click();
  await expect(page).toHaveURL(new RegExp(`thread=${TASK.id}`));
});

test('a reply that both mentions and created a task shows exactly one reference for it', async ({
  page,
}) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: MENTIONING,
    todos: [TASK],
    tasks: [taskEntry({ section: 'working', title: TASK.title })],
  });
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  const reply = stream.getByTestId('chief-msg').filter({ hasText: 'in cairn and forwarded your words.' });
  await expect(reply.locator('a[data-slot="task-mention"]')).toHaveCount(1);
  await expect(reply.locator('.mention-chip--todo')).toHaveCount(0);
  await expect(reply.locator('svg[data-glyph]')).toHaveCount(1);
  await expect(reply.getByTestId('chief-task-refs')).toHaveCount(1);
  await expect(reply.getByTestId('chief-task-ref')).toHaveCount(1);
  await expect(stream.getByTestId('chief-task-ref')).toHaveCount(1);
  await expect(stream.getByTestId('chief-task-started')).toHaveCount(0);
  await expect(stream.locator('[data-slot="task-card"]')).toHaveCount(0);
});

test('two tasks created in one turn get one reference each on that reply', async ({ page }) => {
  const second = { ...TASK, id: 'todo-2', seqNum: 10, title: 'Rotate the relay token', phase: 'review' };
  const createdSecond = {
    ...created,
    id: 'm2b',
    content: {
      ...created.content,
      call: {
        ...created.content.call,
        id: 'call-create-second',
        arguments: { ...created.content.call.arguments, title: second.title },
        result: [{ type: 'text', text: JSON.stringify({ id: second.id, seqNum: 10, title: second.title }) }],
      },
    },
  };
  await mockLive(page, {
    threads: [THREAD],
    messages: [MENTIONING[0]!, created, createdSecond, ...MENTIONING.slice(2)],
    todos: [TASK, second],
    tasks: [],
  });
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  const refs = stream.getByTestId('chief-task-ref');
  await expect(refs).toHaveCount(2);
  await expect(refs.nth(0)).toHaveText(new RegExp(`^${TASK.title}`));
  await expect(refs.nth(1)).toHaveText(new RegExp(`^${second.title}`));
  await expect(refs.nth(1)).toHaveAttribute('data-phase', 'review');
  await expect(stream.getByTestId('chief-task-refs')).toHaveCount(1);
});

test('a task created in a turn with no reply yet stands as one reference chip without a connector', async ({
  page,
}) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [MESSAGES[0]!, created],
    todos: [TASK],
    tasks: [],
  });
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  const row = stream.getByTestId('chief-task-started');
  await expect(row).toHaveCount(1);
  const ref = row.getByTestId('chief-task-ref');
  await expect(ref).toHaveCount(1);
  await expect(stream.getByTestId('chief-task-ref')).toHaveCount(1);
  await expect(ref).toHaveText(new RegExp(`^${TASK.title}`));
  await expect(ref.locator('[data-slot="task-ref-elbow"]')).toHaveCount(0);
  await expect(ref.locator('svg[data-glyph="progress"]')).toHaveCount(1);
  await ref.click();
  await expect(page).toHaveURL(new RegExp(`thread=${TASK.id}`));
});

test('a created task the page no longer knows falls back to a one-line link', async ({ page }) => {
  await mockLive(page, { threads: [THREAD], messages: MESSAGES, todos: [], tasks: [] });
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  await expect(stream.getByTestId('chief-task-ref')).toHaveCount(0);
  await expect(stream.locator('[data-slot="task-card"]')).toHaveCount(0);
  await expect(stream.getByTestId('chief-task-created')).toHaveText(`Created task ${TASK.title}`);
});

test('tasks waiting on the owner put no tray above the composer; the greeting count is the Tasks badge', async ({
  page,
}) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [],
    todos: [1, 2, 3].map((n) => ({ ...TASK, id: `todo-${n}`, seqNum: n, phase: 'failed' })),
    tasks: [needsInput(4), needsInput(5)],
  });
  await page.goto('/app');
  await expect(page.getByTestId('tasks-badge')).toHaveText('2');
  await expect(page.getByTestId('needs-you')).toHaveCount(0);
  await expect(page.getByTestId('chief-composer-block').locator('[data-slot="thread-card"]')).toHaveCount(0);
});

test.describe('at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the task reference is one line inside the column: tile and title, and it opens the task', async ({
    page,
  }) => {
    await mockLive(page, {
      threads: [THREAD],
      messages: MESSAGES,
      todos: [TASK],
      tasks: [taskEntry({ section: 'working', title: TASK.title })],
    });
    await page.goto('/app');
    const stream = page.getByTestId('chief-stream');
    const ref = stream.getByTestId('chief-task-ref');
    await expect(ref).toHaveCount(1);
    await expect(stream.locator('[data-slot="task-card"]')).toHaveCount(0);
    await expect(ref).toHaveText(new RegExp(`^${TASK.title}`));
    const box = await ref.boundingBox();
    expect(box!.height).toBe(28);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390 - 16);
    await ref.click();
    await expect(page).toHaveURL(new RegExp(`thread=${TASK.id}`));
  });
});
