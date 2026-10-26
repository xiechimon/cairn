import { expect, type Page, test } from '@playwright/test';

const TEAM_ID = 'team-1';
const CARD_ID = 'todo-753';
const PROJECT_ID = 'proj-753';

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

function wireCard(phase: string, v: number) {
  return {
    id: CARD_ID,
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    title: 'reopen 探针',
    spec: 'reopen 探针',
    phase,
    phaseAt: Date.now(),
    seqNum: 9,
    orderIndex: 0,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: 'build-753',
    lastRunAt: 0,
    hasChanges: true,
    hasPlan: false,
    buildHistory: [{ buildId: 'build-753', createdAt: 0 }],
    sourceTodo: null,
    v,
  };
}

interface Stub {
  patches: { body: Record<string, unknown> }[];
}

async function stubWorld(page: Page, mode: 'ok' | '409', initialPhase = 'done'): Promise<Stub> {
  const stub: Stub = { patches: [] };
  let current = wireCard(initialPhase, 1);
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/projects', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [current] }));
  await page.route(`**/api/todos/${CARD_ID}`, (route, request) => {
    if (request.method() !== 'PATCH') return route.fallback();
    const body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
    stub.patches.push({ body });
    if (mode === '409') {
      return route.fulfill({ status: 409, json: { error: 'illegal phase transition' } });
    }
    current = { ...current, phase: String(body.phase ?? current.phase), v: current.v + 1 };
    return route.fulfill({ json: current });
  });
  return stub;
}

/** Press the card and carry it into the target column's list area; leaves the
 *  button down (caller arms the trace, then ups). */
async function dragCardToColumn(page: Page, columnListId: string): Promise<void> {
  const fromBox = await page.locator(`[data-todo-id="${CARD_ID}"]`).boundingBox();
  if (fromBox == null) throw new Error('card missing');
  const list = await page.locator(`[data-column-list="${columnListId}"]`).boundingBox();
  if (list == null) throw new Error(`${columnListId} list missing`);
  const sx = fromBox.x + fromBox.width / 2;
  const sy = fromBox.y + fromBox.height / 2;
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

test('live: done(with changes)→`待处理` fires PATCH phase=review, optimistic landing never flashes back', async ({
  page,
}) => {
  const stub = await stubWorld(page, 'ok');
  await page.goto('/app?view=board');
  await expect(page.locator(`[data-column="done"] [data-todo-id="${CARD_ID}"]`)).toBeVisible();

  await dragCardToColumn(page, 'pending');
  await expect(page.locator('[data-column="pending"]')).toHaveAttribute('data-drop', 'true');

  // arm the flash trace, then release
  await page.evaluate((id) => {
    const trace: { t: number; col: string | null }[] = [];
    (window as unknown as { __flashTrace: typeof trace }).__flashTrace = trace;
    const t0 = performance.now();
    const tick = () => {
      const grid = document.querySelector(`[data-testid="board-scroller"] [data-todo-id="${id}"]`);
      trace.push({
        t: Math.round(performance.now() - t0),
        col: grid?.closest('section[data-column]')?.getAttribute('data-column') ?? null,
      });
      if (performance.now() - t0 < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, CARD_ID);

  await page.mouse.up();
  await page.waitForTimeout(700);

  expect(stub.patches.length).toBeGreaterThanOrEqual(1);
  expect(stub.patches[0]?.body.phase).toBe('review');

  const trace = await page.evaluate(
    () => (window as unknown as { __flashTrace: { t: number; col: string | null }[] }).__flashTrace,
  );
  const firstPending = trace.findIndex((s) => s.col === 'pending');
  expect(firstPending, 'card never landed in 待处理 during the trace').toBeGreaterThanOrEqual(0);
  const backFrames = trace.slice(firstPending + 1).filter((s) => s.col === 'done');
  expect(backFrames, `frames back in 已完成: ${JSON.stringify(backFrames)}`).toEqual([]);
  await expect(
    page.locator(`[data-column="pending"] [data-todo-id="${CARD_ID}"]`),
  ).toBeVisible();
  await expect(page.locator('[data-column="pending"]').getByTestId('column-count')).toHaveText('1');
  await expect(page.locator('[data-column="done"]').getByTestId('column-count')).toHaveText('0');

  await expect(
    page
      .locator(`[data-column="pending"] [data-todo-id="${CARD_ID}"]`)
      .getByRole('button', { name: '审阅' }),
  ).toHaveText('审阅');
});

test('live: PATCH 409 = optimistic value voided, card bounces back to the source column + toast names the failure (#638)', async ({ page }) => {
  const stub = await stubWorld(page, '409');
  await page.goto('/app?view=board');
  await expect(page.locator(`[data-column="done"] [data-todo-id="${CARD_ID}"]`)).toBeVisible();

  await dragCardToColumn(page, 'pending');
  await page.mouse.up();

  await expect(
    page.locator(`[data-column="done"] [data-todo-id="${CARD_ID}"]`),
    'card bounced back to 已完成',
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-column="done"]').getByTestId('column-count')).toHaveText('1');
  await expect(page.locator('[data-column="pending"]').getByTestId('column-count')).toHaveText('0');

  await expect(page.locator('[data-sonner-toast]').first()).toBeVisible();
  await expect(page.locator('[data-sonner-toast]').first()).toContainText('移动任务失败');
  expect(stub.patches.length).toBeGreaterThanOrEqual(1);
});

const doneDialog = (page: Page) => page.getByRole('dialog', { name: '把任务标记为已完成？' });

test('live: review(with changes)→`已完成` opens the done gate, cancel = zero PATCHes, card stays in source column (#901)', async ({
  page,
}) => {
  const stub = await stubWorld(page, 'ok', 'review');
  await page.goto('/app?view=board');
  await expect(
    page.locator(`[data-column="pending"] [data-todo-id="${CARD_ID}"]`),
  ).toBeVisible();

  await dragCardToColumn(page, 'done');
  await page.mouse.up();

  await expect(doneDialog(page)).toBeVisible();
  expect(stub.patches).toEqual([]);
  await expect(
    page.locator(`[data-column="pending"] [data-todo-id="${CARD_ID}"]`),
  ).toBeVisible();

  await doneDialog(page)
    .getByTestId('dialog-foot')
    .getByRole('button', { name: '关闭' })
    .click();
  await expect(doneDialog(page)).toBeHidden();
  expect(stub.patches, '取消路径不得发任何 PATCH').toEqual([]);
  await expect(page.locator('[data-column="pending"]').getByTestId('column-count')).toHaveText('1');
  await expect(page.locator('[data-column="done"]').getByTestId('column-count')).toHaveText('0');
});

test('live: review(with changes)→`已完成` confirm sends PATCH phase=done, optimistic landing (#901)', async ({
  page,
}) => {
  const stub = await stubWorld(page, 'ok', 'review');
  await page.goto('/app?view=board');
  await expect(
    page.locator(`[data-column="pending"] [data-todo-id="${CARD_ID}"]`),
  ).toBeVisible();

  await dragCardToColumn(page, 'done');
  await page.mouse.up();
  await expect(doneDialog(page)).toBeVisible();
  expect(stub.patches, '确认前零 PATCH').toEqual([]);

  await doneDialog(page).getByRole('button', { name: '确认完成' }).click();
  await expect(doneDialog(page)).toBeHidden();
  await expect(
    page.locator(`[data-column="done"] [data-todo-id="${CARD_ID}"]`),
    'card lands in 已完成 after confirm',
  ).toBeVisible({ timeout: 10_000 });
  expect(stub.patches.length).toBeGreaterThanOrEqual(1);
  expect(stub.patches[0]?.body.phase).toBe('done');
  await expect(page.locator('[data-column="done"]').getByTestId('column-count')).toHaveText('1');
  await expect(page.locator('[data-column="pending"]').getByTestId('column-count')).toHaveText('0');
});
