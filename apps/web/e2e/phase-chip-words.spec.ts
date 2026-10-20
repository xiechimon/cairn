import { expect, type Page, test } from '@playwright/test';

// #1400: 待处理 has one meaning. It names the board column of tasks that need
// the user (confirm / review / failed; the sidebar 需要我处理 opens it).
// Not-started tasks (todo / queued) sit in 待开始. The todo chip reads 待开始
// and the queued chip (started, waiting for a machine) reads 排队中, so
// neither shows 待处理.
// Pinned surfaces: board columns, search rows and project task rows
// (scenario 22: fresh probe #9 beside the review / done legacy pair), detail
// header (scenario 23), schedule cards (live stub: todo / queued / confirm
// rows). The agent detail queued row is pinned in agent-detail.spec.ts.

const FRESH_TITLE = 'r7 rebaseline probe';

const panel = (page: Page) => page.getByRole('dialog', { name: '搜索' });

/** ⌘K until the panel answers (same retry guard as search-result-rows.spec.ts:
 *  the hotkey listener registers after first paint). */
async function openPanel(page: Page) {
  await expect(page.getByRole('complementary')).toBeVisible();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press('Meta+k');
    const opened = await panel(page)
      .waitFor({ state: 'visible', timeout: 1000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
  }
  throw new Error('⌘K never opened the search panel');
}

test('board: the fresh task sits in 待开始, 待处理 holds the review card', async ({ page }) => {
  await page.goto('/app?scenario=22');
  const todoColumn = page.locator('.board-column[data-column="todo"]');
  const pendingColumn = page.locator('.board-column[data-column="pending"]');
  await expect(todoColumn.locator('.board-column-name')).toHaveText('待开始');
  await expect(pendingColumn.locator('.board-column-name')).toHaveText('待处理');
  await expect(todoColumn.locator('[data-todo-id]', { hasText: FRESH_TITLE })).toHaveCount(1);
  await expect(pendingColumn.locator('[data-todo-id="r3-legacy-1"]')).toHaveCount(1);
});

test('detail header: the fresh task chip reads the column word 待开始', async ({ page }) => {
  await page.goto('/app/todo/fresh-probe?scenario=23');
  await expect(page.getByTestId('phase-chip')).toHaveText('待开始');
});

test('search rows: fresh reads 待开始, review 审核, done 已完成', async ({ page }) => {
  await page.goto('/app?scenario=22');
  await openPanel(page);
  await page.keyboard.type('probe');
  const rows = panel(page).locator('[data-row-kind="todo"]');
  await expect(rows).toHaveCount(3);
  const chip = (title: string) => rows.filter({ hasText: title }).locator('[data-tone]');
  await expect(chip(FRESH_TITLE)).toHaveText('待开始');
  await expect(chip('r3 lifecycle probe」')).toHaveText('审核');
  await expect(chip('r3 lifecycle probe2')).toHaveText('已完成');
  await expect(panel(page).getByText('待处理', { exact: true })).toHaveCount(0);
});

test('project task rows: fresh reads 待开始, review 审核', async ({ page }) => {
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=22&tab=tasks');
  const status = (title: string) =>
    page.getByTestId('task-row').filter({ hasText: title }).getByTestId('task-status');
  await expect(status(FRESH_TITLE)).toHaveText('待开始');
  await expect(status('r3 lifecycle probe」')).toHaveText('审核');
  await expect(page.getByText('待处理', { exact: true })).toHaveCount(0);
});

// Live face: no ?scenario= in the URL = live data source; page.route answers
// it (stubLiveBoot discipline from schedules-live.spec.ts).
const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };

function wireSchedule(seqNum: number, phase: string) {
  return {
    id: `sched-${seqNum}`,
    teamId: 'team-1',
    projectId: 'proj-1',
    todoId: `todo-${seqNum}`,
    kind: 'daily',
    at: 0,
    tz: 'Asia/Shanghai',
    machineId: null,
    nextRunAt: 0,
    createdBy: 'user-1',
    todo: {
      seqNum,
      title: `定时探针 ${phase}`,
      phase,
      projectName: 'pacman',
      ownerId: 'user-1',
    },
  };
}

test('schedule cards: todo reads 待开始, queued 排队中, confirm 确认', async ({ page }) => {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/schedules*', (route) =>
    route.fulfill({
      json: [wireSchedule(1, 'todo'), wireSchedule(2, 'queued'), wireSchedule(3, 'confirm')],
    }),
  );

  await page.goto('/app/schedules');
  const cards = page.locator('.sched-card');
  await expect(cards).toHaveCount(3);
  const chip = (phase: string) =>
    cards.filter({ hasText: `定时探针 ${phase}` }).locator('[data-tone]');
  await expect(chip('todo')).toHaveText('待开始');
  await expect(chip('queued')).toHaveText('排队中');
  await expect(chip('confirm')).toHaveText('确认');
  await expect(page.getByText('待处理', { exact: true })).toHaveCount(0);
});
