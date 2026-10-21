import { expect, type Locator, type Page, test } from '@playwright/test';
import { evidencePanelShot, evidenceShot } from './evidence';

// #1423: a queued task (started, waiting for a free machine) has no primary
// action. It sits in IN_PROGRESS_PHASES beside planning / building, which
// carry no button either: the server pushes the next phase. The detail
// transcript's 排队中 row says what it waits for; a held card (here 等机器)
// also says so in its meta. Live face, no
// ?scenario=: the queued phase only exists on the live data path, and
// page.route answers it (stubLiveBoot discipline from schedules-live.spec.ts).
// Failure modes pinned here:
//   1. the queued detail header shows a 开始 button whose click does nothing;
//   2. the fix drops the 排队中 chip (#1400) or the transcript wait row;
//   3. the fix also drops the todo header's 开始;
//   4. the queued board card floats a 开始 on hover or keyboard focus;
//   5. the todo card in the same 待开始 column loses its 开始.

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const PROJECT = {
  id: 'proj-1',
  name: 'pacman',
  teamId: 'team-1',
  repoKind: 'hosted',
  repoName: 'pacman',
  githubRepo: null,
  localPath: null,
};

// A minute ago, so the card and the wait row read like a real task.
const STARTED_AT = Date.now() - 60_000;

const QUEUED_ID = 'todo-queued';
const FRESH_ID = 'todo-fresh';
const BUILD_ID = 'build-queued';

function wireTodo(id: string, phase: string, seqNum: number) {
  const queued = phase === 'queued';
  return {
    id,
    teamId: 'team-1',
    projectId: 'proj-1',
    title: queued ? '排队探针' : '待开始探针',
    spec: '',
    phase,
    phaseAt: STARTED_AT,
    seqNum,
    orderIndex: seqNum,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: queued ? BUILD_ID : null,
    lastRunAt: null,
    hasChanges: false,
    hasPlan: false,
    buildHistory: queued ? [{ buildId: BUILD_ID, createdAt: STARTED_AT }] : [],
    sourceTodo: null,
    ...(queued ? { waitingOn: { on: 'machine', retryAt: null } } : {}),
    v: 1,
  };
}

const QUEUED = wireTodo(QUEUED_ID, 'queued', 11);
const FRESH = wireTodo(FRESH_ID, 'todo', 12);

const BUILD = {
  id: BUILD_ID,
  todoId: QUEUED_ID,
  withPlan: false,
  prevPhase: null,
  triggerSource: 'user',
  planDocId: null,
  errorMessage: null,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: STARTED_AT,
};

// The pending first step with the #1108 queue projection: no machine online.
const PENDING_STEP = {
  id: 'step-queued',
  buildId: BUILD_ID,
  kind: 'plan',
  machineId: null,
  createdAt: STARTED_AT,
  status: 'pending',
  checkpointCommit: null,
  skillInjection: null,
  queue: { position: 1, waitingFor: null, blocked: { kind: 'machine-offline', missing: [] } },
};

async function stubLiveBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [QUEUED, FRESH] }));
  await page.route(`**/api/todos/${QUEUED_ID}`, (route) => route.fulfill({ json: QUEUED }));
  await page.route(`**/api/todos/${FRESH_ID}`, (route) => route.fulfill({ json: FRESH }));
  await page.route(`**/api/builds/${BUILD_ID}`, (route) => route.fulfill({ json: BUILD }));
  await page.route(`**/api/builds/${BUILD_ID}/steps`, (route) =>
    route.fulfill({ json: [PENDING_STEP] }),
  );
}

/** Let hover transitions finish before an evidence shot. */
async function settle(locator: Locator) {
  await locator.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))),
  );
}

test.beforeEach(async ({ page }) => {
  await stubLiveBoot(page);
});

test('detail: a queued task has no 开始, keeps 排队中 and the wait row', async ({ page }) => {
  await page.goto(`/app/todo/${QUEUED_ID}`);
  const head = page.getByTestId('detail-head');
  await expect(head.getByTestId('phase-chip')).toHaveText('排队中');
  await expect(page.getByTestId('live-row')).toContainText('排队中：等机器上线');
  await evidenceShot(page, 'detail-queued.png');
  await evidencePanelShot(page, 'detail-queued-head.png', head, 8);
  await expect(head.getByRole('button', { name: '开始', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始', exact: true })).toHaveCount(0);
});

test('detail: a todo task keeps its 开始', async ({ page }) => {
  await page.goto(`/app/todo/${FRESH_ID}`);
  const head = page.getByTestId('detail-head');
  await expect(head.getByTestId('phase-chip')).toHaveText('待开始');
  await expect(head.getByRole('button', { name: '开始', exact: true })).toBeVisible();
});

test('board: the queued card renders no 开始, the todo card shows it on hover', async ({
  page,
}) => {
  await page.goto('/app');
  const column = page.locator('.board-column[data-column="todo"]');
  const queued = column.locator(`[data-todo-id="${QUEUED_ID}"]`);
  const fresh = column.locator(`[data-todo-id="${FRESH_ID}"]`);
  await expect(queued).toBeVisible();
  await expect(queued).toContainText('等机器');

  // No button in the DOM at all, so neither hover nor keyboard focus can show one.
  await queued.hover();
  await settle(queued);
  await evidencePanelShot(page, 'board-queued-hover.png', column);
  await expect(queued.getByRole('button', { name: '开始', exact: true })).toHaveCount(0);

  await fresh.hover();
  const start = fresh.getByRole('button', { name: '开始', exact: true });
  await expect(start).toHaveCSS('opacity', '1');
});
