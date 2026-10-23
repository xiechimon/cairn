import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';

// #701 (B-C12): review 关口人肉打回。审核闸的「人看」半边今天只能点头——
// 静息 review 态（步已收尾）composer 发送撞 steer 面 409，页面只有一行小字；
// 更多菜单没有任何打回入口。本 spec 钉住票面四条失败方式的 web 面：
//  1. 打回不挂「活跃会话」前提：静息 review 发送 = POST /builds/{id}/steps
//     {action:"revision"} 动作面（同 confirm 关口驳回形状），不再打消息面；
//  2. 输入框不留「可填不可发」：填了就能发、发出去就是打回；相位经失效键
//     重取即时翻 planning（chip 规划中）；
//  3. 「更多」菜单出现显式打回入口（请求修改 → 弹层收反馈 → 动作面）；
//     非 review 相位不渲染该行（fixture 面 DOM 字节不变的同一机制）；
//  4. 运行中（claimed 步在场）review 保持 steer 语义——打回只在静息关口，
//     不与运行面抢道；打回被拒（409 竞态）draft 逐字保留 + 提示行显性。
//
// 数据面 = live 面打桩（composer-wire-reject.spec 同纪律）：无 ?scenario=
// 即真 API 分支，被测面自带桩，其余 GET 落到 app 已容忍的 500。
//
// #951/#910 重钉：.detail-chip → phase-chip testid（断言目标即触发钮文案，
// 二级载体）；.dlg-reject → role=dialog 可及名「请求修改」一级；
// .reject-confirm → dialog scope getByRole(button 请求修改)；
// .reject-feedback-input → dialog scope getByRole(textbox)（唯一 textbox）。
// 跨批次别名钩（.composer-input/.composer-reject/.detail-head-icon--more/
// .more-menu*）终账归 #952/#953，原样保留。

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

/** 详情页桩：phase 状态化——steps 动作面受理即翻 planning，失效键重取后
 *  chip 跟着翻（SSE 失效键路径的桩等价物）。steps GET 由调用方按需覆写。 */
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

test('FM1/FM2: 静息 review 发送 = steps revision 动作面，draft 清空、chip 即时翻规划中', async ({
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

  // 打回真上了动作面 wire，且没碰消息面死路。
  await expect.poll(() => stepPosts).toBe(1);
  expect(steerPosts).toBe(0);
  expect(lastBody).toMatchObject({ action: 'revision', side: 'plan', feedback: DRAFT });
  expect(typeof lastBody?.clientMessageId).toBe('string');
  // 发送成功 = 清稿（可填即可发，不再吞字）。
  await expect(input).toHaveValue('');
  // 相位经失效键重取即时翻（chip 规划中）。
  await expect(page.getByTestId('phase-chip')).toHaveText(/规划中/);
  await evidenceShot(page, 'review-reject-composer-flip.png');
});

test('FM3: 更多菜单出现「请求修改」入口，弹层收反馈后走同一动作面', async ({ page }) => {
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
  // 弹层收反馈：必填，空稿不放行。
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

test('FM3 边界: 非 review 相位（live building）更多菜单不渲染打回行', async ({ page }) => {
  const state = { phase: 'building' };
  await stubBoot(page);
  await stubReviewDetail(page, state);
  await page.goto(`/app/todo/${CARD_ID}`);
  await page.locator('.detail-head-icon--more').click();
  await expect(page.locator('.more-menu')).toBeVisible();
  await expect(page.locator('.more-menu-item', { hasText: '请求修改' })).toHaveCount(0);
});

test('FM4: 运行中 review（claimed 步在场）发送保持 steer 语义，不抢动作面', async ({ page }) => {
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

test('FM2: 打回被拒（409 竞态）draft 逐字保留 + 提示行显性，不静默吞', async ({ page }) => {
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
