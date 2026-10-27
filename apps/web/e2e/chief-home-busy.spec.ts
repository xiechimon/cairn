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
  provider: 'relay-a',
  modelId: 'claude-opus',
  thinkingLevel: null,
  tools: [],
  secrets: [],
  defaultSkill: null,
  skillsAllowlist: null,
  mcpServers: [],
};
const TASK = {
  id: 'todo-1',
  teamId: 't1',
  projectId: 'proj-1',
  title: '修复看板拖拽后计数不刷新',
  spec: '',
  phase: 'todo',
  phaseAt: 0,
  seqNum: 9,
  orderIndex: 0,
  tagIds: [],
  assignment: null,
  agent: null,
  latestBuildId: null,
  lastRunAt: 0,
  hasChanges: false,
  hasPlan: false,
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

type Row = { id: string; role: string; content: unknown; createdAt: number };
type Pending = { messageId: string; state: 'queued' | 'held' };
type Outage = { reason: 'quota'; model: string | null; retryAt: number | null } | null;

interface State {
  activeRun: { phase: string } | null;
  pending: Pending[];
  fallbackModel: string | null;
  outage: Outage;
  messages: Row[];
}

const thread = (s: State) => ({
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
  activeRun: s.activeRun,
  pending: s.pending,
  fallbackModel: s.fallbackModel,
});

const FIRST = { id: 'm1', role: 'user', content: '看板拖完卡片计数不对，修一下', createdAt: 10 };

async function mockLive(page: Page, state: State) {
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
  const calls: string[] = [];
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const base = '/api/teams/t1/chief/threads/chief-home';
    if (p.startsWith(`${base}/`) && request.method() !== 'GET') {
      calls.push(`${request.method()} ${p.slice(base.length)}`);
      const withdrawn = /^\/messages\/([^/]+)$/.exec(p.slice(base.length));
      if (withdrawn && request.method() === 'DELETE') {
        state.pending = state.pending.filter((x) => x.messageId !== withdrawn[1]);
        state.messages = state.messages.filter((m) => m.id !== withdrawn[1]);
        return json({ ok: true });
      }
      if (p.endsWith('/steer')) return json({ steered: true });
      if (p.endsWith('/stop')) return json({ delegated: true });
    }
    if (p === '/api/teams') return json([TEAM]);
    if (p === '/api/user/me') return json(USER);
    if (p === '/api/teams/t1/notifications') return json({ unreadThreadIds: [] });
    if (p === '/api/conversations/chief-home/messages' && request.method() === 'POST') {
      calls.push('send');
      return json({ thread: thread(state) }, 201);
    }
    if (p === '/api/teams/t1/chief/threads') return json([thread(state)]);
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
        outage: state.outage,
      });
    if (p === '/api/conversations/chief-home/messages') return json({ messages: state.messages });
    if (p === '/api/teams/t1/agents/agent-1') return json(AGENT);
    if (p === '/api/todos') return json([TASK]);
    if (p === '/api/projects') return json([PROJECT]);
    return json([]);
  });
  return calls;
}

const RETRY_AT = new Date(2026, 10, 1, 9, 0).getTime();

const outageState = (): State => ({
  activeRun: { phase: 'chief' },
  pending: [
    { messageId: 'm1', state: 'held' },
    { messageId: 'm2', state: 'held' },
  ],
  fallbackModel: null,
  outage: { reason: 'quota', model: 'relay-a/claude-opus', retryAt: RETRY_AT },
  messages: [FIRST, { id: 'm2', role: 'user', content: '顺便把空列提示也改一下', createdAt: 20 }],
});

const busyState = (): State => ({
  activeRun: { phase: 'chief' },
  pending: [
    { messageId: 'm3', state: 'queued' },
    { messageId: 'm4', state: 'queued' },
  ],
  fallbackModel: null,
  outage: null,
  messages: [
    FIRST,
    { id: 'm3', role: 'user', content: '只看 cairn 项目就行', createdAt: 12 },
    { id: 'm4', role: 'user', content: '再顺便看下空列提示', createdAt: 13 },
  ],
});

test.describe('chief unavailable (T4)', () => {
  test('the banner explains the outage, held messages say they are saved, and there is no stop square', async ({
    page,
  }) => {
    await mockLive(page, outageState());
    await page.goto('/app');
    const home = page.getByTestId('chief-home');
    const banner = home.getByTestId('chief-outage');
    await expect(banner).toContainText('总管暂时不可用');
    await expect(banner).toContainText('relay-a/claude-opus');
    await expect(banner).toContainText('任务照常在跑');
    await expect(banner.getByRole('button', { name: '给总管换模型' })).toBeVisible();
    await expect(banner.getByRole('button', { name: '直接建任务' })).toBeVisible();
    const held = home.getByTestId('chief-pending');
    await expect(held).toHaveCount(2);
    await expect(held.first()).toContainText('已存下，总管恢复后会处理');
    await expect(held.first().getByRole('button', { name: '撤回' })).toBeVisible();
    await expect(held.first().getByRole('button', { name: '现在插话' })).toHaveCount(0);
    await expect(home.getByRole('button', { name: '停止总管这次回复' })).toHaveCount(0);
    await expect(home.getByTestId('chief-composer-input')).toHaveAttribute(
      'placeholder',
      '可以继续说，总管恢复后会按顺序处理…',
    );
    await evidenceShot(page, 'outage-desktop.png');
    await banner.getByRole('button', { name: '给总管换模型' }).click();
    await expect(page.getByTestId('chief-settings-col')).toBeVisible();
  });

  test('direct task creation opens the new task dialog', async ({ page }) => {
    await mockLive(page, outageState());
    await page.goto('/app');
    await page.getByTestId('chief-outage').getByRole('button', { name: '直接建任务' }).click();
    await expect(page.getByRole('dialog', { name: '新建任务' })).toBeVisible();
  });

  test('withdrawing a held message deletes it and puts the text back in the composer', async ({
    page,
  }) => {
    const calls = await mockLive(page, outageState());
    await page.goto('/app');
    const home = page.getByTestId('chief-home');
    await home.getByTestId('chief-pending').nth(1).getByRole('button', { name: '撤回' }).click();
    await expect.poll(() => calls).toContain('DELETE /messages/m2');
    await expect(home.getByTestId('chief-composer-input')).toHaveValue('顺便把空列提示也改一下');
    await expect(home.getByTestId('chief-pending')).toHaveCount(1);
  });

  test('phone width: the banner collapses to one line with 详情', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockLive(page, outageState());
    await page.goto('/app');
    const banner = page.getByTestId('chief-outage');
    const details = banner.getByRole('button', { name: '详情' });
    await expect(details).toBeVisible();
    await expect(banner.getByText('任务照常在跑', { exact: false })).toBeHidden();
    const collapsed = await banner.boundingBox();
    expect(collapsed?.height ?? 0).toBeLessThan(56);
    await evidenceShot(page, 'outage-phone.png');
    await details.click();
    await expect(banner.getByText('任务照常在跑', { exact: false })).toBeVisible();
    await expect(banner.getByRole('button', { name: '收起' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  });

  test('with a backup model the model row gets a dot, and the reply says which model answered', async ({
    page,
  }) => {
    await mockLive(page, {
      activeRun: null,
      pending: [],
      fallbackModel: 'relay-b/glm-4.6',
      outage: null,
      messages: [
        FIRST,
        {
          id: 'chief-fallback-s1-2',
          role: 'system',
          content: JSON.stringify({
            kind: 'chief_model_fallback',
            from: 'relay-a/claude-opus',
            to: 'relay-b/glm-4.6',
          }),
          createdAt: 11,
        },
        { id: 'm2', role: 'assistant', content: '好，我先看一下看板的计数逻辑。', createdAt: 12 },
      ],
    });
    await page.goto('/app');
    const home = page.getByTestId('chief-home');
    const row = home.getByTestId('chief-model-row');
    await expect(row).toContainText('备用模型 relay-b/glm-4.6');
    await expect(row.getByTestId('chief-fallback-dot')).toBeVisible();
    await expect(row).toContainText('主模型暂时用不了');
    await expect(home.getByTestId('chief-fallback-note')).toContainText(
      '由备用模型 relay-b/glm-4.6 回答',
    );
    await expect(home.getByTestId('chief-fallback-banner')).toContainText('relay-b/glm-4.6');
    await expect(home.getByTestId('chief-outage')).toHaveCount(0);
    await evidenceShot(page, 'fallback.png');
  });
});

test.describe('queue, steer and stop while the chief is replying (T5)', () => {
  test('messages sent while busy are queued after the live reply, in server order', async ({
    page,
  }) => {
    await mockLive(page, busyState());
    await page.goto('/app');
    const home = page.getByTestId('chief-home');
    const queued = home.getByTestId('chief-pending');
    await expect(queued).toHaveCount(2);
    await expect(queued.first()).toContainText('只看 cairn 项目就行');
    await expect(queued.first()).toContainText('排队中，总管回完上一条就看');
    await expect(queued.nth(1)).toContainText('再顺便看下空列提示');
    const stream = home.getByTestId('chief-stream');
    const order = await stream.evaluate((el) =>
      [...el.querySelectorAll('[data-testid="chief-pending"], [data-testid="chief-msg"]')].map(
        (n) => n.getAttribute('data-testid'),
      ),
    );
    expect(order.slice(-2)).toEqual(['chief-pending', 'chief-pending']);
    await evidenceShot(page, 'queued.png');
    await page.reload();
    await expect(home.getByTestId('chief-pending').first()).toContainText('只看 cairn 项目就行');
  });

  test('现在插话 steers the queued message into the running reply', async ({ page }) => {
    const calls = await mockLive(page, busyState());
    await page.goto('/app');
    await page
      .getByTestId('chief-pending')
      .first()
      .getByRole('button', { name: '现在插话' })
      .click();
    await expect.poll(() => calls).toContain('POST /messages/m3/steer');
  });

  test('the send button is a stop square only while busy with an empty input', async ({ page }) => {
    const calls = await mockLive(page, busyState());
    await page.goto('/app');
    const home = page.getByTestId('chief-home');
    const stop = home.getByRole('button', { name: '停止总管这次回复' });
    await expect(stop).toBeVisible();
    const input = home.getByTestId('chief-composer-input');
    await input.fill('再加一句');
    await expect(stop).toHaveCount(0);
    await expect(home.getByRole('button', { name: '发送' })).toBeVisible();
    await input.fill('');
    await home.getByRole('button', { name: '停止总管这次回复' }).click();
    await expect.poll(() => calls).toContain('POST /stop');
  });

  test('a stopped turn says no task was created', async ({ page }) => {
    await mockLive(page, {
      activeRun: null,
      pending: [],
      fallbackModel: null,
      outage: null,
      messages: [
        FIRST,
        {
          id: 'chief-stop-m1',
          role: 'system',
          content: JSON.stringify({ kind: 'chief_turn_stopped', todos: [] }),
          createdAt: 11,
        },
      ],
    });
    await page.goto('/app');
    const home = page.getByTestId('chief-home');
    await expect(home.getByTestId('chief-stopped')).toHaveText('已停止，没有建任务。');
    await expect(home.getByRole('alert')).toHaveCount(0);
    await expect(home.getByRole('button', { name: '发送' })).toBeVisible();
  });

  test('a stop after a task was created names and links the task', async ({ page }) => {
    await mockLive(page, {
      activeRun: null,
      pending: [],
      fallbackModel: null,
      outage: null,
      messages: [
        FIRST,
        {
          id: 'chief-stop-m1',
          role: 'system',
          content: JSON.stringify({
            kind: 'chief_turn_stopped',
            todos: [{ id: 'todo-1', seq: 9, title: TASK.title }],
          }),
          createdAt: 11,
        },
      ],
    });
    await page.goto('/app');
    const stopped = page.getByTestId('chief-stopped');
    await expect(stopped).toContainText('已停止。停之前已经建了任务');
    await evidenceShot(page, 'stopped-with-task.png');
    await stopped.getByRole('link', { name: /#9/ }).click();
    await expect(page).toHaveURL(/\/app\/todo\/todo-1/);
  });
});
