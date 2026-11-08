import { expect, type Page, test } from '@playwright/test';

const TEAM_ID = 'team-1';
const USER = { id: 'user-1', displayName: 'ian', avatarUrl: null };
const THREAD = {
  id: 'chief-global',
  chiefId: 'chief-user-1-team-1',
  userId: USER.id,
  teamId: TEAM_ID,
  title: 'Coordinator',
  createdAt: 1,
  updatedAt: 1,
  lastTurnAt: null,
  session: { runtime: 'pi', id: 's1', openedAt: 1 },
  pendingSessionResumeAt: null,
  toolDefHashes: {},
  toolResultHashes: {},
  activeRun: null,
};

function todo(id: string, seqNum: number, title: string, phase: string, latestBuildId: string | null) {
  return {
    id,
    teamId: TEAM_ID,
    projectId: 'project-1',
    title,
    spec: title,
    phase,
    phaseAt: Date.now(),
    seqNum,
    orderIndex: 0,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId,
    lastRunAt: 0,
    hasChanges: false,
    hasPlan: phase === 'confirm',
    buildHistory: latestBuildId === null ? [] : [{ buildId: latestBuildId, createdAt: 0 }],
    sourceTodo: null,
    v: 1,
  };
}

interface Sent {
  todoId: string;
  body: Record<string, unknown>;
}

async function stubHome(
  page: Page,
  todos: unknown[],
  status = 201,
  hold: Promise<void> = Promise.resolve(),
): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({ json: [{ id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }] }),
  );
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route(`**/api/teams/${TEAM_ID}/notifications`, (route) =>
    route.fulfill({ json: { unreadThreadIds: [] } }),
  );
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: todos }));
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/teams/${TEAM_ID}/chief`, (route) =>
    route.fulfill({
      json: {
        chief: {
          id: THREAD.chiefId,
          userId: USER.id,
          teamId: TEAM_ID,
          agent: { agentId: 'agent-1' },
          charter: null,
          lastTurnAt: null,
          createdAt: 0,
          tz: null,
        },
        agentActor: null,
        context: null,
        watches: [],
        wakes: [],
      },
    }),
  );
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route) => route.fulfill({ json: [THREAD] }));
  await page.route(`**/api/conversations/${THREAD.id}/messages*`, (route) =>
    route.fulfill({ json: { messages: [] } }),
  );
  await page.route('**/api/todos/*/messages', async (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    const todoId = new URL(request.url()).pathname.split('/')[3] ?? '';
    sent.push({ todoId, body: JSON.parse(request.postData() ?? '{}') as Record<string, unknown> });
    await hold;
    return status === 201
      ? route.fulfill({
          status,
          json: { todoId, conversationId: 'build-1', delivered: 'revision' },
        })
      : route.fulfill({ status, json: { error: 'thread #7 cannot take a message while queued' } });
  });
  return sent;
}

async function card(page: Page, title: string) {
  await page.getByTestId('needs-you-chip').click();
  const row = page.getByTestId('needs-you-inbox-row').filter({ hasText: title });
  await row.getByTestId('needs-you-inbox-toggle').click();
  return row;
}

test('an inbox row replies straight to its thread, says where it goes, and leaves once sent', async ({ page }) => {
  const sent = await stubHome(page, [todo('todo-7', 7, 'Split the routing migration', 'confirm', 'build-1')]);
  await page.goto('/app');
  const target = await card(page, 'Split the routing migration');
  const box = target.getByRole('textbox', { name: 'Reply to #7' });
  await expect(box).toBeFocused();
  await expect(target).toContainText('Plan feedback for #7, not an approval.');
  await box.fill('Split the migration out first');
  await box.press('Enter');
  await expect(target).toHaveCount(0);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    todoId: 'todo-7',
    body: { content: 'Split the migration out first', clientMessageId: expect.any(String) },
  });
});

test('a refused reply keeps the draft and says it was not sent', async ({ page }) => {
  await stubHome(page, [todo('todo-7', 7, 'Split the routing migration', 'confirm', 'build-1')], 409);
  await page.goto('/app');
  const target = await card(page, 'Split the routing migration');
  const box = target.getByRole('textbox', { name: 'Reply to #7' });
  await box.fill('Keep this text');
  await box.press('Enter');
  await expect(target).toContainText('Not sent. Try again.');
  await expect(box).toHaveValue('Keep this text');
});

test('a thread asking you takes the reply as its answer; an empty reply cannot be sent', async ({ page }) => {
  const sent = await stubHome(page, [
    {
      ...todo('todo-12', 12, 'Fix the orb permission', 'needs_input', 'build-12'),
      waitingOn: { on: 'owner', retryAt: null },
      ask: { text: 'Keep the old grant?', requestId: 'ask-12', options: [], defaultAnswer: null },
    },
  ]);
  await page.goto('/app');
  const target = await card(page, 'Fix the orb permission');
  await expect(target).toContainText('The answer goes to #12, which then picks up again.');
  await expect(target.getByRole('button', { name: 'Send' })).toBeDisabled();
  await target.getByRole('textbox', { name: 'Reply to #12' }).press('Enter');
  expect(sent).toHaveLength(0);
});

test('while a reply is in flight the box is read-only; on success the thread leaves Needs you and the conversation records it', async ({
  page,
}) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const confirm = todo('todo-7', 7, 'Split the routing migration', 'confirm', 'build-1');
  const todos = [confirm];
  const sent = await stubHome(page, todos, 201, hold);
  let delivered = false;
  await page.route(`**/api/conversations/${THREAD.id}/messages*`, (route) =>
    route.fulfill({
      json: {
        messages: delivered
          ? [
              {
                id: 'marker-1',
                role: 'system',
                createdAt: 2,
                content: JSON.stringify({
                  kind: 'thread-message',
                  todoId: 'todo-7',
                  seqNum: 7,
                  title: 'Split the routing migration',
                  excerpt: 'Do A',
                  delivered: 'revision',
                  conversationId: 'build-1',
                }),
              },
            ]
          : [],
      },
    }),
  );
  await page.goto('/app');
  const target = await card(page, 'Split the routing migration');
  const box = target.getByRole('textbox', { name: 'Reply to #7' });
  await box.fill('Do A');
  await box.press('Enter');
  await expect.poll(() => sent.length).toBe(1);
  await expect(box).not.toBeEditable();
  todos[0] = { ...confirm, phase: 'planning' };
  delivered = true;
  release();
  await expect(target).toHaveCount(0);
  await expect(page.getByTestId('thread-message-marker')).toContainText('You told #7 directly: Do A');
});

async function recordCoordinatorSends(page: Page): Promise<string[]> {
  const posts: string[] = [];
  await page.route(`**/api/conversations/${THREAD.id}/messages*`, (route, request) => {
    if (request.method() === 'POST') posts.push(request.postData() ?? '');
    return route.fulfill({ json: { messages: [] } });
  });
  return posts;
}

const composer = (page: Page) => page.getByTestId('chief-composer-input');

test('the home composer can talk to a running thread directly, and back to the Coordinator', async ({
  page,
}) => {
  const sent = await stubHome(page, [
    todo('todo-9', 9, 'Research the queue design', 'building', 'build-9'),
    todo('todo-3', 3, 'Not started yet', 'queued', null),
  ]);
  const coordinatorPosts = await recordCoordinatorSends(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Talk to a thread' }).click();
  const menu = page.getByRole('menu', { name: 'Talk to a thread' });
  await expect(menu.getByRole('menuitemradio')).toHaveText([
    /Coordinator/,
    /#9 Research the queue design/,
  ]);
  await menu.getByRole('menuitemradio', { name: /#9/ }).click();
  await expect(page.getByRole('button', { name: 'Talking to #9' })).toBeVisible();
  await expect(composer(page)).toHaveAttribute('placeholder', 'Goes straight to #9, into its current turn.');
  await expect(composer(page)).toBeFocused();
  await composer(page).fill('Compare it with a ring buffer');
  await composer(page).press('Enter');
  await expect(composer(page)).toHaveValue('');
  expect(sent).toEqual([
    { todoId: 'todo-9', body: { content: 'Compare it with a ring buffer', clientMessageId: expect.any(String) } },
  ]);
  expect(coordinatorPosts).toEqual([]);
  await expect(page.getByRole('button', { name: 'Talking to #9' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to the Coordinator' }).click();
  await expect(page.getByRole('button', { name: 'Talk to a thread' })).toBeVisible();
  await expect(composer(page)).not.toHaveAttribute('placeholder', /#9/);
});

test('a refused direct message keeps the draft and the target and says it was not sent', async ({ page }) => {
  await stubHome(page, [todo('todo-9', 9, 'Research the queue design', 'building', 'build-9')], 409);
  const coordinatorPosts = await recordCoordinatorSends(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Talk to a thread' }).click();
  await page.getByRole('menuitemradio', { name: /#9/ }).click();
  await composer(page).fill('Keep this text');
  await composer(page).press('Enter');
  await expect(page.getByTestId('chief-composer-error')).toHaveText('Not sent to #9. Try again.');
  await expect(composer(page)).toHaveValue('Keep this text');
  await expect(page.getByRole('button', { name: 'Talking to #9' })).toBeVisible();
  expect(coordinatorPosts).toEqual([]);
});

test('with no thread that can take a message there is no thread target', async ({ page }) => {
  await stubHome(page, [todo('todo-3', 3, 'Not started yet', 'queued', null)]);
  await page.goto('/app');
  await expect(composer(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Talk to a thread' })).toHaveCount(0);
});

test('a target that stops taking messages blocks the send instead of handing it to the Coordinator', async ({
  page,
}) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const building = todo('todo-9', 9, 'Research the queue design', 'building', 'build-9');
  const todos: unknown[] = [building];
  const sent = await stubHome(page, todos, 201, hold);
  const coordinatorPosts = await recordCoordinatorSends(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Talk to a thread' }).click();
  await page.getByRole('menuitemradio', { name: /#9/ }).click();
  await composer(page).fill('First note');
  await composer(page).press('Enter');
  await expect.poll(() => sent.length).toBe(1);
  todos[0] = { ...building, archivedAt: Date.now() };
  release();
  await expect(page.getByTestId('chief-composer-error')).toHaveText(
    '#9 cannot take a message now. Switch back to the Coordinator or pick another thread.',
  );
  await expect(composer(page)).toHaveAttribute('placeholder', /#9 cannot take a message now/);
  await expect(page.getByRole('button', { name: 'Talking to #9' })).toBeVisible();
  await composer(page).fill('Meant for #9');
  await composer(page).press('Enter');
  await expect(composer(page)).toHaveValue('Meant for #9');
  expect(coordinatorPosts).toEqual([]);
  expect(sent).toHaveLength(1);
});

test('a late failure for one thread does not show under another thread', async ({ page }) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent = await stubHome(
    page,
    [
      todo('todo-9', 9, 'Research the queue design', 'building', 'build-9'),
      todo('todo-7', 7, 'Split the routing migration', 'confirm', 'build-7'),
    ],
    409,
    hold,
  );
  await page.goto('/app');
  await page.getByRole('button', { name: 'Talk to a thread' }).click();
  await page.getByRole('menuitemradio', { name: /#9/ }).click();
  await composer(page).fill('For nine');
  await composer(page).press('Enter');
  await expect.poll(() => sent.length).toBe(1);
  await page.getByRole('button', { name: 'Talking to #9' }).click();
  await page.getByRole('menuitemradio', { name: /#7/ }).click();
  await expect(page.getByRole('button', { name: 'Talking to #7' })).toBeVisible();
  const refused = page.waitForResponse((response) => response.url().includes('/api/todos/todo-9/messages'));
  release();
  await refused;
  await expect(composer(page)).toHaveValue('For nine');
  await expect(page.getByTestId('chief-composer-error')).toHaveCount(0);
});
