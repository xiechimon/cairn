import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';

const TEAM_ID = 'team-1';
const USER_ID = 'user-1';
const CARD_ID = 'todo-page-1';
const BUILD_ID = 'build-page-1';
const PROJECT_ID = 'proj-page-1';
const SPEC = 'Spec line for the paged thread';

const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: USER_ID, displayName: 'Xmon Dai', avatarUrl: null };

const WIRE_CARD = {
  id: CARD_ID,
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: 'Paged thread',
  spec: SPEC,
  phase: 'review',
  phaseAt: 0,
  seqNum: 7,
  orderIndex: 0,
  tagIds: [],
  latestBuildId: BUILD_ID,
  lastRunAt: 0,
  hasChanges: false,
  hasPlan: false,
  buildHistory: [],
  sourceTodo: null,
  v: 1,
};

const PROJECT = {
  id: PROJECT_ID,
  name: 'cairn',
  teamId: TEAM_ID,
  repoKind: 'hosted',
  repoName: 'cairn',
  githubRepo: null,
  localPath: null,
};

const WIRE_BUILD = {
  id: BUILD_ID,
  todoId: CARD_ID,
  withPlan: false,
  prevPhase: null,
  triggerSource: 'user',
  planDocId: null,
  errorMessage: null,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: 0,
};

type Row = { id: string; role: string; content: unknown; createdAt: number };

const chat = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `h-${String(i).padStart(4, '0')}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: i % 2 === 0 ? `question ${i}` : [{ type: 'text', text: `answer ${i}` }],
    createdAt: 1_000 + i * 1_000,
  }));

const hiddenTail = (from: number, count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `s-${String(i).padStart(4, '0')}`,
    role: 'system',
    content: JSON.stringify({ kind: 'merge_gate_run', rawOutput: `run ${i}` }),
    createdAt: from + i * 1_000,
  }));

function pageBefore(history: Row[], before: string | null, size = 100) {
  const end = before === null ? history.length : history.findIndex((row) => row.id === before);
  const start = Math.max(0, end - size);
  return {
    messages: history.slice(start, end),
    chips: [],
    historyEpoch: 0,
    steerPending: [],
    queuedMessages: [],
    activeRun: null,
    nextCursor: start > 0 ? (history[start]?.id ?? null) : null,
  };
}

async function openPagedThread(page: Page, history: Row[] = chat(250)) {
  const requested: (string | null)[] = [];
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/api/**', (route, request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() !== 'GET') {
      return route.fulfill(json({ error: 'e2e stub: not the surface under test' }, 500));
    }
    if (path === '/api/teams') return route.fulfill(json([TEAM]));
    if (path === '/api/user/me') return route.fulfill(json(USER));
    if (path === '/api/projects') return route.fulfill(json([PROJECT]));
    if (path === '/api/todos') return route.fulfill(json([WIRE_CARD]));
    if (path === `/api/todos/${CARD_ID}`) return route.fulfill(json(WIRE_CARD));
    if (path === `/api/teams/${TEAM_ID}/notifications`) {
      return route.fulfill(json({ unreadThreadIds: [] }));
    }
    if (path === `/api/builds/${BUILD_ID}`) return route.fulfill(json(WIRE_BUILD));
    if (path === `/api/builds/${BUILD_ID}/steps`) return route.fulfill(json([]));
    if (path === `/api/builds/${BUILD_ID}/plans`) return route.fulfill(json([]));
    if (path === `/api/builds/${BUILD_ID}/usage`) return route.fulfill(json([]));
    if (path === `/api/builds/${BUILD_ID}/changes`) return route.fulfill(json({ files: [] }));
    if (path === `/api/conversations/${BUILD_ID}/messages`) {
      const before = url.searchParams.get('before');
      requested.push(before);
      return route.fulfill(json(pageBefore(history, before)));
    }
    return route.fulfill(json({ error: 'e2e stub: not the surface under test' }, 500));
  });
  await page.goto(`/app/todo/${CARD_ID}`);
  await expect(page.getByTestId('transcript-col')).toBeVisible();
  return requested;
}

const column = (page: Page) => page.getByTestId('transcript-col');
const text = (page: Page, label: string) =>
  column(page).locator('[data-slot="message-scroller-item"]').getByText(label, { exact: true });

async function scrollToTop(page: Page) {
  await column(page).evaluate((node) => {
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
    node.scrollTop = 0;
  });
}

test('a long task thread opens on its newest page without the spec or older rows', async ({
  page,
}) => {
  const requested = await openPagedThread(page);
  await expect(text(page, 'answer 249')).toBeInViewport();
  await expect(text(page, 'question 150')).toHaveCount(1);
  await expect(text(page, 'question 148')).toHaveCount(0);
  await expect(column(page).getByText(SPEC)).toHaveCount(0);
  expect(requested).toEqual([null]);
  await evidenceShot(page, 'task-thread-opens-at-newest.png');
});

test('scrolling to the top of a task thread loads older pages until the spec appears', async ({
  page,
}) => {
  const requested = await openPagedThread(page);
  await expect(text(page, 'answer 249')).toBeInViewport();
  await scrollToTop(page);
  await expect(text(page, 'question 148')).toHaveCount(1);
  expect(requested).toEqual([null, 'h-0150']);
  await scrollToTop(page);
  await expect(text(page, 'question 0')).toHaveCount(1);
  expect(requested).toEqual([null, 'h-0150', 'h-0050']);
  await expect(column(page).getByText(SPEC)).toHaveCount(1);
});

test('a newest page with no visible rows still loads the earlier page', async ({ page }) => {
  const requested = await openPagedThread(page, [...chat(20), ...hiddenTail(100_000, 100)]);
  await expect(text(page, 'answer 19')).toHaveCount(1);
  expect(requested).toEqual([null, 's-0000']);
});
