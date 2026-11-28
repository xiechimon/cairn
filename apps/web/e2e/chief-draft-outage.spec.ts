import { expect, type Page, test } from '@playwright/test';
import { PROJECT } from './chief-home-mock';

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
const THREAD = {
  id: 'chief-home',
  chiefId: 'chief-u1-t1',
  userId: 'u1',
  teamId: 't1',
  title: 'Coordinator',
  createdAt: 2,
  updatedAt: 2,
  lastTurnAt: null,
  session: { runtime: 'pi', id: 's2', openedAt: 2 },
  pendingSessionResumeAt: null,
  toolDefHashes: {},
  toolResultHashes: {},
  activeRun: null,
};

interface Row {
  id: string;
  role: 'user';
  content: string;
  createdAt: number;
}

interface SendBody {
  content: string;
  clientMessageId?: string;
}

async function mockCoordinatorWithOutage(page: Page) {
  const state = { up: true };
  const messages: Row[] = [{ id: 'm1', role: 'user', content: 'Earlier note', createdAt: 10 }];
  const ledger = new Map<string, Row>();
  const posts: SendBody[] = [];
  const context = page.context();
  await context.addInitScript(() => {
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
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!state.up) return route.abort('connectionrefused');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (
      (path === '/api/conversations/chief-home/messages' ||
        path === '/api/teams/t1/chief/threads') &&
      request.method() === 'POST'
    ) {
      const body = JSON.parse(request.postData() ?? '{}') as SendBody;
      posts.push(body);
      const key = body.clientMessageId ?? `unkeyed-${posts.length}`;
      let row = ledger.get(key);
      if (row === undefined) {
        row = {
          id: `m${messages.length + 1}`,
          role: 'user',
          content: body.content,
          createdAt: 20 + messages.length,
        };
        messages.push(row);
        ledger.set(key, row);
      }
      return json({ thread: THREAD, message: row }, 201);
    }
    if (path === '/api/teams') return json([TEAM]);
    if (path === '/api/projects') return json([PROJECT]);
    if (path === '/api/user/me') return json(USER);
    if (path === '/api/teams/t1/notifications') return json({ unreadThreadIds: [] });
    if (path === '/api/teams/t1/chief/threads') return json([THREAD]);
    if (path === '/api/teams/t1/chief')
      return json({
        chief: {
          id: THREAD.chiefId,
          userId: 'u1',
          teamId: 't1',
          agent: { agentId: 'agent-1' },
          lastTurnAt: null,
          createdAt: 0,
          tz: null,
        },
        agentActor: AGENT,
        context: null,
        watches: [],
        wakes: [],
        outage: null,
      });
    if (path === '/api/conversations/chief-home/messages') return json({ messages: [...messages] });
    if (path === '/api/teams/t1/machines')
      return json([{ id: 'm-ready', name: 'omarchy', online: true }]);
    if (path === '/api/teams/t1/providers')
      return json({ presets: [], providers: [{ id: 'p-ready', providerId: 'r3-gw', label: 'r3-gw' }] });
    if (path === '/api/teams/t1/routing-settings') return json({ rules: [], policies: [] });
    return json([]);
  });
  return { state, posts, ledger };
}

const composer = (page: Page) => page.getByTestId('home-c').getByTestId('chief-composer-input');
const bubbles = (page: Page) => page.getByTestId('home-c').getByTestId('chief-bubble');
const sending = (page: Page) => page.getByTestId('home-c').locator('[data-delivery="sending"]');

test('a send pressed while the server is down is held pending and goes out once on reconnect', async ({
  page,
}) => {
  const { state, posts, ledger } = await mockCoordinatorWithOutage(page);
  await page.goto('/app');
  await expect(bubbles(page)).toHaveCount(1);

  state.up = false;
  const full = '用你自己的电脑跑一下 uptime 命令，把输出原件告诉我，不要建任务。';
  await composer(page).fill(full);
  await composer(page).press('Enter');

  await expect(composer(page)).toHaveValue('');
  await expect(sending(page)).toHaveText(full);
  await expect(page.getByText('发送失败，请重试。')).toHaveCount(0);

  await composer(page).fill('接着补充的第二句');
  await expect(composer(page)).toHaveValue('接着补充的第二句');

  state.up = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  await expect(bubbles(page).filter({ hasText: full })).toHaveCount(1);
  await expect(sending(page)).toHaveCount(0);
  await expect(composer(page)).toHaveValue('接着补充的第二句');
  expect(ledger.size).toBe(1);
  expect(posts.filter((post) => post.content === full)).toHaveLength(1);
});

test('a draft typed across a server restart survives the reconnect word for word', async ({
  page,
}) => {
  const { state } = await mockCoordinatorWithOutage(page);
  await page.goto('/app');
  await expect(composer(page)).toBeEditable();

  await composer(page).fill('用你自己的电脑跑一下');
  state.up = false;
  await composer(page).fill('用你自己的电脑跑一下 uptime 命令，把输出原件告诉我，不要建任务。');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const full = '用你自己的电脑跑一下 uptime 命令，把输出原件告诉我，不要建任务。';
  await expect(composer(page)).toHaveValue(full);

  state.up = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(composer(page)).toHaveValue(full);
  await composer(page).press('Enter');
  await expect(bubbles(page).filter({ hasText: full })).toHaveCount(1);
  await expect(composer(page)).toHaveValue('');
});