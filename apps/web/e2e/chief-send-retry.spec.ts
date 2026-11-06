import { expect, type Page, test } from '@playwright/test';

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

async function mockCoordinator(page: Page, dropFirstResponse: boolean) {
  const messages: Row[] = [{ id: 'm1', role: 'user', content: 'Earlier note', createdAt: 10 }];
  const ledger = new Map<string, Row>();
  const posts: SendBody[] = [];
  let dropped = !dropFirstResponse;
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
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/conversations/chief-home/messages' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}') as SendBody;
      posts.push(body);
      const key = body.clientMessageId ?? `unkeyed-${posts.length}`;
      let row = ledger.get(key);
      if (row === undefined) {
        row = { id: `m${messages.length + 1}`, role: 'user', content: body.content, createdAt: 20 + messages.length };
        messages.push(row);
        ledger.set(key, row);
      }
      if (!dropped) {
        dropped = true;
        return route.abort('connectionreset');
      }
      return json({ thread: THREAD, message: row }, 201);
    }
    if (path === '/api/teams') return json([TEAM]);
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
          charter: null,
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
    if (path === '/api/conversations/chief-home/messages') return json({ messages });
    return json([]);
  });
  return { posts, ledger };
}

const composer = (page: Page) => page.getByTestId('home-c').getByTestId('chief-composer-input');
const bubbles = (page: Page) => page.getByTestId('home-c').getByTestId('chief-bubble');

test('a send whose response is lost is retried with the same client message id and shows one message', async ({
  page,
}) => {
  const { posts, ledger } = await mockCoordinator(page, true);
  await page.goto('/app');
  await expect(bubbles(page)).toHaveCount(1);
  await composer(page).fill('Retry me');
  await composer(page).press('Enter');
  await expect.poll(() => posts.length).toBe(1);
  await expect(page.getByText('发送失败，请重试。')).toBeVisible();
  await expect(composer(page)).toHaveValue('Retry me');
  await composer(page).press('Enter');
  await expect.poll(() => posts.length).toBe(2);
  const [first, second] = posts;
  expect(first?.clientMessageId).toEqual(expect.any(String));
  expect(second?.clientMessageId).toBe(first?.clientMessageId);
  expect(ledger.size).toBe(1);
  await expect(bubbles(page)).toHaveCount(2);
  await expect(bubbles(page).filter({ hasText: 'Retry me' })).toHaveCount(1);
  await expect(composer(page)).toHaveValue('');
});

test('a new send after a delivered one gets a fresh client message id even with identical text', async ({
  page,
}) => {
  const { posts, ledger } = await mockCoordinator(page, false);
  await page.goto('/app');
  await expect(bubbles(page)).toHaveCount(1);
  await composer(page).fill('Same words');
  await composer(page).press('Enter');
  await expect(bubbles(page)).toHaveCount(2);
  await composer(page).fill('Same words');
  await composer(page).press('Enter');
  await expect(bubbles(page)).toHaveCount(3);
  expect(posts).toHaveLength(2);
  expect(posts[0]?.clientMessageId).not.toBe(posts[1]?.clientMessageId);
  expect(ledger.size).toBe(2);
});
