import { expect, type Page, test } from '@playwright/test';
import { evidencePanelShot } from './evidence';

// #1434: a drop into 执行中 is a start intent (POST /api/todos/:id/orchestrate),
// and the server starts only todo / failed tasks. A queued card (started,
// waiting for a machine) must not start again; since #1447 it sits in 执行中,
// so 执行中 is its own column. Live face, no ?scenario=: startTask only fires on the live data
// path, and page.route answers it (stubWorld discipline from
// board-dnd-live.spec.ts).
// Failure modes pinned here:
//   1. 执行中 lights up as a drop target while a queued card hovers it;
//   2. releasing the queued card there sends the orchestrate POST, which
//      answers 409 and shows the 未能开始编排 toast;
//   3. the fix also stops a todo card from starting by a drop into 执行中.

const TEAM_ID = 'team-1';
const PROJECT_ID = 'proj-1434';
const QUEUED_ID = 'todo-queued-1434';
const FRESH_ID = 'todo-fresh-1434';

const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const PROJECT = {
  id: PROJECT_ID,
  name: 'cairn',
  teamId: TEAM_ID,
  repoKind: 'hosted',
  repoName: 'cairn',
  githubRepo: null,
  localPath: null,
};

// A minute ago, so the cards read like real tasks in the evidence shots.
const STARTED_AT = Date.now() - 60_000;

function wireCard(id: string, phase: string, seqNum: number) {
  const queued = phase === 'queued';
  return {
    id,
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    title: queued ? '排队探针' : '待开始探针',
    spec: '',
    phase,
    phaseAt: STARTED_AT,
    seqNum,
    orderIndex: seqNum,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: queued ? 'build-1434' : null,
    lastRunAt: null,
    hasChanges: false,
    hasPlan: false,
    buildHistory: queued ? [{ buildId: 'build-1434', createdAt: STARTED_AT }] : [],
    sourceTodo: null,
    v: 1,
  };
}

/** Boot stubs + todos list; every POST /api/todos/:id/orchestrate is recorded
 *  and answered the way the server answers it (409 for a queued task). */
async function stubWorld(page: Page): Promise<{ orchestrated: string[] }> {
  const stub = { orchestrated: [] as string[] };
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route('**/api/todos?*', (route) =>
    route.fulfill({ json: [wireCard(QUEUED_ID, 'queued', 11), wireCard(FRESH_ID, 'todo', 12)] }),
  );
  await page.route('**/api/todos/*/orchestrate', (route, request) => {
    const id = new URL(request.url()).pathname.split('/')[3] ?? '';
    stub.orchestrated.push(id);
    if (id === QUEUED_ID) {
      return route.fulfill({
        status: 409,
        json: { error: 'orchestrate 仅适用于 待开始/失败 相位（当前 queued）' },
      });
    }
    return route.fulfill({ status: 500, json: { error: 'e2e stub: orchestrate recorded' } });
  });
  return stub;
}

/** Press a card and carry it over the target column's list; leaves the
 *  button down so the caller can read the hover state, then release. */
async function dragCardOver(page: Page, cardId: string, columnListId: string): Promise<void> {
  const from = await page.locator(`[data-todo-id="${cardId}"]`).first().boundingBox();
  if (from == null) throw new Error(`card ${cardId} missing`);
  const list = await page.locator(`[data-column-list="${columnListId}"]`).boundingBox();
  if (list == null) throw new Error(`${columnListId} list missing`);
  const sx = from.x + from.width / 2;
  const sy = from.y + from.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx - 8, sy + 6, { steps: 4 });
  await page.mouse.move(list.x + list.width / 2, list.y + 60, { steps: 12 });
  await page
    .getByTestId('drag-overlay')
    .locator('[data-todo-id]')
    .waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(
    () => new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))),
  );
}

const building = (page: Page) => page.locator('.board-column[data-column="building"]');
const todoColumn = (page: Page) => page.locator('.board-column[data-column="todo"]');

test('a queued card does not light 执行中, and a drop there sends no start', async ({ page }) => {
  const stub = await stubWorld(page);
  await page.goto('/app');
  await expect(building(page).locator(`[data-todo-id="${QUEUED_ID}"]`)).toBeVisible();

  await dragCardOver(page, QUEUED_ID, 'building');
  // Drag state has settled: 已完成 is a valid target for a queued card (the
  // in-flight done gate), so its tint proves the negative reads below see a
  // committed drag, not the frame before it.
  await expect(page.locator('.board-column[data-column="done"]')).toHaveAttribute(
    'data-drop-valid',
    'true',
  );
  await evidencePanelShot(page, 'queued-over-building.png', building(page));
  await expect(building(page)).not.toHaveAttribute('data-drop-valid', 'true');
  await expect(building(page)).not.toHaveAttribute('data-drop', 'true');
  await page.mouse.up();
  await expect(building(page).locator(`[data-todo-id="${QUEUED_ID}"]`)).toBeVisible();

  // Sentinel: the todo card's drop goes through the same start path. Once its
  // POST is recorded, a POST from the queued drop would already be in the list
  // ahead of it, and its 409 toast would be on screen.
  await dragCardOver(page, FRESH_ID, 'building');
  await page.mouse.up();
  await expect.poll(() => stub.orchestrated).toEqual([FRESH_ID]);
  await expect(page.locator('[data-sonner-toast]', { hasText: '当前 queued' })).toHaveCount(0);
});

test('a todo card still lights 执行中, and a drop there sends the start', async ({ page }) => {
  const stub = await stubWorld(page);
  await page.goto('/app');
  await expect(todoColumn(page).locator(`[data-todo-id="${FRESH_ID}"]`)).toBeVisible();

  await dragCardOver(page, FRESH_ID, 'building');
  await evidencePanelShot(page, 'todo-over-building.png', building(page));
  await expect(building(page)).toHaveAttribute('data-drop-valid', 'true');
  await expect(building(page)).toHaveAttribute('data-drop', 'true');

  await page.mouse.up();
  await expect.poll(() => stub.orchestrated).toEqual([FRESH_ID]);
});

test('a context length failure replaces orchestration with a reason and retry', async ({ page }) => {
  const stub = await stubWorld(page);
  const reason = '400 context_length_exceeded: maximum context length is 200000 tokens';
  let failed = false;
  await page.route('**/api/teams/*/chief/threads', (route) => route.fulfill({ json: [{
    id: 'chief-context-1586', chiefId: 'chief-user-1-team-1', teamId: TEAM_ID, userId: USER.id,
    title: '开始任务 #12', createdAt: STARTED_AT, updatedAt: STARTED_AT,
    lastTurnAt: failed ? STARTED_AT : null, pendingSessionResumeAt: null,
    session: { runtime: 'pi', id: '', openedAt: STARTED_AT },
    toolDefHashes: {}, toolResultHashes: {}, activeRun: failed ? null : { phase: 'chief' },
    turnQueue: null, lastTurnError: failed ? reason : null,
  }] }));
  await page.goto('/app');
  const card = page.locator(`[data-todo-id="${FRESH_ID}"]`).first();
  await expect(card.locator('[data-orchestrating="true"]')).toBeVisible();
  failed = true;
  await expect(card.locator('[data-orchestrating="true"]')).toHaveCount(0);
  await expect(card.getByText('编排失败', { exact: true })).toBeVisible();
  await expect(card.getByText(reason, { exact: true })).toBeVisible();
  await evidencePanelShot(page, 'context-length-failed.png', card);
  await card.getByRole('button', { name: '重试', exact: true }).click();
  await expect.poll(() => stub.orchestrated).toEqual([FRESH_ID]);
});
