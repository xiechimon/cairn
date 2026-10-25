import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';

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
  title: '审核打回探针',
  spec: '',
  phase: 'review',
  phaseAt: 0,
  seqNum: 9,
  orderIndex: 0,
  tagIds: [],
  assignment: null,
  agent: null,
  latestBuildId: BUILD_ID,
  lastRunAt: 0,
  hasChanges: true,
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

async function stubBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route(`**/api/teams/${TEAM_ID}/notifications`, (route) =>
    route.fulfill({ json: { unreadThreadIds: [] } }),
  );
}

async function stubReviewDetail(page: Page, state: { phase: string }) {
  await page.route(`**/api/teams/${TEAM_ID}/members`, (route) =>
    route.fulfill({
      json: [
        { id: 'member-user', teamId: TEAM_ID, actorId: USER.id, memberType: 'user', actor: USER },
      ],
    }),
  );
  await page.route('**/api/todos?*', (route) =>
    route.fulfill({ json: [{ ...WIRE_CARD, phase: state.phase }] }),
  );
  await page.route(`**/api/todos/${CARD_ID}`, (route) =>
    route.fulfill({ json: { ...WIRE_CARD, phase: state.phase } }),
  );
  await page.route('**/api/projects', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route(`**/api/builds/${BUILD_ID}`, (route) => route.fulfill({ json: WIRE_BUILD }));
  await page.route(`**/api/builds/${BUILD_ID}/steps`, (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ json: [] });
  });
  await page.route(`**/api/builds/${BUILD_ID}/plans`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/usage`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/changes`, (route) =>
    route.fulfill({ json: { files: [] } }),
  );
  await page.route(`**/api/conversations/${BUILD_ID}/messages`, (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ json: EMPTY_CONVERSATION });
  });
}

const DRAFT = '关闭按钮挪到左边，文案改成「返回」';

test('FM1/FM2: idle review send = steps revision action face, draft cleared, chip flips to planning instantly', async ({
  page,
}) => {
  const state = { phase: 'review' };
  await stubBoot(page);
  await stubReviewDetail(page, state);
  let stepPosts = 0;
  let steerPosts = 0;
  let lastBody: Record<string, unknown> | null = null;
  await page.route(`**/api/builds/${BUILD_ID}/steps`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    stepPosts += 1;
    lastBody = request.postDataJSON() as Record<string, unknown>;
    state.phase = 'planning';
    return route.fulfill({ status: 202, json: { delegated: true } });
  });
  await page.route(`**/api/conversations/${BUILD_ID}/messages`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    steerPosts += 1;
    return route.fulfill({ status: 409, json: { error: 'no active step' } });
  });

  await page.goto(`/app/todo/${CARD_ID}`);
  await expect(page.getByTestId('phase-chip')).toHaveText(/审核/);
  const input = page.locator('.composer-input');
  await expect(input).toBeVisible();
  await input.fill(DRAFT);
  await input.press('Enter');

  await expect.poll(() => stepPosts).toBe(1);
  expect(steerPosts).toBe(0);
  expect(lastBody).toMatchObject({ action: 'revision', side: 'plan', feedback: DRAFT });
  expect(typeof lastBody?.clientMessageId).toBe('string');

  await expect(input).toHaveValue('');

  await expect(page.getByTestId('phase-chip')).toHaveText(/规划中/);
  await evidenceShot(page, 'review-reject-composer-flip.png');
});

test('FM3: the more menu shows the `请求修改` entry, after sheet feedback it walks the same action face', async ({ page }) => {
  const state = { phase: 'review' };
  await stubBoot(page);
  await stubReviewDetail(page, state);
  let stepPosts = 0;
  let lastBody: Record<string, unknown> | null = null;
  await page.route(`**/api/builds/${BUILD_ID}/steps`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    stepPosts += 1;
    lastBody = request.postDataJSON() as Record<string, unknown>;
    state.phase = 'planning';
    return route.fulfill({ status: 202, json: { delegated: true } });
  });

  await page.goto(`/app/todo/${CARD_ID}`);
  await page.locator('.detail-head-icon--more').click();
  const rejectItem = page.locator('.more-menu-item', { hasText: '请求修改' });
  await expect(rejectItem).toBeVisible();
  await rejectItem.click();

  const dialog = page.getByRole('dialog', { name: '请求修改' });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: '请求修改' });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('textbox').fill(DRAFT);
  await confirm.click();

  await expect.poll(() => stepPosts).toBe(1);
  expect(lastBody).toMatchObject({ action: 'revision', side: 'plan', feedback: DRAFT });
  await expect(page.getByRole('dialog', { name: '请求修改' })).toBeHidden();
  await expect(page.getByTestId('phase-chip')).toHaveText(/规划中/);
  await evidenceShot(page, 'review-reject-menu-dialog.png');
});

test('FM3 boundary: non-review phase (live building) more menu renders no reject row', async ({ page }) => {
  const state = { phase: 'building' };
  await stubBoot(page);
  await stubReviewDetail(page, state);
  await page.goto(`/app/todo/${CARD_ID}`);
  await page.locator('.detail-head-icon--more').click();
  await expect(page.locator('.more-menu')).toBeVisible();
  await expect(page.locator('.more-menu-item', { hasText: '请求修改' })).toHaveCount(0);
});

test('FM4: sending mid-run review (claimed step present) keeps steer semantics, does not steal the action face', async ({ page }) => {
  const state = { phase: 'review' };
  await stubBoot(page);
  await stubReviewDetail(page, state);
  await page.route(`**/api/builds/${BUILD_ID}/steps`, (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({
      json: [
        {
          id: 'step-review-1',
          buildId: BUILD_ID,
          kind: 'review',
          machineId: null,
          createdAt: 0,
          status: 'claimed',
          checkpointCommit: null,
        },
      ],
    });
  });
  let stepPosts = 0;
  let steerPosts = 0;
  await page.route(`**/api/builds/${BUILD_ID}/steps`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    stepPosts += 1;
    return route.fulfill({ status: 202, json: { delegated: true } });
  });
  await page.route(`**/api/conversations/${BUILD_ID}/messages`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    steerPosts += 1;
    return route.fulfill({ status: 201, json: { message: { id: 'msg-1' } } });
  });

  await page.goto(`/app/todo/${CARD_ID}`);
  const input = page.locator('.composer-input');
  await input.fill('审核时顺便看看锁文件');
  await input.press('Enter');

  await expect.poll(() => steerPosts).toBe(1);
  expect(stepPosts).toBe(0);
  await expect(input).toHaveValue('');
});

test('FM2: reject denied (409 race) keeps the draft verbatim + hint row explicit, nothing swallowed silently', async ({ page }) => {
  const state = { phase: 'review' };
  await stubBoot(page);
  await stubReviewDetail(page, state);
  let stepPosts = 0;
  await page.route(`**/api/builds/${BUILD_ID}/steps`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    stepPosts += 1;
    return route.fulfill({ status: 409, json: { error: 'illegal phase transition' } });
  });

  await page.goto(`/app/todo/${CARD_ID}`);
  const input = page.locator('.composer-input');
  await input.fill(DRAFT);
  await input.press('Enter');

  await expect.poll(() => stepPosts).toBe(1);
  await expect(input).toHaveValue(DRAFT);
  await expect(page.locator('.composer-reject')).toContainText('任务状态已变化，消息未送出');
  await evidenceShot(page, 'review-reject-409-keeps-draft.png');
});
