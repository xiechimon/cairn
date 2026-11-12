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
  await page.locator('[data-testid="composer-plus"]:visible').click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitemradio')).toHaveText([
    /Coordinator/,
    /^Research the queue design/,
  ]);
  await menu.getByRole('menuitemradio', { name: /Research the queue design/ }).click();
  await expect(page.getByRole('button', { name: 'Talking to “Research the queue design”' })).toBeVisible();
  await expect(composer(page)).toHaveAttribute('placeholder', 'Goes straight to this task, into its current turn.');
  await expect(composer(page)).toBeFocused();
  await composer(page).fill('Compare it with a ring buffer');
  await composer(page).press('Enter');
  await expect(composer(page)).toHaveValue('');
  expect(sent).toEqual([
    { todoId: 'todo-9', body: { content: 'Compare it with a ring buffer', clientMessageId: expect.any(String) } },
  ]);
  expect(coordinatorPosts).toEqual([]);
  await expect(page.getByRole('button', { name: 'Talking to “Research the queue design”' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to the Coordinator' }).click();
  await expect(page.getByTestId('composer-thread-target')).toHaveCount(0);
  await expect(composer(page)).not.toHaveAttribute('placeholder', /this task/);
});

test('a refused direct message keeps the draft and the target and says it was not sent', async ({ page }) => {
  await stubHome(page, [todo('todo-9', 9, 'Research the queue design', 'building', 'build-9')], 409);
  const coordinatorPosts = await recordCoordinatorSends(page);
  await page.goto('/app');
  await page.locator('[data-testid="composer-plus"]:visible').click();
  await page.getByRole('menuitemradio', { name: /Research the queue design/ }).click();
  await composer(page).fill('Keep this text');
  await composer(page).press('Enter');
  await expect(page.getByTestId('chief-composer-error')).toHaveText('Not sent to “Research the queue design”. Try again.');
  await expect(composer(page)).toHaveValue('Keep this text');
  await expect(page.getByRole('button', { name: 'Talking to “Research the queue design”' })).toBeVisible();
  expect(coordinatorPosts).toEqual([]);
});

test('with no thread that can take a message there is no thread target', async ({ page }) => {
  await stubHome(page, [todo('todo-3', 3, 'Not started yet', 'queued', null)]);
  await page.goto('/app');
  await expect(composer(page)).toBeVisible();
  await page.locator('[data-testid="composer-plus"]:visible').click();
  await expect(page.getByRole('menuitemradio')).toHaveCount(0);
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
  await page.locator('[data-testid="composer-plus"]:visible').click();
  await page.getByRole('menuitemradio', { name: /Research the queue design/ }).click();
  await composer(page).fill('First note');
  await composer(page).press('Enter');
  await expect.poll(() => sent.length).toBe(1);
  todos[0] = { ...building, archivedAt: Date.now() };
  release();
  await expect(page.getByTestId('chief-composer-error')).toHaveText(
    '“Research the queue design” cannot take a message now. Switch back to the Coordinator or pick another thread.',
  );
  await expect(composer(page)).toHaveAttribute('placeholder', /cannot take a message now/);
  await expect(page.getByRole('button', { name: 'Talking to “Research the queue design”' })).toBeVisible();
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
  await page.locator('[data-testid="composer-plus"]:visible').click();
  await page.getByRole('menuitemradio', { name: /Research the queue design/ }).click();
  await composer(page).fill('For nine');
  await composer(page).press('Enter');
  await expect.poll(() => sent.length).toBe(1);
  await page.getByRole('button', { name: 'Talking to “Research the queue design”' }).click();
  await page.getByRole('menuitemradio', { name: /Split the routing migration/ }).click();
  await expect(page.getByRole('button', { name: 'Talking to “Split the routing migration”' })).toBeVisible();
  const refused = page.waitForResponse((response) => response.url().includes('/api/todos/todo-9/messages'));
  release();
  await refused;
  await expect(composer(page)).toHaveValue('For nine');
  await expect(page.getByTestId('chief-composer-error')).toHaveCount(0);
});
