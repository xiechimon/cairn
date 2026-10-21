import { expect, type Page, test } from '@playwright/test';
import { evidencePanelShot } from './evidence';

// #1447: a queued task (started, waiting for a machine) sits in 执行中, the
// step its build will run (the reference product's 2026-09-12 board entry),
// and says why it waits in the 执行中 footer: 排队中 for a healthy queue,
// 等机器 / 等额度 when held. The hourglass is static; the breathing robot is
// for planning / building, which actually run. Dropping a queued card on
// 待开始 is a reset (#755). Live face, no ?scenario= (stubWorld discipline from
// board-dnd-live.spec.ts).
// Failure modes pinned here:
//   1. a queued card still sits in 待开始 beside cards that have not started;
//   2. a healthy queued card shows no waiting state, or a held one hides its
//      reason;
//   3. a queued card borrows the breathing robot of a running agent;
//   4. a queued card dropped on 待开始 does nothing instead of opening reset;
//   5. todo and building cards change: todo leaves 待开始, building loses its
//      breathing footer, or the column counts drift.

const TEAM_ID = 'team-1';
const PROJECT_ID = 'proj-1447';
const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const PROJECT = {
  id: PROJECT_ID,
  name: 'pacman',
  teamId: TEAM_ID,
  repoKind: 'hosted',
  repoName: 'pacman',
  githubRepo: null,
  localPath: null,
};
const STARTED_AT = Date.now() - 60_000;
const AGENT = { id: 'agent-1', displayName: 'r3-builder' };

function wireCard(
  id: string,
  phase: string,
  seqNum: number,
  title: string,
  extra: Record<string, unknown> = {},
) {
  const started = phase !== 'todo';
  return {
    id,
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    title,
    spec: '',
    phase,
    phaseAt: STARTED_AT,
    seqNum,
    orderIndex: seqNum,
    tagIds: [],
    assignment: null,
    agent: started ? AGENT : null,
    latestBuildId: started ? `build-${id}` : null,
    lastRunAt: null,
    hasChanges: false,
    hasPlan: false,
    buildHistory: started ? [{ buildId: `build-${id}`, createdAt: STARTED_AT }] : [],
    sourceTodo: null,
    v: 1,
    ...extra,
  };
}

const QUEUED = wireCard('todo-queued', 'queued', 11, '排队探针');
const HELD = wireCard('todo-held', 'queued', 12, '等机器探针', {
  waitingOn: { on: 'machine', retryAt: null },
});
const FRESH = wireCard('todo-fresh', 'todo', 13, '待开始探针');
const RUNNING = wireCard('todo-running', 'building', 14, '执行中探针');

async function stubWorld(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route('**/api/todos?*', (route) =>
    route.fulfill({ json: [QUEUED, HELD, FRESH, RUNNING] }),
  );
}

const column = (page: Page, id: string) => page.locator(`.board-column[data-column="${id}"]`);
const card = (page: Page, columnId: string, todoId: string) =>
  column(page, columnId).locator(`[data-todo-id="${todoId}"]`);

test('queued cards sit in 执行中 with a waiting footer; todo and building stay put', async ({
  page,
}) => {
  await stubWorld(page);
  await page.goto('/app');
  await expect(page.locator(`[data-todo-id="${FRESH.id}"]`)).toBeVisible();
  await evidencePanelShot(page, 'board-columns.png', page.getByTestId('board-scroller'), 0);
  await expect(card(page, 'building', QUEUED.id)).toBeVisible();
  await expect(card(page, 'building', HELD.id)).toBeVisible();
  await expect(card(page, 'todo', FRESH.id)).toBeVisible();
  await expect(card(page, 'building', RUNNING.id)).toBeVisible();
  await expect(column(page, 'todo').locator('[data-todo-id]')).toHaveCount(1);
  await expect(column(page, 'building').getByTestId('column-count')).toHaveText('3');
  await expect(column(page, 'todo').getByTestId('column-count')).toHaveText('1');

  const queuedFooter = card(page, 'building', QUEUED.id).locator('[data-card-footer="waiting"]');
  await expect(queuedFooter).toHaveText('r3-builder · 排队中');
  const heldFooter = card(page, 'building', HELD.id).locator('[data-card-footer="waiting"]');
  await expect(heldFooter).toHaveText('r3-builder · 等机器');
  for (const footer of [queuedFooter, heldFooter]) {
    await expect(footer.locator('.animate-breath')).toHaveCount(0);
  }
  const runningFooter = card(page, 'building', RUNNING.id).locator('[data-card-footer="running"]');
  await expect(runningFooter).toHaveText('r3-builder · 执行中');
  await expect(runningFooter.locator('.animate-breath')).toHaveCount(1);
});

test('a queued card dropped on 待开始 opens the reset dialog', async ({ page }) => {
  await stubWorld(page);
  await page.goto('/app');
  const from = await page.locator(`[data-todo-id="${QUEUED.id}"]`).first().boundingBox();
  const list = await page.locator('[data-column-list="todo"]').boundingBox();
  if (from == null || list == null) throw new Error('board not rendered');
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
  await expect(column(page, 'todo')).toHaveAttribute('data-drop', 'true');
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: '把任务重置回待开始？' })).toBeVisible();
});
