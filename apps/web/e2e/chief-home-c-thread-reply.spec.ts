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

const card = (page: Page, title: string) =>
  page.getByTestId('needs-you').locator('[data-slot="thread-card"]').filter({ hasText: title });

test('a needs-you card replies straight to its thread and says where it went', async ({ page }) => {
  const sent = await stubHome(page, [todo('todo-7', 7, 'Split the routing migration', 'confirm', 'build-1')]);
  await page.goto('/app');
  const target = card(page, 'Split the routing migration');
  await expect(target.locator('[data-slot="thread-reply"]')).toHaveCount(0);
  await target.getByRole('button', { name: 'Reply', exact: true }).click();
  const box = target.getByRole('textbox', { name: 'Reply to #7' });
  await expect(box).toBeFocused();
  await expect(target).toContainText('Plan feedback for #7, not an approval.');
  await box.fill('Split the migration out first');
  await box.press('Enter');
  await expect(target).toContainText('Sent to #7.');
  await expect(box).toHaveValue('');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    todoId: 'todo-7',
    body: { content: 'Split the migration out first', clientMessageId: expect.any(String) },
  });
});

test('a refused reply keeps the draft and says it was not sent', async ({ page }) => {
  await stubHome(page, [todo('todo-7', 7, 'Split the routing migration', 'confirm', 'build-1')], 409);
  await page.goto('/app');
  const target = card(page, 'Split the routing migration');
  await target.getByRole('button', { name: 'Reply', exact: true }).click();
  const box = target.getByRole('textbox', { name: 'Reply to #7' });
  await box.fill('Keep this text');
  await box.press('Enter');
  await expect(target).toContainText('Not sent. Try again.');
  await expect(box).toHaveValue('Keep this text');
});

test('a failed thread offers a reply that reruns it; an empty reply cannot be sent', async ({ page }) => {
  const sent = await stubHome(page, [todo('todo-12', 12, 'Fix the orb permission', 'failed', 'build-12')]);
  await page.goto('/app');
  const target = card(page, 'Fix the orb permission');
  await target.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(target).toContainText('Reruns #12 with this note.');
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
  const target = card(page, 'Split the routing migration');
  await target.getByRole('button', { name: 'Reply', exact: true }).click();
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
