import { expect, test } from '@playwright/test';
import { mockLive, TASK, taskEntry, THREAD } from './chief-home-mock';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

const created = {
  id: 'm2',
  role: 'assistant',
  content: {
    kind: 'toolcall',
    call: {
      id: 'c-m2',
      name: 'create_todo',
      arguments: { title: TASK.title, projectId: 'proj-1', spec: 's' },
      result: { id: TASK.id },
      startedAt: 11,
      endedAt: 12,
    },
  },
  createdAt: 11,
};

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

test('a task the Coordinator created shows as a card after its reply, with status, updates and the latest line', async ({
  page,
}) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: MESSAGES,
    tasks: [taskEntry({ section: 'working' })],
  });
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  const card = stream.locator('[data-slot="task-card"]');
  await expect(card).toHaveCount(1);
  await expect(card.locator('[data-slot="task-card-title"]')).toHaveText(TASK.title);
  await expect(card.locator('[data-slot="task-card-status"]')).toHaveText(/^In progress\s*· updates: 2$/);
  await expect(card.locator('[data-slot="task-card-latest"]')).toHaveText(
    'Latest: prepush has the check; CI is next',
  );
  const reply = stream.getByText('Created #9 in cairn and forwarded your words.');
  const replyBox = await reply.boundingBox();
  const cardBox = await card.boundingBox();
  expect(cardBox!.y).toBeGreaterThan(replyBox!.y);
  await card.click();
  await expect(page).toHaveURL(new RegExp(`thread=${TASK.id}`));
});

test('a created task the Tasks read no longer lists falls back to a one-line link', async ({ page }) => {
  await mockLive(page, { threads: [THREAD], messages: MESSAGES, tasks: [] });
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  await expect(stream.locator('[data-slot="task-card"]')).toHaveCount(0);
  await expect(stream.getByTestId('chief-task-created')).toContainText('Created task');
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
  await expect(page.getByTestId('home-c-since')).toContainText('2 waiting on you');
  await expect(page.getByTestId('needs-you')).toHaveCount(0);
  await expect(page.getByTestId('chief-composer-block').locator('[data-slot="thread-card"]')).toHaveCount(0);
});
