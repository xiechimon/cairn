import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';

declare global {
  interface Window {
    __es: { url: string; readyState: number; emit: (ev: unknown) => void }[];
  }
}

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
  title: '修看板计数',
  createdAt: 2,
  updatedAt: 2,
  lastTurnAt: null,
  session: { runtime: 'pi', id: 's2', openedAt: 2 },
  pendingSessionResumeAt: null,
  toolDefHashes: {},
  toolResultHashes: {},
  activeRun: null,
};
const TASK = {
  id: 'todo-1',
  teamId: 't1',
  projectId: 'proj-1',
  title: '修复看板拖拽后计数不刷新',
  spec: '',
  phase: 'building',
  phaseAt: 0,
  seqNum: 9,
  orderIndex: 0,
  tagIds: [],
  assignment: null,
  agent: null,
  latestBuildId: 'build-1',
  lastRunAt: 0,
  hasChanges: false,
  hasPlan: true,
  buildHistory: [],
  sourceTodo: null,
  v: 1,
};
const PROJECT = {
  id: 'proj-1',
  name: 'cairn',
  teamId: 't1',
  repoKind: 'hosted',
  repoName: 'cairn',
  githubRepo: null,
  localPath: null,
};

const toolRow = (id: string, name: string, args: unknown, at: number) => ({
  id,
  role: 'assistant',
  content: {
    kind: 'toolcall',
    call: { id: `c-${id}`, name, arguments: args, result: { ok: true }, startedAt: at, endedAt: at + 2000 },
  },
  createdAt: at,
});

const HISTORY = [
  { id: 'm1', role: 'user', content: '看板拖完卡片计数不对，修一下', createdAt: 10 },
  toolRow('m2', 'create_todo', { title: TASK.title, projectId: 'proj-1' }, 11),
  {
    id: 'm3',
    role: 'assistant',
    content: '已建任务 [#9 修复看板拖拽后计数不刷新](todo:todo-1)，放在 cairn，正在跑。',
    createdAt: 12,
  },
  { id: 'm4', role: 'user', content: '顺便把空列的提示也改一下', createdAt: 20 },
  toolRow('m5', 'message_todo', { todoId: 'todo-1', content: '空列提示也改一下' }, 21),
  { id: 'm6', role: 'assistant', content: '这条和 #9 是同一处，已经补给它了。', createdAt: 22 },
];

type Row = { id: string; role: string; content: unknown; createdAt: number };

async function mockLive(
  page: Page,
  state: { threads: (typeof THREAD)[]; messages: Row[]; rejectSend?: boolean },
) {
  await page.addInitScript(() => {
    window.__es = [];
    class FakeEventSource {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly url: string) {
        window.__es.push(this as unknown as (typeof window.__es)[number]);
        queueMicrotask(() => this.onopen?.());
      }
      close() {
        this.readyState = 2;
      }
      emit(ev: unknown) {
        this.onmessage?.({ data: JSON.stringify(ev) });
      }
      addEventListener() {}
      removeEventListener() {}
    }
    Object.defineProperty(window, 'EventSource', { configurable: true, value: FakeEventSource });
  });
  const sent: string[] = [];
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/api/teams') return json([TEAM]);
    if (p === '/api/user/me') return json(USER);
    if (p === '/api/teams/t1/notifications') return json({ unreadThreadIds: [] });
    if (p === '/api/teams/t1/chief/threads' && request.method() === 'POST') {
      const content = (request.postDataJSON() as { content: string }).content;
      sent.push(content);
      if (state.rejectSend) return json({ error: 'boom' }, 500);
      state.threads = [THREAD];
      state.messages = [{ id: 'n1', role: 'user', content, createdAt: 30 }];
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
    if (p === '/api/todos') return json([TASK]);
    if (p === '/api/projects') return json([PROJECT]);
    if (p === '/api/teams/t1/members' || p === '/api/teams/t1/machines' || p === '/api/skills')
      return json([]);
    return json([]);
  });
  return sent;
}

test.describe('home is one continuous chief chat (T1)', () => {
  test('a fresh home shows the greeting, the composer and the sections, and no chief drawer', async ({
    page,
  }) => {
    await mockLive(page, { threads: [], messages: [] });
    await page.goto('/app');
    const home = page.getByTestId('chief-home');
    await expect(home).toHaveAttribute('data-layout', 'hero');
    await expect(page.getByTestId('chief-home-hero')).toContainText('ian');
    await expect(page.getByTestId('chief-home-summary')).toContainText('1 个任务运行中');
    await expect(home.getByTestId('chief-composer-input')).toBeVisible();
    await expect(page.getByTestId('home-sections')).toBeVisible();
    await expect(page.getByRole('button', { name: '总管', exact: true })).toHaveCount(0);
    await expect(page.locator('.chief-drawer')).toBeHidden();
    await evidenceShot(page, 'home-hero.png');
  });

  test('the first send moves the composer to the bottom and the message joins the chat', async ({
    page,
  }) => {
    const sent = await mockLive(page, { threads: [], messages: [] });
    await page.goto('/app');
    const input = page.getByTestId('chief-home').getByTestId('chief-composer-input');
    await input.fill('看板拖完卡片计数不对');
    await input.press('Enter');
    await expect.poll(() => sent).toEqual(['看板拖完卡片计数不对']);
    const home = page.getByTestId('chief-home');
    await expect(home).toHaveAttribute('data-layout', 'chat');
    await expect(home.getByTestId('chief-stream')).toContainText('看板拖完卡片计数不对');
    await expect(page.getByTestId('home-sections')).toHaveCount(0);
    const composer = await home.locator('.chief-composer').boundingBox();
    const viewport = page.viewportSize();
    expect(composer).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (composer && viewport) expect(composer.y + composer.height).toBeGreaterThan(viewport.height - 40);
  });

  test('a first send that fails brings the greeting and the sections back', async ({ page }) => {
    const sent = await mockLive(page, { threads: [], messages: [], rejectSend: true });
    await page.goto('/app');
    const input = page.getByTestId('chief-home').getByTestId('chief-composer-input');
    await input.fill('看板拖完卡片计数不对');
    await input.press('Enter');
    await expect.poll(() => sent).toEqual(['看板拖完卡片计数不对']);
    await expect(page.getByTestId('chief-home')).toHaveAttribute('data-layout', 'hero');
    await expect(page.getByTestId('home-sections')).toBeVisible();
    await expect(input).toHaveValue('看板拖完卡片计数不对');
  });

  test('Escape closes the thread menu on home', async ({ page }) => {
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app');
    const home = page.getByTestId('chief-home');
    await home.getByRole('button', { name: '主题', exact: true }).click();
    const menu = home.getByRole('menu');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

  test('a reply carries a live task chip, a hand-off row and an expandable trace; reload keeps it', async ({
    page,
  }) => {
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app');
    const stream = page.getByTestId('chief-home').getByTestId('chief-stream');
    const chip = stream.locator('a.mention-chip--todo').first();
    await expect(chip).toHaveAttribute('data-phase', 'building');
    await expect(chip.getByRole('img', { name: '执行中' })).toBeVisible();
    const handoff = stream.getByTestId('chief-handoff');
    await expect(handoff).toContainText('已转给任务');
    await expect(handoff).toContainText('#9');
    const expand = stream.getByRole('button', { name: '展开过程' }).first();
    await expand.click();
    await expect(stream.getByTestId('chief-turn-tools').first()).toBeVisible();
    await evidenceShot(page, 'home-chat.png');
    await page.reload();
    await expect(page.getByTestId('chief-home').getByTestId('chief-stream')).toContainText(
      '已经补给它了',
    );
    await page.getByTestId('chief-home').locator('a.mention-chip--todo').first().click();
    await expect(page).toHaveURL(/\/app\?(.*&)?task=todo-1/);
    await expect(page.getByRole('complementary', { name: '任务面板' })).toBeVisible();
  });

  test('cmd+J on home focuses the home composer instead of opening the drawer', async ({ page }) => {
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app');
    await expect(page.getByTestId('chief-home').getByTestId('chief-stream')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+j');
    await expect(page.getByTestId('chief-home').getByTestId('chief-composer-input')).toBeFocused();
    await expect(page.locator('.chief-drawer')).toBeHidden();
  });

  test('the board view keeps the chief button and drawer', async ({ page }) => {
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app?view=board');
    await expect(page.getByTestId('chief-home')).toHaveCount(0);
    await page.getByRole('button', { name: '总管', exact: true }).click();
    await expect(page.locator('.chief-drawer')).toBeVisible();
  });

  test('a task chip in the drawer opens the task panel on the board instead of leaving it', async ({
    page,
  }) => {
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app?view=board');
    await page.getByRole('button', { name: '总管', exact: true }).click();
    const drawer = page.locator('.chief-drawer');
    await drawer.locator('a.mention-chip--todo').first().click();
    const panel = page.getByRole('complementary', { name: '任务面板' });
    await expect(panel).toBeVisible();
    await expect(panel).toBeInViewport({ ratio: 1 });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/app');
    expect(url.searchParams.get('view')).toBe('board');
    expect(url.searchParams.get('task')).toBe('todo-1');
    await expect(drawer).toBeHidden();
  });

  test('phone width: the chat fills the screen and the composer stays on screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app');
    const composer = page.getByTestId('chief-home').locator('.chief-composer');
    await expect(composer).toBeInViewport();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await evidenceShot(page, 'home-chat-phone.png');
  });
});
