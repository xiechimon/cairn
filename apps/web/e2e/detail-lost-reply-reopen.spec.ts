import { chiefGetResponseSchema } from '@cairn/shared';
import { expect, type Page, test } from '@playwright/test';
import { installConversationStreams } from './tab-stream-fakes.js';

interface TaskFixture {
  id: string;
  buildId: string;
  phase: 'done' | 'building';
  messages: {
    id: string;
    role: 'system' | 'user' | 'assistant';
    content: unknown;
    createdAt: number;
    origin?: 'user' | 'task-prompt' | 'synthetic' | null;
    clientMessageId?: string | null;
  }[];
  earlierMessages?: {
    id: string;
    role: 'system' | 'user' | 'assistant';
    content: unknown;
    createdAt: number;
    origin?: 'user' | 'task-prompt' | 'synthetic' | null;
    clientMessageId?: string | null;
  }[];
  steps: {
    id: string;
    buildId: string;
    kind: string;
    machineId: string | null;
    createdAt: number;
    status: string;
    checkpointCommit: string | null;
    skillInjection: unknown;
  }[];
}

async function setupTaskApp(page: Page, fixtures: Record<string, TaskFixture>) {
  const chief = chiefGetResponseSchema.parse({
    chief: {
      id: 'chief-user-1-team-1',
      userId: 'user-1',
      teamId: 'team-1',
      agent: null,
      lastTurnAt: null,
      createdAt: 0,
      tz: null,
    },
    agentActor: null,
    context: null,
    watches: [],
    wakes: [],
  });
  const tasks = Object.values(fixtures).map((f, index) => ({
    id: f.id,
    teamId: 'team-1',
    projectId: 'project-1',
    title: `Task ${index + 1}`,
    spec: '',
    phase: f.phase,
    phaseAt: 1,
    seqNum: index + 1,
    orderIndex: index,
    assignment: null,
    agent: null,
    latestBuildId: f.buildId,
    lastRunAt: 1,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [],
    sourceTodo: null,
    v: 1,
  }));
  const findByBuild = (buildId: string) =>
    Object.values(fixtures).find((item) => item.buildId === buildId);

  await page.addInitScript(() => {
    const streams: FakeEventSource[] = [];
    class FakeEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly url: string;
      readyState = 1;
      onmessage: ((event: { data: string }) => void) | null = null;
      constructor(url: string) {
        super();
        this.url = url;
        streams.push(this);
      }
      close() {
        this.readyState = 2;
      }
    }
    Object.defineProperty(window, '__streams', { value: streams });
    Object.defineProperty(window, 'EventSource', { value: FakeEventSource });
  });
  await page.addInitScript(installConversationStreams, '__streams');

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/teams') return route.fulfill({ json: [{ id: 'team-1', name: 'Team' }] });
    if (path === '/api/user/me')
      return route.fulfill({ json: { id: 'user-1', displayName: 'Owner', avatarUrl: null } });
    if (path === '/api/teams/team-1/chief') return route.fulfill({ json: chief });
    if (path === '/api/teams/team-1/notifications')
      return route.fulfill({ json: { unreadThreadIds: [] } });
    if (path === '/api/projects')
      return route.fulfill({
        json: [{ id: 'project-1', teamId: 'team-1', name: 'cairn', repoKind: 'hosted' }],
      });
    if (path === '/api/todos') return route.fulfill({ json: tasks });
    if (path.startsWith('/api/todos/')) {
      const id = path.slice('/api/todos/'.length);
      const task = tasks.find((item) => item.id === id);
      if (task) return route.fulfill({ json: task });
    }
    const buildMatch = /^\/api\/builds\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (buildMatch) {
      const buildId = buildMatch[1] ?? '';
      const sub = buildMatch[2] ?? '';
      const fixture = findByBuild(buildId);
      if (fixture) {
        if (sub === '') {
          return route.fulfill({
            json: {
              id: fixture.buildId,
              todoId: fixture.id,
              withPlan: false,
              prevPhase: null,
              triggerSource: 'user',
              planDocId: null,
              errorMessage: null,
              prUrl: null,
              prNumber: null,
              diffHash: null,
              createdAt: 1,
            },
          });
        }
        if (sub === 'gate') return route.fulfill({ json: { state: null } });
        if (sub === 'changes') return route.fulfill({ json: { files: [] } });
        if (sub === 'steps') return route.fulfill({ json: fixture.steps });
        if (sub === 'plans' || sub === 'usage') return route.fulfill({ json: [] });
      }
    }
    const convMatch = /^\/api\/conversations\/([^/]+)\/messages$/.exec(path);
    if (convMatch) {
      const buildId = convMatch[1] ?? '';
      const fixture = findByBuild(buildId);
      if (fixture) {
        if (request.method() === 'POST') {
          return new Promise<void>(() => {});
        }
        const before = url.searchParams.get('before');
        if (before !== null && fixture.earlierMessages !== undefined) {
          return route.fulfill({
            json: {
              messages: fixture.earlierMessages,
              chips: null,
              historyEpoch: 0,
              steerPending: [],
              queuedMessages: [],
              activeRun: null,
              nextCursor: null,
            },
          });
        }
        return route.fulfill({
          json: {
            messages: fixture.messages,
            chips: null,
            historyEpoch: 0,
            steerPending: [],
            queuedMessages: [],
            activeRun: null,
            nextCursor:
              fixture.earlierMessages !== undefined && fixture.earlierMessages.length > 0
                ? (fixture.messages[0]?.id ?? null)
                : null,
          },
        });
      }
    }
    if (
      request.method() === 'GET' &&
      [
        '/api/teams/team-1/chief/threads',
        '/api/teams/team-1/members',
        '/api/teams/team-1/machines',
        '/api/teams/team-1/skills',
        '/api/projects/project-1/builds',
        '/api/projects/project-1/tags',
      ].includes(path)
    ) {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ status: 404, json: { error: 'unmocked' } });
  });
}

test('reopening a task retires matching saved outbox copy and anchors on the follow-up bubble instead of jumping to top', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const priorReplies = Array.from({ length: 18 }, (_, idx) => ({
    id: `m-prior-${idx}`,
    role: 'assistant' as const,
    content: `Detailed prior implementation summary paragraph ${idx + 1}. `.repeat(6),
    createdAt: 100 + idx,
  }));
  await setupTaskApp(page, {
    'task-reopen': {
      id: 'task-reopen',
      buildId: 'build-reopen',
      phase: 'done',
      steps: [
        {
          id: 'step-reopen',
          buildId: 'build-reopen',
          kind: 'build',
          machineId: null,
          createdAt: 1,
          status: 'done',
          checkpointCommit: null,
          skillInjection: null,
        },
      ],
      messages: [
        ...priorReplies,
        {
          id: 'm-followup',
          role: 'user',
          content: 'Follow-up request confirmed on server',
          origin: 'user',
          clientMessageId: 'cm-followup-saved',
          createdAt: 1000,
        },
        {
          id: 'm-after',
          role: 'assistant',
          content: 'Completed the follow-up cleanly.',
          createdAt: 1001,
        },
      ],
    },
  });

  await page.goto('/app');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('cairn-task-outbox', 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('entries')) {
            req.result.createObjectStore('entries', { keyPath: 'key' });
          }
        };
        req.onsuccess = () => {
          const tx = req.result.transaction('entries', 'readwrite');
          tx.objectStore('entries').put({
            key: 'cm-followup-saved',
            scope: 'user-1/team-1',
            owner: 'closed-tab',
            threadId: 'build-reopen',
            projectId: null,
            text: 'Follow-up request confirmed on server',
            task: { todoId: 'task-reopen', mode: 'reply' },
            failure: 'error',
            state: 'failed',
            createdAt: Date.now(),
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );

  await page.goto('/app/todo/task-reopen');
  const col = page.getByTestId('transcript-col');
  const bubbles = col.getByTestId('user-bubble');
  await expect(bubbles).toHaveCount(1);
  await expect(bubbles.first()).toContainText('Follow-up request confirmed on server');
  await expect(page.getByTestId('side-chat-send-error')).toHaveCount(0);
  await expect(page.getByTestId('side-chat-unsent-text')).toHaveCount(0);

  await expect.poll(() => col.evaluate((el) => el.scrollTop)).toBeGreaterThan(500);
  await expect(bubbles.first()).toBeInViewport();
});

test('reopening a task whose only user request sits at the start opens at top, and pending/earlier reads never yank scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const filler = Array.from({ length: 16 }, (_, idx) => ({
    id: `m-fill-${idx}`,
    role: 'assistant' as const,
    content: `Tail summary section ${idx + 1}. `.repeat(6),
    createdAt: 200 + idx,
  }));
  await setupTaskApp(page, {
    'task-start': {
      id: 'task-start',
      buildId: 'build-start',
      phase: 'done',
      steps: [
        {
          id: 'step-start',
          buildId: 'build-start',
          kind: 'build',
          machineId: null,
          createdAt: 1,
          status: 'done',
          checkpointCommit: null,
          skillInjection: null,
        },
      ],
      messages: [
        {
          id: 'm-start-user',
          role: 'user',
          content: 'Initial request at top',
          origin: 'user',
          clientMessageId: 'cm-start-1',
          createdAt: 10,
        },
        ...filler,
      ],
    },
    'task-paged': {
      id: 'task-paged',
      buildId: 'build-paged',
      phase: 'done',
      steps: [
        {
          id: 'step-paged',
          buildId: 'build-paged',
          kind: 'build',
          machineId: null,
          createdAt: 1,
          status: 'done',
          checkpointCommit: null,
          skillInjection: null,
        },
      ],
      earlierMessages: [
        {
          id: 'm-earlier-1',
          role: 'assistant',
          content: 'Earlier page chunk',
          createdAt: 50,
        },
      ],
      messages: [
        ...filler,
        {
          id: 'm-paged-user',
          role: 'user',
          content: 'Only user message in latest page',
          origin: 'user',
          createdAt: 500,
        },
      ],
    },
    'task-multi': {
      id: 'task-multi',
      buildId: 'build-multi',
      phase: 'done',
      steps: [
        {
          id: 'step-multi',
          buildId: 'build-multi',
          kind: 'build',
          machineId: null,
          createdAt: 1,
          status: 'done',
          checkpointCommit: null,
          skillInjection: null,
        },
      ],
      messages: [
        {
          id: 'm-multi-initial',
          role: 'user',
          content: 'Initial request at top',
          origin: 'user',
          createdAt: 10,
        },
        ...filler,
        {
          id: 'm-multi-followup',
          role: 'user',
          content: 'Follow-up turn at bottom',
          origin: 'user',
          createdAt: 500,
        },
        {
          id: 'm-multi-reply',
          role: 'assistant',
          content: 'Follow-up turn handled.',
          createdAt: 510,
        },
      ],
    },
  });

  await page.goto('/app/todo/task-start');
  const col = page.getByTestId('transcript-col');
  await expect(col.getByTestId('user-bubble')).toHaveCount(1);
  await expect.poll(() => col.evaluate((el) => el.scrollTop)).toBe(0);

  await page.goto('/app/todo/task-multi');
  await expect(col.getByTestId('user-bubble')).toHaveCount(2);
  await expect.poll(() => col.evaluate((el) => el.scrollTop)).toBeGreaterThan(400);
  await expect(col.getByTestId('user-bubble').last()).toBeInViewport();

  await page.goto('/app/todo/task-paged');
  await expect(col.getByTestId('user-bubble')).toHaveCount(1);
  await expect.poll(() => col.evaluate((el) => el.scrollTop)).toBeGreaterThan(400);
  await col.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(col).toContainText('Earlier page chunk');
  const maxScroll = await col.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(await col.evaluate((el) => el.scrollTop)).toBeLessThan(maxScroll - 200);

  await col.evaluate((el) => {
    el.scrollTop = 420;
  });
  const beforeScroll = await col.evaluate((el) => el.scrollTop);
  const input = page.getByTestId('composer-card').getByRole('textbox');
  await input.fill('Pending send while scrolled');
  await input.press('Enter');
  await expect
    .poll(() => col.evaluate((el, prev) => Math.abs(el.scrollTop - prev), beforeScroll))
    .toBeLessThanOrEqual(40);
});
