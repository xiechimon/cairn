import { expect, type Page, test } from '@playwright/test';

async function setup(page: Page, phase = 'building', archivedAt: number | null = null) {
  let todo = {
    id: 'todo-archive',
    teamId: 'team-archive',
    projectId: 'project-archive',
    title: 'Archive probe',
    spec: '',
    phase,
    phaseAt: 1,
    archivedAt,
    seqNum: 1,
    orderIndex: 0,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: 'build-archive',
    lastRunAt: null,
    hasChanges: false,
    hasPlan: true,
    buildHistory: [{ buildId: 'build-archive', createdAt: 1 }],
    sourceTodo: null,
    createdBy: null,
    ownerId: null,
    sourceBuildId: null,
    sourceKind: null,
    sourceRef: null,
    output: 'code',
    v: 1,
  };
  const actions: string[] = [];
  const revisions: unknown[] = [];
  const unexpected: string[] = [];
  let stopped = phase !== 'building';
  const build = {
    id: 'build-archive',
    todoId: todo.id,
    withPlan: true,
    prevPhase: 'todo',
    triggerSource: 'user',
    planDocId: 'plan-archive',
    errorMessage: null,
    prUrl: null,
    prNumber: null,
    diffHash: null,
    reportAttachmentId: null,
    createdAt: 1,
  };
  const stopReport = () => {
    stopped = true;
    todo = { ...todo, phase: 'confirm', phaseAt: Date.now(), v: todo.v + 1 };
  };
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (
      path === '/api/teams/team-archive/presence' &&
      (request.method() === 'POST' || request.method() === 'DELETE')
    )
      return route.fulfill({ json: { ok: true } });
    if (path.endsWith('/archive') || path.endsWith('/unarchive')) {
      actions.push(path);
      todo = {
        ...todo,
        archivedAt: path.endsWith('/unarchive') ? null : Date.now(),
        v: todo.v + 1,
      };
      return route.fulfill({ json: todo });
    }
    if (path === '/api/todos/todo-archive/messages' && request.method() === 'POST') {
      const { content } = request.postDataJSON() as { content: string };
      revisions.push({ action: 'revision', feedback: content });
      return route.fulfill({
        status: 201,
        json: { todoId: 'todo-archive', conversationId: 'build-archive', delivered: 'revision' },
      });
    }
    if (path === '/api/builds/build-archive/steps' && request.method() === 'POST') {
      revisions.push(request.postDataJSON());
      return route.fulfill({ status: 202, json: { delegated: true } });
    }
    if (path.endsWith('/stream'))
      return route.fulfill({ contentType: 'text/event-stream', body: '' });
    if (path.startsWith('/api/teams/team-archive/drafts/'))
      return route.fulfill({ json: { content: '', updatedAt: null } });
    const responses: Record<string, unknown> = {
      '/api/user/me': { id: 'user-archive', displayName: 'Owner', avatarUrl: null },
      '/api/teams': [
        { id: 'team-archive', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null },
      ],
      '/api/projects': [{ id: 'project-archive', teamId: 'team-archive', name: 'Archive project' }],
      '/api/todos': todo.archivedAt === null ? [todo] : [],
      '/api/todos/todo-archive': todo,
      '/api/needs-you': { current: [], stale: [] },
      '/api/prs': [],
      '/api/tasks': { entries: [] },
      '/api/builds/build-archive': build,
      '/api/builds/build-archive/gate': { state: null },
      '/api/builds/build-archive/steps': [
        {
          id: 'plan-step',
          buildId: build.id,
          kind: 'plan',
          status: 'done',
          createdAt: 1,
          machineId: null,
          checkpointCommit: null,
          skillInjection: null,
        },
        {
          id: 'build-step',
          buildId: build.id,
          kind: 'build',
          status: stopped ? 'stopped' : 'claimed',
          createdAt: 2,
          machineId: null,
          checkpointCommit: null,
          skillInjection: null,
        },
      ],
      '/api/builds/build-archive/plans': [
        {
          id: 'plan-archive',
          buildId: build.id,
          version: 1,
          content: '# Plan',
          stepId: 'plan-step',
          createdAt: 1,
        },
      ],
      '/api/builds/build-archive/usage': [],
      '/api/builds/build-archive/changes': { files: [], reported: true },
      '/api/conversations/build-archive/messages': { messages: [] },
      '/api/projects/project-archive/builds': [build],
      '/api/projects/project-archive/files': {
        files: [],
        truncated: false,
        ref: 'main',
        commit: 'a'.repeat(40),
      },
      '/api/projects/project-archive/tags': [],
      '/api/skills': [],
      '/api/teams/team-archive/members': [],
      '/api/teams/team-archive/machines': [],
      '/api/teams/team-archive/routing-settings': { enabled: false, rules: [], policies: [] },
      '/api/teams/team-archive/chief/threads': [],
      '/api/teams/team-archive/chief': {
        chief: { id: 'chief-archive', teamId: 'team-archive', agent: null },
        agentActor: null,
      },
      '/api/teams/team-archive/notifications': { unreadThreadIds: [] },
      '/api/teams/team-archive/model-sources': { sources: [] },
      '/api/teams/team-archive/providers': { presets: [], providers: [] },
      '/api/teams/team-archive/model-routing': { edges: [], connections: [], quota: [] },
      '/api/server/backup': { status: 'healthy' },
      '/api/schedules': [],
      '/api/teams/team-archive/claude-subscriptions': [],
      '/api/capabilities': { thinkingLevels: [] },
    };
    if (request.method() === 'GET' && Object.hasOwn(responses, path))
      return route.fulfill({ json: responses[path] });
    if (
      request.method() === 'POST' &&
      (path === '/api/auth/bootstrap' || path === '/api/auth/stream-ticket')
    ) {
      return route.fulfill({
        json: path.endsWith('bootstrap') ? { ok: true } : { ticket: 'archive-ticket', expiresAt: 1 },
      });
    }
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { error: 'Unexpected archive test request' } });
  });
  return { actions, revisions, unexpected, stopReport };
}

async function continueFromComposer(page: Page, revisions: unknown[]) {
  await expect(page.getByTestId('side-chat-status')).toContainText('待你决定');
  await page
    .getByTestId('composer-card')
    .getByRole('textbox')
    .fill('Continue with the retained work');
  await page.locator('.side-panel').getByRole('button', { name: '发送', exact: true }).click();
  await expect
    .poll(() => revisions)
    .toEqual([
      expect.objectContaining({ action: 'revision', feedback: 'Continue with the retained work' }),
    ]);
}

async function archive(page: Page) {
  await page.getByTestId('side-chat').getByRole('button', { name: '更多操作…' }).click();
  await page.getByTestId('archive-task').click();
  await expect(page.locator('[data-testid="side-chat-action"][data-action="unarchive"]')).toBeVisible();
}

test('an archived thread locks the composer; unarchive restores it without changing phase', async ({
  page,
}) => {
  const { actions, revisions, unexpected } = await setup(page, 'confirm', 123);
  await page.goto('/app/todo/todo-archive');
  const bar = page.locator('[data-testid="side-chat-action"][data-action="unarchive"]');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('这个任务已归档。取消归档后才能发消息。');
  await expect(page.locator('.side-panel').getByTestId('composer-card')).toHaveCount(0);
  await expect(page.locator('.side-panel textarea')).toHaveCount(0);
  await page.locator('[data-testid="side-chat-action"][data-action="unarchive"]').getByRole('button', { name: '取消归档' }).click();
  await expect(page.locator('.side-panel textarea')).toBeVisible();
  await expect(page.locator('[data-testid="side-chat-action"][data-action="unarchive"]')).toHaveCount(0);
  await continueFromComposer(page, revisions);
  await expect.poll(() => actions).toEqual(['/api/todos/todo-archive/unarchive']);
  expect(unexpected).toEqual([]);
});

test('archive toast Undo restores the composer immediately', async ({
  page,
}) => {
  const { actions, revisions, unexpected, stopReport } = await setup(page);
  await page.goto('/app/todo/todo-archive');
  await expect(page.locator('.side-panel textarea')).toBeVisible();
  await archive(page);
  await expect(page.locator('.side-panel textarea')).toHaveCount(0);
  let releaseUnarchive = () => {};
  const unarchiveAllowed = new Promise<void>((resolve) => {
    releaseUnarchive = resolve;
  });
  await page.route('**/api/todos/todo-archive/unarchive', async (route) => {
    await unarchiveAllowed;
    await route.fallback();
  });
  await expect(page.getByText('已归档「Archive probe」')).toBeVisible();
  const toaster = page.locator('[data-sonner-toaster]');
  await expect(toaster).toHaveAttribute('data-y-position', 'bottom');
  await expect(toaster).toHaveAttribute('data-x-position', 'right');
  const toast = page.locator('[data-sonner-toast]').first();
  await expect(toast).toHaveAttribute('data-mounted', 'true');
  const panelBox = await page.locator('.side-panel').boundingBox();
  const barBox = await page.getByTestId('side-chat-action').boundingBox();
  await expect
    .poll(async () => {
      const box = await toast.boundingBox();
      return (box?.x ?? 0) >= (panelBox?.x ?? Number.POSITIVE_INFINITY) && (box?.y ?? 0) + (box?.height ?? 0) <= (barBox?.y ?? 0);
    })
    .toBe(true);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  try {
    await expect(page.locator('.side-panel textarea')).toBeVisible();
  } finally {
    releaseUnarchive();
  }
  await expect(page.locator('[data-testid="side-chat-action"][data-action="unarchive"]')).toHaveCount(0);
  await expect
    .poll(() => actions)
    .toEqual(['/api/todos/todo-archive/archive', '/api/todos/todo-archive/unarchive']);
  stopReport();
  await page.reload();
  await continueFromComposer(page, revisions);
  expect(unexpected).toEqual([]);
});

test('done tasks offer archive while retaining their done phase', async ({ page }) => {
  const { unexpected } = await setup(page, 'done');
  await page.goto('/app/todo/todo-archive');
  await archive(page);
  await expect(page.getByTestId('side-chat-status')).toContainText('已完成');
  await page.locator('[data-testid="side-chat-action"][data-action="unarchive"]').getByRole('button', { name: '取消归档' }).click();
  await expect(page.locator('[data-testid="side-chat-action"][data-action="unarchive"]')).toHaveCount(0);
  await expect(page.getByTestId('side-chat-status')).toContainText('已完成');
  expect(unexpected).toEqual([]);
});

test('a build stopped while archived returns to an actionable composer after unarchive', async ({
  page,
}) => {
  const { revisions, unexpected, stopReport } = await setup(page);
  await page.goto('/app/todo/todo-archive');
  await archive(page);
  stopReport();
  await page.reload();
  await expect(page.locator('[data-testid="side-chat-action"][data-action="unarchive"]')).toBeVisible();
  await page.locator('[data-testid="side-chat-action"][data-action="unarchive"]').getByRole('button', { name: '取消归档' }).click();
  await continueFromComposer(page, revisions);
  expect(unexpected).toEqual([]);
});
