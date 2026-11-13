import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';

const TEAM = { id: 't1', name: '团队' };
const USER = { id: 'u1', displayName: 'ian', avatarUrl: null };
const AGENT = {
  id: 'agent-1',
  displayName: 'r5-scribe',
  description: null,
  status: 'active',
  avatarUrl: null,
  provider: 'r3-gw',
  modelId: 'claude-sonnet-5',
  thinkingLevel: null,
  tools: [],
  secrets: [],
  defaultSkill: null,
  skillsAllowlist: null,
  mcpServers: [],
};
const THREAD = {
  id: 'chief-home',
  chiefId: 'chief-u1-t1',
  userId: 'u1',
  teamId: 't1',
  title: '统一按钮颜色',
  createdAt: 2,
  updatedAt: 2,
  lastTurnAt: null,
  session: { runtime: 'pi', id: 's2', openedAt: 2 },
  pendingSessionResumeAt: null,
  toolDefHashes: {},
  toolResultHashes: {},
  activeRun: null,
};
const project = (id: string, name: string, description: string) => ({
  id,
  name,
  description,
  teamId: 't1',
  repoKind: 'hosted',
  repoName: name,
});
const PROJECTS = [
  project('proj-1', 'cairn', 'Cairn 本体：服务端、网页、daemon'),
  project('proj-2', 'cairn-site', '官网 cairn.xmon.me'),
  project('proj-3', 'radar-digest', '每日信息雷达摘要'),
];
const todo = (over: Record<string, unknown>) => ({
  teamId: 't1',
  spec: '',
  phaseAt: Date.now(),
  orderIndex: 0,
  tagIds: [],
  assignment: null,
  agent: null,
  latestBuildId: null,
  lastRunAt: null,
  hasChanges: false,
  hasPlan: false,
  buildHistory: [],
  sourceTodo: null,
  sourceKind: null,
  sourceRef: null,
  v: 1,
  ...over,
});
const UNSTARTED = todo({
  id: 'todo-1',
  projectId: 'proj-1',
  title: '修 README 里的失效链接',
  phase: 'todo',
  seqNum: 11,
});
const RUNNING = todo({
  id: 'todo-2',
  projectId: 'proj-2',
  title: '换作品区截图',
  phase: 'building',
  seqNum: 12,
  latestBuildId: 'build-2',
  lastRunAt: 1,
  hasPlan: true,
});
const DONE = todo({
  id: 'todo-3',
  projectId: 'proj-1',
  title: '修看板计数',
  phase: 'done',
  seqNum: 10,
  latestBuildId: 'build-3',
  lastRunAt: 1,
  hasChanges: true,
  hasPlan: true,
});

type Sent = { content: string; projectId?: string; clientMessageId?: string };

async function mockLive(page: Page, opts: { projects?: typeof PROJECTS } = {}) {
  await page.addInitScript(() => {
    class FakeEventSource {
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly url: string) {
        queueMicrotask(() => this.onopen?.());
      }
      close() {
        this.readyState = 2;
      }
      addEventListener() {}
      removeEventListener() {}
    }
    Object.defineProperty(window, 'EventSource', { configurable: true, value: FakeEventSource });
  });
  const projects = opts.projects ?? PROJECTS;
  const state = {
    sent: [] as Sent[],
    sentTo: [] as string[],
    todos: [UNSTARTED, RUNNING, DONE] as Record<string, unknown>[],
    threads: [] as (typeof THREAD & { projectId?: string })[],
    messages: [] as { id: string; role: string; content: unknown; createdAt: number }[],
  };
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/api/teams') return json([TEAM]);
    if (p === '/api/user/me') return json(USER);
    if (p === '/api/teams/t1/notifications') return json({ unreadThreadIds: [] });
    if (p === '/api/teams/t1/chief/threads' && request.method() === 'POST') {
      const body = request.postDataJSON() as Sent;
      state.sent.push(body);
      state.threads = [THREAD];
      state.messages = [{ id: 'n1', role: 'user', content: body.content, createdAt: 30 }];
      return json({ thread: THREAD }, 201);
    }
    const channel = /^\/api\/teams\/t1\/chief\/channels\/([^/]+)$/.exec(p)?.[1];
    if (channel !== undefined && request.method() === 'POST') {
      const name = projects.find((row) => row.id === channel)?.name ?? channel;
      const opened = { ...THREAD, id: `chief-${channel}`, projectId: channel, title: name };
      state.threads = [...state.threads.filter((row) => row.id !== opened.id), opened];
      return json(opened, 201);
    }
    const conversation = /^\/api\/conversations\/([^/]+)\/messages$/.exec(p)?.[1];
    if (conversation !== undefined && request.method() === 'POST') {
      state.sent.push(request.postDataJSON() as Sent);
      state.sentTo.push(conversation);
      return json({ thread: state.threads.find((row) => row.id === conversation) ?? THREAD }, 201);
    }
    if (p === '/api/teams/t1/chief/threads') return json(state.threads);
    if (p === '/api/teams/t1/chief')
      return json({
        chief: {
          id: 'chief-u1-t1',
          userId: 'u1',
          teamId: 't1',
          agent: { agentId: 'agent-1' },
          charter: null,
          lastTurnAt: null,
          createdAt: 0,
          tz: null,
        },
        agentActor: AGENT,
        context: null,
        watches: [],
        wakes: [],
      });
    if (p === `/api/conversations/${THREAD.id}/messages`) return json({ messages: state.messages });
    if (conversation !== undefined) return json({ messages: [] });
    if (p === '/api/todos') return json(state.todos);
    if (p === '/api/projects') return json(projects);
    if (p === '/api/teams/t1/machines') return json([{ id: 'm-ready', name: 'omarchy', online: true }]);
    if (p === '/api/teams/t1/providers') {
      return json({ presets: [], providers: [{ id: 'p-ready', providerId: 'r3-gw', label: 'r3-gw' }] });
    }
    return json([]);
  });
  return state;
}

async function shot(page: Page, name: string) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  await evidenceShot(page, name);
}

const homeInput = (page: Page) => page.getByTestId('home-c').getByTestId('chief-composer-input');

test.describe('the home sends to the project it is filtered to (#2531)', () => {
  test('the home has no chip; a project channel sends to its own thread and the main home sends to none', async ({
    page,
  }) => {
    const state = await mockLive(page);
    await page.goto('/app?project=proj-2&chat=1');
    await expect(homeInput(page)).toHaveAttribute('placeholder', /cairn-site/);
    await expect(page.getByTestId('home-c').getByTestId('chief-project-chip')).toHaveCount(0);
    await homeInput(page).fill('把按钮颜色统一一下');
    await homeInput(page).press('Enter');
    await expect
      .poll(() => state.sent)
      .toEqual([{ content: '把按钮颜色统一一下', projectId: 'proj-2', clientMessageId: expect.any(String) }]);
    expect(state.sentTo).toEqual(['chief-proj-2']);
    await page.goto('/app');
    await homeInput(page).fill('早上的摘要没收到');
    await homeInput(page).press('Enter');
    await expect
      .poll(() => state.sent.at(-1))
      .toEqual({ content: '早上的摘要没收到', clientMessageId: expect.any(String) });
  });

  test('phone width keeps the composer on screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockLive(page);
    await page.goto('/app?project=proj-2&chat=1');
    await expect(homeInput(page)).toBeInViewport();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await shot(page, 'home-project-phone.png');
  });

  test('the project home shows the saved instructions and counts only merged work this week', async ({
    page,
  }) => {
    const state = await mockLive(page, {
      projects: [{ ...PROJECTS[0]!, instructions: '仓库内容用英文；不要 force push。' }, PROJECTS[1]!],
    });
    state.todos.push(
      todo({ id: 'todo-closed', projectId: 'proj-1', title: '放弃的任务', phase: 'closed', seqNum: 13 }),
    );
    await page.goto('/app?project=proj-1');
    await expect(page.getByTestId('project-home-instructions')).toHaveText('仓库内容用英文；不要 force push。');
    await expect(page.getByTestId('project-home').locator('[data-slot="stat-strip"]')).toContainText(
      '1本周合并',
    );
  });

  test('a paused schedule shows as paused with its reason, not a next run', async ({ page }) => {
    await mockLive(page);
    await page.route('**/api/schedules', (route) =>
      route.fulfill({
        json: [
          {
            id: 'sch-1',
            teamId: 't1',
            projectId: 'proj-1',
            todoId: 'todo-1',
            kind: 'daily',
            cron: null,
            prompt: '',
            enabled: false,
            at: 1,
            tz: 'UTC',
            nextRunAt: null,
            lastRunAt: null,
            lastRunStatus: null,
            pausedReason: 'Task archived',
            createdBy: 'u1',
            todo: { seqNum: 11, title: '修 README 里的失效链接', phase: 'todo', projectName: 'cairn', ownerId: 'u1' },
          },
        ],
      }),
    );
    await page.goto('/app?project=proj-1');
    const row = page.getByTestId('project-home').getByText('Task archived');
    await expect(row).toBeVisible();
    await expect(page.getByTestId('project-home')).not.toContainText('1970');
  });
});
