import { expect, type Page, type Route, test } from '@playwright/test';

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
  let titleAfterReconnect: string | undefined;
  const renameOnReconnect = (title: string) => {
    titleAfterReconnect = title;
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
    if (/^\/api\/streams\/archive-\d+\/conversations$/.test(path) && request.method() === 'PUT') {
      const { conversationIds, revision } = request.postDataJSON() as {
        conversationIds: string[];
        revision: number;
      };
      if (path === '/api/streams/archive-2/conversations' && titleAfterReconnect !== undefined) {
        expect(conversationIds).toContain('build-archive');
        todo = { ...todo, title: titleAfterReconnect, v: todo.v + 1 };
        titleAfterReconnect = undefined;
      }
      return route.fulfill({ json: { revision } });
    }
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
      '/api/remote/pairing-requests': [],
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
      '/api/teams/team-archive/devin-subscriptions': [],
      '/api/teams/team-archive/antigravity-subscriptions': [],
      '/api/capabilities': { thinkingLevels: [] },
    };
    if (request.method() === 'GET' && Object.hasOwn(responses, path))
      return route.fulfill({ json: responses[path] });
    if (request.method() === 'POST' && path === '/api/auth/stream-ticket') {
      return route.fulfill({ json: { ticket: 'archive-ticket', expiresAt: 1 } });
    }
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { error: 'Unexpected archive test request' } });
  });
  return { actions, revisions, unexpected, stopReport, renameOnReconnect };
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
  const { actions, revisions, unexpected, stopReport, renameOnReconnect } = await setup(page);
  const disconnectEvent = 'archive-test-disconnect';
  await page.addInitScript((eventName) => {
    let connections = 0;
    class ArchiveEventSource {
      private readonly lifetime = new AbortController();
      readyState = 1;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: (() => void) | null = null;

      constructor() {
        const connectionId = `archive-${++connections}`;
        queueMicrotask(() => {
          if (this.readyState !== 1) return;
          this.onmessage?.(
            new MessageEvent('message', {
              data: JSON.stringify({ type: 'hello', connectionId, followRevision: true }),
              lastEventId: '1',
            }),
          );
        });
        window.addEventListener(eventName, () => this.onerror?.(), { signal: this.lifetime.signal });
      }

      close() {
        this.readyState = 2;
        this.lifetime.abort();
      }
    }
    Object.defineProperty(window, 'EventSource', { value: ArchiveEventSource });
  }, disconnectEvent);
  await Promise.all([
    page.waitForResponse(
      (response) => response.ok() && response.url().endsWith('/api/streams/archive-1/conversations'),
    ),
    page.goto('/app/todo/todo-archive'),
  ]);
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
  try {
    const unarchiveStarted = page.waitForRequest('**/api/todos/todo-archive/unarchive');
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await unarchiveStarted;
    await expect(page.locator('.side-panel textarea')).toBeVisible();
    const refreshedTitle = 'Archive probe after reconnect';
    renameOnReconnect(refreshedTitle);
    await Promise.all([
      page.waitForResponse(
        (response) => response.ok() && response.request().method() === 'PUT' &&
          response.url().endsWith('/api/streams/archive-2/conversations'),
      ),
      page.evaluate((eventName) => window.dispatchEvent(new Event(eventName)), disconnectEvent),
    ]);
    await expect(page.getByTestId('side-chat-panel')).toHaveAttribute('aria-label', refreshedTitle);
    await expect(page.locator('.side-panel textarea')).toBeVisible();
    await expect(page.locator('[data-testid="side-chat-action"][data-action="unarchive"]')).toHaveCount(0);
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

const unreadList = (route: Route) => route.fulfill({ json: { unreadThreadIds: ['todo-archive'] } });

async function openUnreadTask(
  page: Page,
  answerMarkRead: (route: Route) => Promise<void>,
  { answerUnreadList = unreadList, notifyWhilePending = true } = {},
) {
  await setup(page, 'done');
  const attempts: string[] = [];
  await page.addInitScript(() => {
    class TeamEventSource {
      readyState = 1;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: (() => void) | null = null;
      onopen: (() => void) | null = null;
      heartbeat: ReturnType<typeof setInterval>;

      constructor(url: string) {
        const send = (data: unknown) =>
          this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
        if (url.includes('/teams/'))
          Object.assign(window, { sendTeamEvent: send, dropTeamStream: () => this.onerror?.() });
        queueMicrotask(() => {
          this.onopen?.();
          send({ type: 'hello', connectionId: 'archive-1', followRevision: true });
        });
        this.heartbeat = setInterval(() => send({ type: 'ping' }), 5000);
      }

      close() {
        clearInterval(this.heartbeat);
        this.readyState = 2;
      }
    }
    Object.defineProperty(window, 'EventSource', { value: TeamEventSource });
  });
  await page.route('**/api/teams/team-archive/notifications', answerUnreadList);
  await page.route('**/api/teams/team-archive/notifications/todo-archive/read', async (route) => {
    attempts.push(route.request().method());
    if (!notifyWhilePending) return answerMarkRead(route);
    await page.waitForFunction(() => 'sendTeamEvent' in window);
    await page.evaluate(() => {
      (window as unknown as { sendTeamEvent: (event: unknown) => void }).sendTeamEvent({
        type: 'notification',
        notification: {
          id: 'notice-archive',
          teamId: 'team-archive',
          userId: 'user-archive',
          type: 'build_review',
          entityId: 'todo-archive',
          entityRef: { title: 'Archive probe', projectId: 'project-archive', seqNum: 1 },
          agent: { name: 'Agent', avatarUrl: null },
          snippet: null,
          readAt: null,
          createdAt: 1,
          channels: ['in_app'],
        },
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await answerMarkRead(route);
  });
  await page.goto('/app/todo/todo-archive');
  await expect.poll(() => attempts.length).toBeGreaterThan(0);
  await page.waitForTimeout(3000);
  return attempts;
}

test('a rejected background mark-read says so once and stops asking', async ({ page }) => {
  const attempts = await openUnreadTask(page, (route) =>
    route.fulfill({ status: 500, json: { error: 'Internal Server Error' } }),
  );
  expect(attempts).toHaveLength(1);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
});

test('a background mark-read that cannot reach the server stays quiet and gives up', async ({
  page,
}) => {
  const attempts = await openUnreadTask(page, (route) => route.abort('connectionrefused'));
  expect(attempts).toHaveLength(3);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
});

function waitForMarkedRead(page: Page) {
  return page.waitForResponse(
    (response) => response.url().endsWith('/notifications/todo-archive/read') && response.ok(),
  );
}

const returns = {
  'the user comes back to the window': async (page: Page) => {
    for (const state of ['hidden', 'visible']) {
      await page.evaluate((visibility) => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => visibility,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      }, state);
      await page.waitForTimeout(200);
    }
  },
  'the live connection comes back': (page: Page) =>
    page.evaluate(() => (window as unknown as { dropTeamStream: () => void }).dropTeamStream()),
};

test('a mark-read that failed along with the unread list is sent again when the user comes back', async ({
  page,
}) => {
  let healthy = false;
  let marking = false;
  page.on('request', (request) => {
    if (request.url().endsWith('/notifications/todo-archive/read')) marking = true;
  });
  await openUnreadTask(
    page,
    (route) => (healthy ? route.fulfill({ json: {} }) : route.abort('connectionrefused')),
    {
      answerUnreadList: (route) =>
        marking && !healthy ? route.abort('connectionrefused') : unreadList(route),
      notifyWhilePending: false,
    },
  );

  healthy = true;
  const marked = waitForMarkedRead(page);
  await returns['the user comes back to the window'](page);
  await marked;
});

for (const [moment, comeBack] of Object.entries(returns)) {
  test(`a mark-read that gave up is sent again when ${moment}`, async ({ page }) => {
    let healthy = false;
    const attempts = await openUnreadTask(page, (route) =>
      healthy
        ? route.fulfill({ json: {} })
        : route.fulfill({ status: 500, json: { error: 'Internal Server Error' } }),
    );
    expect(attempts).toHaveLength(1);

    await comeBack(page);
    await page.waitForTimeout(3000);
    expect(attempts).toHaveLength(2);

    healthy = true;
    const marked = waitForMarkedRead(page);
    await comeBack(page);
    await marked;
  });

  test(`a refusal that was still pending when ${moment} does not cancel the retry`, async ({
    page,
  }) => {
    let replies = 0;
    const marked = waitForMarkedRead(page);
    await openUnreadTask(page, async (route) => {
      replies += 1;
      if (replies > 1) return route.fulfill({ json: {} });
      await comeBack(page);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
    });
    await marked;
  });
}

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
