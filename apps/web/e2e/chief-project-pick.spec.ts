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

type Sent = { content: string; projectId?: string };

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
    patched: [] as { id: string; body: Record<string, unknown> }[],
    todos: [UNSTARTED, RUNNING, DONE] as Record<string, unknown>[],
    threads: [] as (typeof THREAD)[],
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
    if (p === `/api/conversations/${THREAD.id}/messages` && request.method() === 'POST') {
      state.sent.push(request.postDataJSON() as Sent);
      return json({ thread: THREAD }, 201);
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
    if (p === '/api/teams/t1/agents/agent-1') return json(AGENT);
    if (p.startsWith('/api/todos/') && request.method() === 'PATCH') {
      const id = p.slice('/api/todos/'.length);
      const body = request.postDataJSON() as Record<string, unknown>;
      state.patched.push({ id, body });
      state.todos = state.todos.map((t) => (t.id === id ? { ...t, ...body } : t));
      return json(state.todos.find((t) => t.id === id));
    }
    if (p === '/api/todos') return json(state.todos);
    if (p === '/api/projects') return json(projects);
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

const home = (page: Page) => page.getByTestId('chief-home');
const chip = (page: Page) => home(page).getByTestId('chief-project-chip');
const input = (page: Page) => home(page).getByTestId('chief-composer-input');

test.describe('the home composer picks a project (T6 #2009)', () => {
  test('the chip starts on 自动, lists every project with its description, and the pick rides on the send', async ({
    page,
  }) => {
    const state = await mockLive(page);
    await page.goto('/app');
    await expect(chip(page)).toHaveText(/自动/);
    await expect(chip(page)).toHaveAttribute('aria-label', '发给哪个项目：自动，由总管判断');
    await chip(page).click();
    const menu = page.getByRole('menu', { name: '发给哪个项目' });
    await expect(menu).toBeVisible();
    const items = menu.getByRole('menuitemradio');
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText('总管判断，拿不准会问你');
    await expect(items.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(items.nth(2)).toContainText('官网 cairn.xmon.me');
    await shot(page, 'chip-menu.png');
    await items.nth(2).click();
    await expect(menu).toHaveCount(0);
    await expect(chip(page)).toHaveText(/cairn-site/);
    await input(page).fill('把按钮颜色统一一下');
    await input(page).press('Enter');
    await expect
      .poll(() => state.sent)
      .toEqual([{ content: '把按钮颜色统一一下', projectId: 'proj-2' }]);
    await expect(chip(page)).toHaveText(/cairn-site/);
    await shot(page, 'chip-picked.png');
  });

  test('the pick survives a reload, and 自动 sends no projectId', async ({ page }) => {
    const state = await mockLive(page);
    await page.goto('/app');
    await chip(page).click();
    await page.getByRole('menuitemradio', { name: /radar-digest/ }).click();
    await page.reload();
    await expect(chip(page)).toHaveText(/radar-digest/);
    await chip(page).click();
    await page.getByRole('menuitemradio', { name: /自动/ }).click();
    await expect(chip(page)).toHaveText(/自动/);
    await input(page).fill('早上的摘要没收到');
    await input(page).press('Enter');
    await expect.poll(() => state.sent).toEqual([{ content: '早上的摘要没收到' }]);
  });

  test('typing @ and picking a project sets the chip and leaves no @ text behind', async ({
    page,
  }) => {
    const state = await mockLive(page);
    await page.goto('/app');
    await input(page).fill('修一下链接 ');
    await input(page).pressSequentially('@site');
    const option = page.getByRole('option', { name: /cairn-site/ });
    await expect(option).toBeVisible();
    await input(page).press('ArrowDown');
    await expect(input(page)).toHaveAttribute('aria-activedescendant', /.+/);
    await input(page).press('Enter');
    await expect(chip(page)).toHaveText(/cairn-site/);
    await expect(input(page)).toHaveValue('修一下链接 ');
    await input(page).press('Enter');
    await expect
      .poll(() => state.sent)
      .toEqual([{ content: '修一下链接', projectId: 'proj-2' }]);
  });

  test('a team with one project shows no chip', async ({ page }) => {
    await mockLive(page, { projects: [PROJECTS[0]!] });
    await page.goto('/app');
    await expect(input(page)).toBeVisible();
    await expect(chip(page)).toHaveCount(0);
  });

  test('the home summary lists one line per project', async ({ page }) => {
    await mockLive(page);
    await page.goto('/app');
    const lines = page.getByTestId('chief-home-project');
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toContainText('cairn');
    await expect(lines.nth(0)).toContainText('今天合并 1 个');
    await expect(lines.nth(1)).toContainText('cairn-site');
    await expect(lines.nth(1)).toContainText('1 个在跑');
    await shot(page, 'home-by-project.png');
  });
});

test.describe('moving a task to another project (T6 #2009)', () => {
  test('an unstarted task offers 换项目 and the pick patches its project', async ({ page }) => {
    const state = await mockLive(page);
    await page.goto('/app?task=todo-1');
    const panel = page.getByRole('complementary', { name: '任务面板' });
    await expect(panel.getByTestId('task-panel-meta')).toContainText('cairn');
    const move = panel.getByTestId('task-panel-move');
    await expect(move).toContainText('还没开始，放错了可以');
    await move.getByRole('button', { name: '换项目' }).click();
    const menu = page.getByRole('group', { name: '挪到哪个项目' });
    await expect(menu.getByRole('menuitemradio')).toHaveCount(3);
    await expect(menu.getByRole('menuitemradio', { name: /^cairn\b/ }).first()).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await shot(page, 'move-menu.png');
    await menu.getByRole('menuitemradio', { name: /cairn-site/ }).click();
    await expect.poll(() => state.patched).toEqual([{ id: 'todo-1', body: { projectId: 'proj-2' } }]);
    await expect(panel.getByTestId('task-panel-meta')).toContainText('cairn-site');
  });

  test('a running task has no 换项目', async ({ page }) => {
    await mockLive(page);
    await page.goto('/app?task=todo-2');
    const panel = page.getByRole('complementary', { name: '任务面板' });
    await expect(panel.getByTestId('task-panel-title')).toHaveText('换作品区截图');
    await expect(panel.getByTestId('task-panel-move')).toHaveCount(0);
  });

  test('phone width keeps the chip and the composer on screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockLive(page);
    await page.goto('/app');
    await expect(chip(page)).toBeInViewport();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await shot(page, 'chip-phone.png');
  });
});
