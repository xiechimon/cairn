import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';
import { openReplySteps, verticalGap } from './helpers.js';

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
  turnQueue?: {
    stepId?: string;
    position: number;
    waitingFor: { machineId: string; name: string; running: number; capacity: number } | null;
  } | null;
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
  turnQueue: s.turnQueue ?? null,
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
        if (state.turnQueue?.stepId === withdrawn[1]) {
          state.turnQueue = null;
          state.activeRun = null;
        }
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
    if (p === '/api/todos') return json([TASK]);
    if (p === '/api/projects') return json([PROJECT]);
    if (p === '/api/teams/t1/machines') return json([{ id: 'm-ready', name: 'omarchy', online: true }]);
    if (p === '/api/teams/t1/providers') {
      return json({ presets: [], providers: [{ id: 'p-ready', providerId: 'r3-gw', label: 'r3-gw' }] });
    }
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
    const home = page.getByTestId('home-c');
    const banner = home.getByTestId('chief-outage');
    await expect(banner).toContainText('Coordinator 暂时不可用');
    await expect(banner).toContainText('relay-a/claude-opus');
    await expect(banner).toContainText('任务照常在跑');
    await expect(banner.getByRole('button', { name: '给 Coordinator 换模型' })).toBeVisible();
    const held = home.getByTestId('queued-message');
    await expect(held).toHaveCount(2);
    await expect(held.first()).toHaveAttribute('title', '已存下，Coordinator 恢复后会处理');
    await expect(held.first().getByRole('button', { name: '撤回' })).toBeVisible();
    await expect(held.first().getByRole('button', { name: '现在插话' })).toHaveCount(0);
    await expect(home.getByTestId('chief-stream').getByTestId('queued-message')).toHaveCount(0);
    await expect(home.getByRole('button', { name: '停止 Coordinator 这次回复' })).toHaveCount(0);
    await expect(home.getByTestId('chief-composer-input')).toHaveAttribute(
      'placeholder',
      '可以继续说，Coordinator 恢复后会按顺序处理…',
    );
    await evidenceShot(page, 'outage-desktop.png');
    await banner.getByRole('button', { name: '给 Coordinator 换模型' }).click();
    await expect(page.getByTestId('chief-settings-col')).toBeVisible();
  });

  test('withdrawing a held message deletes it and puts the text back in the composer', async ({
    page,
  }) => {
    const calls = await mockLive(page, outageState());
    await page.goto('/app');
    const home = page.getByTestId('home-c');
    await home.getByTestId('queued-message').nth(1).getByRole('button', { name: '撤回' }).click();
    await expect.poll(() => calls).toContain('DELETE /messages/m2');
    await expect(home.getByTestId('chief-composer-input')).toHaveValue('顺便把空列提示也改一下');
    await expect(home.getByTestId('queued-message')).toHaveCount(1);
  });

  test('phone width: the banner collapses to one line with `详情`', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockLive(page, outageState());
    await page.goto('/app');
    const banner = page.getByTestId('chief-outage');
    const details = banner.getByRole('button', { name: '详情' });
    await expect(details).toBeVisible();
    await expect(banner.getByText('任务照常在跑', { exact: false })).toBeHidden();
    const collapsed = await banner.boundingBox();
    expect(collapsed?.height ?? 0).toBeLessThan(72);
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

  test('with a backup model the banner names it and the reply says which model answered', async ({
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
            stepId: 'm1',
          }),
          createdAt: 11,
        },
        { id: 'user-m1', role: 'user', content: FIRST.content, createdAt: 11 },
        { id: 'm2', role: 'assistant', content: '好，我先看一下看板的计数逻辑。', createdAt: 12 },
        { id: 'user-w1', role: 'user', content: '[wake:settle] 任务 #9 已合并完成', createdAt: 30 },
        { id: 'm5', role: 'assistant', content: '#9 已经合并了。', createdAt: 31 },
      ],
    });
    await page.goto('/app');
    const home = page.getByTestId('home-c');
    const notes = home.getByTestId('chief-fallback-note');
    await expect(notes).toHaveCount(1);
    await expect(notes).toContainText('由备用模型 relay-b/glm-4.6 回答');
    await expect(home.getByTestId('chief-fallback-banner')).toContainText('relay-b/glm-4.6');
    await expect(home.getByTestId('chief-outage')).toHaveCount(0);
    await evidenceShot(page, 'fallback.png');
  });
});

test.describe('send and stop while the Coordinator is replying (T5)', () => {
  test('messages sent during a running turn stay in the conversation, in server order, with no queue capsules', async ({
    page,
  }) => {
    await mockLive(page, busyState());
    await page.goto('/app');
    const home = page.getByTestId('home-c');
    const stream = home.getByTestId('chief-stream');
    const first = stream.getByTestId('chief-msg').filter({ hasText: '只看 cairn 项目就行' });
    const second = stream.getByTestId('chief-msg').filter({ hasText: '再顺便看下空列提示' });
    await expect(first).toHaveCount(1);
    await expect(second).toHaveCount(1);
    expect(await verticalGap(page, first, second)).toBeGreaterThanOrEqual(0);
    const working = stream.getByTestId('chief-msg').last();
    await expect(working).not.toContainText('再顺便看下空列提示');
    expect(await verticalGap(page, second, working)).toBeGreaterThanOrEqual(0);
    await expect(home.getByTestId('queued-message')).toHaveCount(0);
    await evidenceShot(page, 'sent-mid-turn.png');
  });

  test('a busy Coordinator keeps the send button and never shows a stop square', async ({ page }) => {
    await mockLive(page, busyState());
    await page.goto('/app');
    const home = page.getByTestId('home-c');
    await expect(home.getByRole('button', { name: '发送' })).toBeVisible();
    await expect(home.getByRole('button', { name: '停止 Coordinator 这次回复' })).toHaveCount(0);
    await home.getByTestId('chief-composer-input').fill('再加一句');
    await expect(home.getByRole('button', { name: '发送' })).toBeVisible();
  });

  test('Esc in the composer and `/stop` both stop the running reply', async ({ page }) => {
    const calls = await mockLive(page, busyState());
    await page.goto('/app');
    const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
    await input.focus();
    await input.press('Escape');
    await expect.poll(() => calls.filter((c) => c === 'POST /stop').length).toBe(1);
    await input.fill('/stop');
    await input.press('ArrowDown');
    await input.press('Enter');
    await expect.poll(() => calls.filter((c) => c === 'POST /stop').length).toBe(2);
    await expect(input).toHaveValue('');
    expect(calls).not.toContain('send');
  });

  test('typing 停止 sends it as a message to the Coordinator, it does not press stop', async ({
    page,
  }) => {
    const calls = await mockLive(page, busyState());
    await page.goto('/app');
    const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
    await input.fill('停止');
    await input.press('Enter');
    await expect.poll(() => calls).toContain('send');
    expect(calls).not.toContain('POST /stop');
  });

  test('stop on a turn still waiting for a machine withdraws that message and returns its text', async ({
    page,
  }) => {
    const calls = await mockLive(page, {
      activeRun: { phase: 'chief' },
      pending: [],
      fallbackModel: null,
      outage: null,
      messages: [FIRST],
      turnQueue: {
        stepId: 'm1',
        position: 1,
        waitingFor: { machineId: 'mac-1', name: 'studio-mac.local', running: 0, capacity: 8 },
      },
    });
    await page.goto('/app');
    const home = page.getByTestId('home-c');
    await expect(home.getByTestId('chief-msg').last()).toContainText('studio-mac.local');
    const input = home.getByTestId('chief-composer-input');
    await input.focus();
    await input.press('Escape');
    await expect.poll(() => calls).toContain('DELETE /messages/m1');
    expect(calls).not.toContain('POST /stop');
    await expect(input).toHaveValue(FIRST.content);
    await expect(home.getByRole('button', { name: '发送' })).toBeVisible();
    await evidenceShot(page, 'stop-queued-turn.png');
  });

  test('while the turn still waits for a machine the composer says new messages queue behind it', async ({
    page,
  }) => {
    await mockLive(page, {
      activeRun: { phase: 'chief' },
      pending: [],
      fallbackModel: null,
      outage: null,
      messages: [FIRST],
      turnQueue: {
        stepId: 'm1',
        position: 1,
        waitingFor: { machineId: 'mac-1', name: 'studio-mac.local', running: 0, capacity: 8 },
      },
    });
    await page.goto('/app');
    const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
    await expect(input).toHaveAttribute('placeholder', '还没开始处理，新发的话会排在这条后面');
  });

  test('a running turn takes new messages into itself and the composer says so', async ({
    page,
  }) => {
    await mockLive(page, { ...busyState(), pending: [], messages: [FIRST] });
    await page.goto('/app');
    const home = page.getByTestId('home-c');
    await expect(home.getByTestId('chief-composer-input')).toHaveAttribute(
      'placeholder',
      '发出的话会直接插进 Coordinator 这一轮',
    );
    await expect(home.getByTestId('queued-message')).toHaveCount(0);
  });

  test('a running turn leaves the answered turn above it alone: its tools show once, under the reply header', async ({
    page,
  }) => {
    const call = (id: string, name: string, at: number) => ({
      id,
      role: 'assistant',
      content: {
        kind: 'toolcall',
        call: { id, name, arguments: {}, startedAt: at, endedAt: at + 1000, result: '{}' },
      },
      createdAt: at,
    });
    await mockLive(page, {
      activeRun: { phase: 'chief' },
      pending: [],
      fallbackModel: null,
      outage: null,
      messages: [
        { id: 'u-q', role: 'user', content: '？', createdAt: 1 },
        call('t-1', 'pull_requests', 2),
        call('t-2', 'issues', 3),
        call('t-3', 'run_builds', 4),
        { id: 'a-1', role: 'assistant', content: '已派发 #9。', createdAt: 5 },
        { id: 'u-stop', role: 'user', content: '停止', createdAt: 6 },
      ],
    });
    await page.goto('/app');
    const home = page.getByTestId('home-c');
    const reply = home.getByTestId('chief-msg').filter({ hasText: '已派发 #9。' });
    await expect(reply).toHaveCount(1);
    await expect(reply.getByTestId('chief-turn-tools')).toHaveCount(0);
    await openReplySteps(page, reply);
    await evidenceShot(page, 'tools-once.png');
    const question = home.getByTestId('chief-msg').filter({ hasText: '？' }).first();
    expect(await verticalGap(page, question, reply)).toBeLessThan(48);
    for (const name of ['pull_requests', 'issues', 'run_builds']) {
      await expect(home.getByText(name, { exact: true })).toHaveCount(1);
    }
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
    const home = page.getByTestId('home-c');
    await expect(home.getByTestId('chief-stopped')).toHaveText('已停止，没有建任务。');
    const fills = await home.getByTestId('chief-stopped').evaluate((el) => {
      const probe = document.createElement('div');
      probe.style.background = 'var(--reply-bubble-fill)';
      document.body.append(probe);
      const reply = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { stopped: getComputedStyle(el).backgroundColor, reply };
    });
    expect(fills.stopped).toBe(fills.reply);
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
    await stopped.getByRole('link', { name: TASK.title }).click();
    await expect(page).toHaveURL(/[?&]thread=todo-1/);
  });
});

test.describe('held messages never push the input out of the composer', () => {
  for (const target of [{ name: 'home at 600px height', url: '/app', width: 1440, height: 600 }]) {
    test(`ten held messages keep the input and send button in view (${target.name})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: target.width, height: target.height });
      const held = Array.from({ length: 10 }, (_, n) => ({
        id: `q${n}`,
        role: 'user',
        content: `Held message number ${n + 1} with enough words to look like a real follow-up`,
        createdAt: 12 + n,
      }));
      await mockLive(page, {
        activeRun: { phase: 'chief' },
        pending: held.map((row) => ({ messageId: row.id, state: 'held' as const })),
        fallbackModel: null,
        outage: { reason: 'quota', model: 'relay-a/claude-opus', retryAt: RETRY_AT },
        messages: [FIRST, ...held],
      });
      await page.goto(target.url);
      const root = page.getByTestId('home-c');
      await expect(root.getByTestId('queued-message')).toHaveCount(10);
      await expect(root.getByTestId('chief-composer-input')).toBeInViewport({ ratio: 1 });
      await expect(root.getByRole('button', { name: '发送' })).toBeInViewport({ ratio: 1 });
      const capsules = await root.getByTestId('queued-capsules').evaluate((node) => node.scrollHeight > node.clientHeight);
      expect(capsules).toBe(true);
    });
  }
});
