import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';

const TEAM_ID = 'team-1';
const AGENT_ID = 'agent-1';
const CARD_ID = 'todo-1';
const BUILD_ID = 'build-1';
const PROJECT_ID = 'proj-1';

const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };

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
  title: '合并可见化探针',
  spec: '',
  phase: 'review',
  phaseAt: Date.now(),
  seqNum: 9,
  orderIndex: 0,
  tagIds: [],
  assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
  agent: { id: AGENT_ID, displayName: 'live-builder', avatarUrl: null },
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

async function stubBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
}

async function stubMergeSurface(page: Page, tools: string[]) {
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
  await page.route(`**/api/builds/${BUILD_ID}/changes`, (route) =>
    route.fulfill({ json: { files: [] } }),
  );
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

async function openBoardAccept(page: Page, tools: string[]) {
  await stubBoot(page);
  await stubMergeSurface(page, tools);
  await page.goto('/app?view=board');
  const card = page.locator(`.todo-card[data-todo-id="${CARD_ID}"]`);
  await expect(card).toBeVisible();
  await card.locator('.todo-card-action').click();
  return page.getByRole('dialog', { name: '完成任务' });
}

async function openDetailAccept(page: Page, tools: string[]) {
  await stubBoot(page);
  await stubMergeSurface(page, tools);
  await page.goto(`/app/todo/${CARD_ID}`);
  const action = page.locator('.detail-head-action');
  await expect(action).toBeVisible();
  await action.click();
  return page.getByRole('dialog', { name: '完成任务' });
}

const BLOCK_COPY = '缺少「推送分支」授权，无法合并。请在该 Agent 的权限里开启。';

const BLOCK_NOTE = /授权，无法合并/;

test('board entry: completion button disabled and names the missing item when the executing Agent lacks `推送分支`', async ({ page }) => {
  const dialog = await openBoardAccept(page, ['合并分支']);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '完成' })).toBeDisabled();
  await expect(page.getByText(BLOCK_NOTE)).toHaveText(BLOCK_COPY);
  await evidenceShot(page, 'XMON-89-board-blocked.png');
});

test('detail entry: the same Agent disabled and naming the missing item on the same sheet', async ({ page }) => {
  const dialog = await openDetailAccept(page, ['合并分支']);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '完成' })).toBeDisabled();
  await expect(page.getByText(BLOCK_NOTE)).toHaveText(BLOCK_COPY);
  await evidenceShot(page, 'XMON-89-detail-blocked.png');
});

test('when both items are missing in a non-empty authorization set, both entries are named', async ({ page }) => {
  await openBoardAccept(page, ['远程 shell']);
  await expect(page.getByText(BLOCK_NOTE)).toHaveText(
    '缺少「合并分支、推送分支」授权，无法合并。请在该 Agent 的权限里开启。',
  );
});

test('empty authorization set still blocks (#994): explicit all-off = zero authorizations, both entries disabled and name both items', async ({ page }) => {

  const board = await openBoardAccept(page, []);
  await expect(board.getByRole('button', { name: '完成' })).toBeDisabled();
  await expect(page.getByText(BLOCK_NOTE)).toHaveText(
    '缺少「合并分支、推送分支」授权，无法合并。请在该 Agent 的权限里开启。',
  );
  await evidenceShot(page, '994-empty-tools-board-blocked.png');

  const detail = await openDetailAccept(page, []);
  await expect(detail.getByRole('button', { name: '完成' })).toBeDisabled();
  await expect(page.getByText(BLOCK_NOTE)).toHaveText(
    '缺少「合并分支、推送分支」授权，无法合并。请在该 Agent 的权限里开启。',
  );
  await evidenceShot(page, '994-empty-tools-detail-blocked.png');
});

test('with both items on: no blocking, completion button clickable, no missing-item hint', async ({ page }) => {
  const dialog = await openBoardAccept(page, ['合并分支', '推送分支']);
  await expect(dialog.getByRole('button', { name: '完成' })).toBeEnabled();
  await expect(page.getByText(BLOCK_NOTE)).toHaveCount(0);
});

test('board entry: server really rejects (403) → the sheet stays open, server copy shown verbatim', async ({ page }) => {
  await openBoardAccept(page, ['合并分支', '推送分支']);
  const reject = '缺少「推送分支」授权，合并被拒绝。';
  let merges = 0;
  await page.route(`**/api/builds/${BUILD_ID}/merge`, (route) => {
    merges += 1;
    return route.fulfill({ status: 403, json: { error: reject } });
  });

  const dialog = page.getByRole('dialog', { name: '完成任务' });
  await dialog.getByRole('button', { name: '完成' }).click();

  await expect.poll(() => merges).toBe(1);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveText(reject);
  await evidenceShot(page, 'XMON-89-board-403.png');
});

test('merge success (202) → the sheet closes as usual, no error row left', async ({ page }) => {
  await openBoardAccept(page, ['合并分支', '推送分支']);
  let merges = 0;
  await page.route(`**/api/builds/${BUILD_ID}/merge`, (route) => {
    merges += 1;
    return route.fulfill({ status: 202, json: { delegated: true } });
  });

  const dialog = page.getByRole('dialog', { name: '完成任务' });
  await dialog.getByRole('button', { name: '完成' }).click();
  await expect.poll(() => merges).toBe(1);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});