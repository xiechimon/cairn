import { expect, type Page, type Route, test } from '@playwright/test';

// #1313：review 卡只有空提交（hasChanges 仍为真，因为 countAhead>0，但已上报的
// diff 文件集为空）时，「完成」不得再强制合并、也不得因缺合并授权而禁用。
// 有文件改动的卡照旧走合并勾选 + 缺授权禁用。changes 未带 reported 的旧响应
// 不能被当成空提交（否则没上报的卡会悄悄跳过合并）。

const TEAM_ID = 'team-1';
const AGENT_ID = 'agent-1';
const CARD_ID = 'todo-1';
const BUILD_ID = 'build-1';
const PROJECT_ID = 'proj-1';

const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const MERGE_LABEL = '将改动合并到默认分支';
const EMPTY_NOTE = '本轮没有文件改动，完成不会合并分支。';

function agentMember(tools: string[]) {
  return {
    id: `member-${AGENT_ID}`,
    teamId: TEAM_ID,
    actorId: AGENT_ID,
    memberType: 'agent',
    actor: {
      id: AGENT_ID,
      displayName: 'live-builder',
      description: null,
      status: 'active',
      avatarUrl: null,
      provider: null,
      modelId: 'claude-sonnet-5',
      thinkingLevel: null,
      tools,
      secrets: [],
      defaultSkill: null,
      skillsAllowlist: null,
      mcpServers: [],
    },
  };
}

const WIRE_CARD = {
  id: CARD_ID,
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: '空提交收口',
  spec: '',
  phase: 'review',
  phaseAt: 0,
  seqNum: 9,
  orderIndex: 0,
  tagIds: [],
  assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
  agent: { id: AGENT_ID, displayName: 'live-builder', avatarUrl: null },
  latestBuildId: BUILD_ID,
  lastRunAt: 0,
  hasChanges: true,
  hasPlan: false,
  buildHistory: [],
  sourceTodo: null,
  v: 1,
};

const PROJECT = {
  id: PROJECT_ID,
  name: 'pacman',
  teamId: TEAM_ID,
  repoKind: 'github',
  repoName: null,
  githubRepo: 'octocat/Hello-World',
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

const FILE_DIFF = {
  path: 'README.md',
  additions: 1,
  deletions: 0,
  hunks: [{ header: '@@ -1 +1 @@', lines: ['-old', '+new'] }],
};

async function stubBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
}

async function stubSurface(
  page: Page,
  changes: { files: unknown[]; reported?: boolean; changed?: boolean },
  tools: string[],
) {
  await page.route(`**/api/teams/${TEAM_ID}/members`, (route) =>
    route.fulfill({
      json: [
        { id: 'member-user', teamId: TEAM_ID, actorId: USER.id, memberType: 'user', actor: USER },
        agentMember(tools),
      ],
    }),
  );
  await page.route(`**/api/teams/${TEAM_ID}/notifications`, (route) =>
    route.fulfill({ json: { unreadThreadIds: [] } }),
  );
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [WIRE_CARD] }));
  await page.route(`**/api/todos/${CARD_ID}`, (route) => route.fulfill({ json: WIRE_CARD }));
  await page.route('**/api/projects', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route(`**/api/builds/${BUILD_ID}`, (route) => route.fulfill({ json: WIRE_BUILD }));
  await page.route(`**/api/builds/${BUILD_ID}/steps`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/plans`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/usage`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/changes`, (route) => route.fulfill({ json: changes }));
  await page.route(`**/api/conversations/${BUILD_ID}/messages`, (route) =>
    route.fulfill({
      json: {
        messages: [],
        chips: null,
        historyEpoch: 0,
        steerPending: [],
        activeRun: null,
        nextCursor: null,
      },
    }),
  );
}

async function openBoard(page: Page) {
  await page.goto('/app');
  const card = page.locator(`.todo-card[data-todo-id="${CARD_ID}"]`);
  await expect(card).toBeVisible();
  await card.locator('.todo-card-action').click();
  const dialog = page.getByRole('dialog', { name: '完成任务' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openDetail(page: Page) {
  await page.goto(`/app/todo/${CARD_ID}`);
  const action = page.locator('.detail-head-action');
  await expect(action).toBeVisible();
  await action.click();
  const dialog = page.getByRole('dialog', { name: '完成任务' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('看板：已上报空 diff 的 review 卡完成不合并、不拦授权', async ({ page }) => {
  await stubBoot(page);
  await stubSurface(page, { files: [], reported: true }, ['推送分支']);
  let merges = 0;
  let donePhase: string | null = null;
  await page.route(`**/api/builds/${BUILD_ID}/merge`, (route) => {
    merges += 1;
    return route.fulfill({ status: 202, json: { delegated: true } });
  });
  await page.route(`**/api/todos/${CARD_ID}`, async (route: Route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON() as { phase?: string };
    donePhase = body.phase ?? null;
    return route.fulfill({ json: { ...WIRE_CARD, phase: body.phase ?? 'done' } });
  });

  const dialog = await openBoard(page);
  await expect(dialog.getByText(MERGE_LABEL)).toHaveCount(0);
  await expect(dialog.getByText(EMPTY_NOTE)).toBeVisible();
  await expect(dialog.getByText(/授权，无法合并/)).toHaveCount(0);
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(merges).toBe(0);
  expect(donePhase).toBe('done');
});

test('详情：已上报空 diff 的 review 卡同样不展示合并行且完成可点', async ({ page }) => {
  await stubBoot(page);
  await stubSurface(page, { files: [], reported: true }, ['推送分支']);
  const dialog = await openDetail(page);
  await expect(dialog.getByText(MERGE_LABEL)).toHaveCount(0);
  await expect(dialog.getByText(EMPTY_NOTE)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '完成', exact: true })).toBeEnabled();
});

test('有文件改动的卡仍展示合并行，缺授权时完成禁用', async ({ page }) => {
  await stubBoot(page);
  await stubSurface(page, { files: [FILE_DIFF], reported: true }, ['推送分支']);
  const dialog = await openBoard(page);
  await expect(dialog.getByText(MERGE_LABEL)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '完成', exact: true })).toBeDisabled();
  await expect(dialog.getByText(/授权，无法合并/)).toHaveText(
    '缺少「合并分支」授权，无法合并。请在该 Agent 的权限里开启。',
  );
});

test('git 仍有文件头但解析文件集为空时不跳过合并', async ({ page }) => {
  await stubBoot(page);
  await stubSurface(page, { files: [], reported: true, changed: true }, ['推送分支']);
  const dialog = await openBoard(page);
  await expect(dialog.getByText(MERGE_LABEL)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '完成', exact: true })).toBeDisabled();
  await expect(dialog.getByText(EMPTY_NOTE)).toHaveCount(0);
});

test('changes 未上报（无 reported）不当成空提交，合并行与授权闸保留', async ({ page }) => {
  await stubBoot(page);
  await stubSurface(page, { files: [] }, ['推送分支']);
  const dialog = await openBoard(page);
  await expect(dialog.getByText(MERGE_LABEL)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '完成', exact: true })).toBeDisabled();
});
