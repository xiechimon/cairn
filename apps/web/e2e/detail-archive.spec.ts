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
    if (path === '/api/builds/build-archive/steps' && request.method() === 'POST') {
      revisions.push(request.postDataJSON());
      return route.fulfill({ status: 202, json: { delegated: true } });
    }
    if (path.endsWith('/stream'))
      return route.fulfill({ contentType: 'text/event-stream', body: '' });
    const responses: Record<string, unknown> = {
      '/api/user/me': { id: 'user-archive', displayName: 'Owner', avatarUrl: null },
      '/api/teams': [
        { id: 'team-archive', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null },
      ],
      '/api/projects': [{ id: 'project-archive', teamId: 'team-archive', name: 'Archive project' }],
      '/api/todos': todo.archivedAt === null ? [todo] : [],
      '/api/todos/todo-archive': todo,
      '/api/needs-you': { current: [], stale: [] },
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
      '/api/teams/team-archive/chief/threads': [],
      '/api/teams/team-archive/chief': {
        chief: { id: 'chief-archive', teamId: 'team-archive', agent: null },
        agentActor: null,
      },
      '/api/teams/team-archive/notifications': { unreadThreadIds: [] },
      '/api/teams/team-archive/model-sources': { sources: [] },
      '/api/teams/team-archive/providers': { presets: [], providers: [] },
      '/api/server/backup': { status: 'healthy' },
      '/api/capabilities': { thinkingLevels: [] },
    };
    if (request.method() === 'GET' && Object.hasOwn(responses, path))
      return route.fulfill({ json: responses[path] });
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { error: 'Unexpected archive test request' } });
  });
  return { actions, revisions, unexpected, stopReport };
}

async function continueFromComposer(page: Page, revisions: unknown[]) {
  await expect(page.getByTestId('phase-chip')).toHaveText('确认');
  await expect(page.getByTestId('phase-chip')).toHaveAttribute('data-tone', 'confirm');
  await page
    .getByTestId('composer-card')
    .getByRole('textbox')
    .fill('Continue with the retained work');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect
    .poll(() => revisions)
    .toEqual([
      expect.objectContaining({ action: 'revision', feedback: 'Continue with the retained work' }),
    ]);
}

async function archive(page: Page) {
  await page.getByTestId('detail-head').getByRole('button', { name: '更多', exact: true }).click();
  await page.getByTestId('archive-task').click();
  await expect(page.getByTestId('archived-badge')).toBeVisible();
}

test('archived page replaces the composer; unarchive restores it without changing phase', async ({
  page,
}) => {
  const { actions, revisions, unexpected } = await setup(page, 'confirm', 123);
  await page.goto('/app/todo/todo-archive');
  await expect(page.getByTestId('archived-badge')).toBeVisible();
  await expect(page.getByTestId('composer-card')).toHaveCount(0);
  await expect(page.getByTestId('detail-head').locator('.detail-head-action')).toHaveCount(0);
  await expect(page.getByTestId('unarchive-task')).toHaveText('Unarchive to continue');
  await page.getByTestId('unarchive-task').click();
  await expect(page.getByTestId('composer-card')).toBeVisible();
  await expect(page.getByTestId('archived-badge')).toHaveCount(0);
  await continueFromComposer(page, revisions);
  await expect.poll(() => actions).toEqual(['/api/todos/todo-archive/unarchive']);
  expect(unexpected).toEqual([]);
});

test('archive toast Undo restores the composer immediately and updates sidebar counts', async ({
  page,
}) => {
  const { actions, revisions, unexpected, stopReport } = await setup(page);
  await page.goto('/app/todo/todo-archive');
  await expect(page.getByTestId('composer-card')).toBeVisible();
  await expect(page.getByTestId('project-count')).toHaveText('1');
  await archive(page);
  await expect(page.getByTestId('composer-card')).toHaveCount(0);
  await expect(page.getByTestId('project-count')).toHaveCount(0);
  let releaseUnarchive = () => {};
  const unarchiveAllowed = new Promise<void>((resolve) => {
    releaseUnarchive = resolve;
  });
  await page.route('**/api/todos/todo-archive/unarchive', async (route) => {
    await unarchiveAllowed;
    await route.fallback();
  });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  try {
    await expect(page.getByTestId('composer-card')).toBeVisible();
  } finally {
    releaseUnarchive();
  }
  await expect(page.getByTestId('archived-badge')).toHaveCount(0);
  await expect(page.getByTestId('project-count')).toHaveText('1');
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
  await expect(page.getByTestId('phase-chip')).toContainText('已完成');
  await page.getByTestId('unarchive-task').click();
  await expect(page.getByTestId('archived-badge')).toHaveCount(0);
  await expect(page.getByTestId('phase-chip')).toContainText('已完成');
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
  await expect(page.getByTestId('archived-badge')).toBeVisible();
  await page.getByTestId('unarchive-task').click();
  await continueFromComposer(page, revisions);
  expect(unexpected).toEqual([]);
});
