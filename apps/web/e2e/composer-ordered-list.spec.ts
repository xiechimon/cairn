import { expect, type Page, test } from '@playwright/test';

const TEAM_ID = 'team-1';
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };

const CARD_ID = 'todo-1';
const BUILD_ID = 'build-1';
const PROJECT_ID = 'proj-1';

const WIRE_CARD = {
  id: CARD_ID,
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: '有序列表退格探针',
  spec: '',
  phase: 'building',
  phaseAt: 0,
  seqNum: 9,
  orderIndex: 0,
  assignment: null,
  agent: null,
  latestBuildId: BUILD_ID,
  lastRunAt: 0,
  hasChanges: false,
  hasPlan: true,
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
  withPlan: true,
  prevPhase: null,
  triggerSource: 'user',
  planDocId: null,
  errorMessage: null,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: 0,
};

const EMPTY_CONVERSATION = {
  messages: [],
  chips: null,
  historyEpoch: 0,
  steerPending: [],
  activeRun: null,
  nextCursor: null,
};

async function openDetail(page: Page) {
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route, request) => {
      if (request.method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
    },
  );
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route(`**/api/teams/${TEAM_ID}/notifications`, (route) =>
    route.fulfill({ json: { unreadThreadIds: [] } }),
  );
  await page.route('**/api/skills*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [WIRE_CARD] }));
  await page.route(`**/api/todos/${CARD_ID}`, (route) => route.fulfill({ json: WIRE_CARD }));
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route(`**/api/builds/${BUILD_ID}`, (route) => route.fulfill({ json: WIRE_BUILD }));
  await page.route(`**/api/builds/${BUILD_ID}/steps`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/plans`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/usage`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/changes`, (route) =>
    route.fulfill({ json: { files: [] } }),
  );
  await page.route(
    new RegExp(`/api/(conversations/${BUILD_ID}|todos/[^/?]+)/messages(\\?|$)`),
    (route, request) => {
      if (request.method() !== 'POST') return route.fulfill({ json: EMPTY_CONVERSATION });
      return route.fulfill({ status: 201, json: { message: { id: 'msg-1' } } });
    },
  );
  await page.goto(`/app/todo/${CARD_ID}`);
  const input = page.locator('[data-testid="composer-card"] textarea');
  await expect(input).toBeVisible();
  await expect(input).toBeEditable();
  return { input };
}

function caret(input: ReturnType<Page['locator']>, at: number) {
  return input.evaluate((el: HTMLTextAreaElement, pos) => el.setSelectionRange(pos, pos), at);
}

test('Shift+Enter continues the list and one Backspace removes the whole marker', async ({
  page,
}) => {
  const { input } = await openDetail(page);

  await input.fill('1. 你好');
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('1. 你好\n2. ');

  await input.press('Backspace');
  await expect(input).toHaveValue('1. 你好\n');

  await input.press('Backspace');
  await expect(input).toHaveValue('1. 你好');
});

test('Backspace right after a non-empty marker lifts the marker and keeps the text', async ({
  page,
}) => {
  const { input } = await openDetail(page);

  await input.fill('1. a\n2. b');
  await caret(input, 8);
  await input.press('Backspace');
  await expect(input).toHaveValue('1. a\nb');
  await expect(input).toHaveJSProperty('selectionStart', 5);
});

test('Backspace inside the marker or the content still deletes a single character', async ({
  page,
}) => {
  const { input } = await openDetail(page);

  await input.fill('1. ab');
  await caret(input, 2);
  await input.press('Backspace');
  await expect(input).toHaveValue('1 ab');

  await caret(input, 4);
  await input.press('Backspace');
  await expect(input).toHaveValue('1 a');
});
