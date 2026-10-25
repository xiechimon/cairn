import { expect, type Page, test } from '@playwright/test';

const TEAM_ID = 'team-1';
const FLOW_ID = 'todo-flow-1';
const BUILD_ID = 'build-flow-1';

const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: 'Xmon Dai', avatarUrl: null };

const SPEC_FLOW = [
  '# 任务简报',
  '',
  '用户原话与补充说明。'.repeat(20),
  '',
  'https://example.com/' + 's'.repeat(120),
].join('\n');

const URL200 = 'https://example.com/' + 'x'.repeat(200);

function wireTodo() {
  return {
    id: FLOW_ID,
    teamId: TEAM_ID,
    projectId: 'proj-1',
    title: '随流简报卡探测任务',
    spec: SPEC_FLOW,
    phase: 'building',
    phaseAt: 0,
    seqNum: 18,
    orderIndex: 0,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: BUILD_ID,
    lastRunAt: null,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [],
    sourceTodo: null,
    v: 1,
  };
}

function wireMessages() {
  const rows = [];
  for (let i = 0; i < 30; i++) {
    rows.push({
      id: `m-${i}`,
      role: 'assistant',
      content: i === 15 ? `本轮输出见 ${URL200}` : `第 ${i + 1} 轮进展播报：正文内容在此展开。`,
      createdAt: 1000 + i,
    });
  }
  return {
    messages: rows,
    chips: [],
    historyEpoch: 0,
    steerPending: [],
    activeRun: null,
    nextCursor: null,
  };
}

async function stubFlow(page: Page) {
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  const todo = wireTodo();
  await page.route('**/api/**', (route, request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === 'GET') {
      if (path === '/api/teams') return route.fulfill(json([TEAM]));
      if (path === '/api/user/me') return route.fulfill(json(USER));
      if (path === '/api/projects') {
        return route.fulfill(
          json([{ id: 'proj-1', name: 'alpha', teamId: TEAM_ID, repoKind: 'hosted' }]),
        );
      }
      if (path === '/api/todos') return route.fulfill(json([todo]));
      if (path === `/api/todos/${FLOW_ID}`) return route.fulfill(json(todo));
      if (path === `/api/conversations/${BUILD_ID}/messages`) {
        return route.fulfill(json(wireMessages()));
      }
      return route.fulfill(json({ error: 'e2e stub: not the surface under test' }, 500));
    }
    return route.fulfill(json({ error: 'e2e stub: not the surface under test' }, 500));
  });
}

test('1. brief card lives in the scrolling column: visible inside .chat-col, no longer a direct child of .detail-center', async ({
  page,
}) => {
  await stubFlow(page);
  await page.goto(`/app/todo/${FLOW_ID}`);
  const inside = page.locator('.chat-col .spec-block');
  await expect(inside).toBeVisible();
  await expect(page.locator('.detail-center > .spec-block')).toHaveCount(0);
});

test('2. brief card scrolls away with the flow: out of the viewport at the bottom, back to the column top at the top', async ({ page }) => {
  await stubFlow(page);
  await page.goto(`/app/todo/${FLOW_ID}`);
  const list = page.locator('.chat-col');
  const spec = page.locator('.chat-col .spec-block');
  await expect(spec).toBeAttached();
  const chatTop = (await list.boundingBox())!.y;

  await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  const bottomTop = await spec.evaluate((el) => el.getBoundingClientRect().top);
  expect(bottomTop).toBeLessThan(chatTop);

  await list.evaluate((el) => el.scrollTo({ top: 0 }));
  const topTop = await spec.evaluate((el) => el.getBoundingClientRect().top);
  expect(topTop).toBeGreaterThanOrEqual(chatTop - 1);
  expect(Math.abs(topTop - bottomTop)).toBeGreaterThan(200);
});

test('3. extra-long unbreakable lines wrap into the middle column: chat horizontal scrollWidth equals clientWidth', async ({ page }) => {
  await stubFlow(page);
  await page.goto(`/app/todo/${FLOW_ID}`);
  const metrics = await page.locator('.chat-col').evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(metrics.scrollWidth).toBe(metrics.clientWidth);
});
