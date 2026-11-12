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
  path?: string;
}

async function mockCoordinator(
  page: Page,
  dropFirstResponse: boolean,
  options: { readDelay?: number; postDelay?: number; rejectFirst?: boolean; firstThread?: boolean } = {},
) {
  const { readDelay = 0, postDelay = 0, rejectFirst = false, firstThread = false } = options;
  const messages: Row[] = firstThread ? [] : [{ id: 'm1', role: 'user', content: 'Earlier note', createdAt: 10 }];
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
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if ((path === '/api/conversations/chief-home/messages' || path === '/api/teams/t1/chief/threads') && request.method() === 'POST') {
      const body = { ...(JSON.parse(request.postData() ?? '{}') as SendBody), path };
      posts.push(body);
      if (postDelay > 0) await new Promise((resolve) => setTimeout(resolve, postDelay));
      if (rejectFirst && posts.length === 1) return json({ error: 'Submission refused' }, 503);
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
    if (path === '/api/teams/t1/chief/threads') {
      if (firstThread && posts.length === 0) return json([]);
      if (readDelay > 0 && posts.length > 0) await new Promise((resolve) => setTimeout(resolve, readDelay));
      return json([THREAD]);
    }
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
    if (path === '/api/conversations/chief-home/messages') {
      const snapshot = [...messages];
      if (posts.length > 0 && readDelay > 0) await new Promise((resolve) => setTimeout(resolve, readDelay));
      return json({ messages: snapshot });
    }
    if (path === '/api/teams/t1/machines') return json([{ id: 'm-ready', name: 'omarchy', online: true }]);
    if (path === '/api/teams/t1/providers') {
      return json({ presets: [], providers: [{ id: 'p-ready', providerId: 'r3-gw', label: 'r3-gw' }] });
    }
    return json([]);
  });
  return { posts, ledger };
}

const composer = (page: Page) => page.getByTestId('home-c').getByTestId('chief-composer-input');
const bubbles = (page: Page) => page.getByTestId('home-c').getByTestId('chief-bubble');

test('a confirmed send is visible without waiting for a slow transcript read or an agent', async ({ page }) => {
  await mockCoordinator(page, false, { readDelay: 3000 });
  await page.goto('/app');
  await expect(bubbles(page)).toHaveCount(1);
  await composer(page).fill('Show my confirmed message now');
  await composer(page).press('Enter');
  await expect(bubbles(page).filter({ hasText: 'Show my confirmed message now' })).toBeVisible({ timeout: 700 });
});

test('the first confirmed message does not wait for slow thread discovery', async ({ page }) => {
  await mockCoordinator(page, false, { firstThread: true, readDelay: 3000 });
  await page.goto('/app');
  await expect(composer(page)).toBeEditable();
  await composer(page).fill('First confirmed message');
  await composer(page).press('Enter');
  await expect(bubbles(page).filter({ hasText: 'First confirmed message' })).toBeVisible({ timeout: 700 });
});

const sending = (page: Page) => page.getByTestId('home-c').locator('[data-delivery="sending"]');

test('a sent message shows at once and dimmed, and the composer clears before the server answers', async ({
  page,
}) => {
  const { posts } = await mockCoordinator(page, false, { postDelay: 1500 });
  await page.goto('/app');
  await expect(bubbles(page)).toHaveCount(1);
  await composer(page).fill('Show me before the server answers');
  await composer(page).press('Enter');
  await expect(sending(page)).toHaveText('Show me before the server answers', { timeout: 700 });
  await expect(composer(page)).toHaveValue('', { timeout: 700 });
  await composer(page).press('Enter');
  await expect(sending(page)).toHaveCount(0);
  await expect(bubbles(page).filter({ hasText: 'Show me before the server answers' })).toHaveCount(1);
  expect(posts).toHaveLength(1);
});

test('a rejected send returns the text to the composer, and sending it again reuses the client message id', async ({
  page,
}) => {
  const { posts, ledger } = await mockCoordinator(page, false, { rejectFirst: true });
  await page.goto('/app');
  await expect(bubbles(page)).toHaveCount(1);
  await composer(page).fill('Do not lose this message');
  await composer(page).press('Enter');
  await expect(page.getByText('发送失败，请重试。')).toBeVisible();
  await expect(composer(page)).toHaveValue('Do not lose this message');
  await expect(bubbles(page)).toHaveCount(1);
  expect(ledger.size).toBe(0);
  await composer(page).press('Enter');
  await expect(bubbles(page).filter({ hasText: 'Do not lose this message' })).toHaveCount(1);
  await expect(composer(page)).toHaveValue('');
  await expect(sending(page)).toHaveCount(0);
  expect(posts).toHaveLength(2);
  expect(posts[1]?.clientMessageId).toBe(posts[0]?.clientMessageId);
  expect(ledger.size).toBe(1);
});

test('a send whose response is lost is sent again with the same client message id and shows one message', async ({
  page,
}) => {
  const { posts, ledger } = await mockCoordinator(page, true);
  await page.goto('/app');
  await expect(bubbles(page)).toHaveCount(1);
  await composer(page).fill('Retry me');
  await composer(page).press('Enter');
  await expect(composer(page)).toHaveValue('Retry me');
  await composer(page).press('Enter');
  await expect.poll(() => posts.length).toBe(2);
  const [first, second] = posts;
  expect(first?.clientMessageId).toEqual(expect.any(String));
  expect(second?.clientMessageId).toBe(first?.clientMessageId);
  expect(ledger.size).toBe(1);
  await expect(composer(page)).toHaveValue('');
  await expect(bubbles(page)).toHaveCount(2);
  await expect(bubbles(page).filter({ hasText: 'Retry me' })).toHaveCount(1);
});

test('a returned message that is edited is sent under a new client message id', async ({ page }) => {
  const { posts } = await mockCoordinator(page, false, { rejectFirst: true });
  await page.goto('/app');
  await expect(bubbles(page)).toHaveCount(1);
  await composer(page).fill('Fix my typo');
  await composer(page).press('Enter');
  await expect(composer(page)).toHaveValue('Fix my typo');
  await expect(bubbles(page)).toHaveCount(1);
  await composer(page).fill('Fixed my typo');
  await composer(page).press('Enter');
  await expect(bubbles(page).filter({ hasText: 'Fixed my typo' })).toHaveCount(1);
  expect(posts).toHaveLength(2);
  expect(posts[1]?.clientMessageId).not.toBe(posts[0]?.clientMessageId);
});

test('text typed after sending is kept when that send fails', async ({ page }) => {
  await mockCoordinator(page, false, { rejectFirst: true, postDelay: 600 });
  await page.goto('/app');
  await expect(bubbles(page)).toHaveCount(1);
  await composer(page).fill('Sent first');
  await composer(page).press('Enter');
  await expect(sending(page)).toHaveText('Sent first');
  await composer(page).fill('Typed while it was sending');
  await expect(page.getByText('发送失败，请重试。')).toBeVisible();
  await expect(composer(page)).toHaveValue('Typed while it was sending\nSent first');
  await expect(bubbles(page)).toHaveCount(1);
});

test('messages sent back to back are posted one at a time, in the order they were sent', async ({
  page,
}) => {
  const { posts } = await mockCoordinator(page, false, { postDelay: 600 });
  await page.goto('/app');
  await expect(bubbles(page)).toHaveCount(1);
  await composer(page).fill('First of two');
  await composer(page).press('Enter');
  await expect(composer(page)).toHaveValue('');
  await composer(page).fill('Second of two');
  await composer(page).press('Enter');
  await expect(sending(page)).toHaveCount(2);
  expect(posts).toHaveLength(1);
  await expect(sending(page)).toHaveCount(0);
  await expect(bubbles(page)).toHaveText(['Earlier note', 'First of two', 'Second of two']);
  expect(posts.map((post) => post.content)).toEqual(['First of two', 'Second of two']);
});

test('a second message sent while the first one is still creating the conversation joins it', async ({
  page,
}) => {
  const { posts } = await mockCoordinator(page, false, { firstThread: true, postDelay: 600 });
  await page.goto('/app');
  await expect(composer(page)).toBeEditable();
  await composer(page).fill('Opening message');
  await composer(page).press('Enter');
  await expect(composer(page)).toHaveValue('');
  await composer(page).fill('Follow-up message');
  await composer(page).press('Enter');
  await expect(bubbles(page)).toHaveText(['Opening message', 'Follow-up message']);
  await expect(sending(page)).toHaveCount(0);
  expect(posts.map((post) => post.path)).toEqual([
    '/api/teams/t1/chief/threads',
    '/api/conversations/chief-home/messages',
  ]);
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
