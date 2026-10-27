import { expect, type Locator, type Page, type Route, test } from '@playwright/test';
import { evidencePanelShot } from './evidence';

// Live face, every surface that used to fall back to the fixture capture
// project (r3-lifecycle) when the live project list had no entry for a todo:
// the board card, the drag overlay, the detail chip popover and the new-task
// dialog's project chip. Each one must show the todo's own live project name
// once GET /api/projects answers, and no project at all while that read is
// in flight or failed. The projects route is held open so the pending frame
// is the one under assertion, then released.
//
// Boot stubs follow search-live-project-name.spec.ts: teams + user me
// succeed, every other GET 500s into the app's isError tolerance; no
// ?scenario= = live. Evidence shots (CAIRN_E2E_EVIDENCE) sit before the
// assertions so the same run also frames the old code.

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const FIXTURE_PROJECT = 'r3-lifecycle';

function wireProject(id: string, name: string) {
  return {
    id,
    name,
    teamId: 'team-1',
    repoKind: 'hosted',
    repoName: name,
    githubRepo: null,
    localPath: null,
  };
}
const PROJECTS = [wireProject('proj-a', 'verify-1400'), wireProject('proj-b', 'atlas')];

function wireTodo(i: number, projectId: string, title: string) {
  return {
    id: `todo-${i}`,
    teamId: 'team-1',
    projectId,
    title,
    spec: title,
    phase: 'todo',
    phaseAt: 0,
    seqNum: i + 1,
    orderIndex: i,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: null,
    lastRunAt: 0,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [],
    sourceTodo: null,
    v: 1,
  };
}
const WIRE_TASKS = [
  wireTodo(0, 'proj-a', 'project probe alpha'),
  wireTodo(1, 'proj-b', 'project probe beta'),
];

interface Writes {
  list: { method: string; path: string }[];
}

/** Live boot on stubs. Writes are recorded and answered 404 so none reaches
 *  the preview server. */
async function stubLiveBoot(page: Page): Promise<Writes> {
  const writes: Writes = { list: [] };
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') {
      writes.list.push({ method: request.method(), path: new URL(request.url()).pathname });
      return route.fulfill({ status: 404, json: { error: 'e2e stub: write not expected' } });
    }
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: WIRE_TASKS }));
  for (const todo of WIRE_TASKS) {
    await page.route(`**/api/todos/${todo.id}`, (route, request) =>
      request.method() === 'GET' ? route.fulfill({ json: todo }) : route.fallback(),
    );
  }
  return writes;
}

/** Answers every GET /api/projects 500; settled() resolves once React Query's
 *  single retry has been answered and painted. */
async function failProjects(page: Page) {
  let answered = 0;
  await page.route('**/api/projects?*', (route) => {
    answered += 1;
    return route.fulfill({ status: 500, json: { error: 'e2e stub: projects read failed' } });
  });
  return {
    settled: async () => {
      await expect.poll(() => answered, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
      await page.evaluate(
        () =>
          new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))),
      );
    },
  };
}

/** Holds every GET /api/projects until release(), then answers PROJECTS. */
async function holdProjects(page: Page) {
  const held: Route[] = [];
  let released = false;
  await page.route('**/api/projects?*', (route) => {
    if (released) return route.fulfill({ json: PROJECTS });
    held.push(route);
  });
  return {
    count: () => held.length,
    release: async () => {
      released = true;
      for (const route of held.splice(0)) await route.fulfill({ json: PROJECTS });
    },
  };
}

const card = (page: Page, id: string) =>
  page.locator(`[data-testid="board-scroller"] .todo-card[data-todo-id="${id}"]`);
/** evidencePanelShot after the 150-200ms enter fades; regression runs skip both. */
async function shot(page: Page, name: string, panel: Locator) {
  if (process.env.CAIRN_E2E_EVIDENCE === undefined) return;
  await page.waitForTimeout(300);
  await evidencePanelShot(page, name, panel);
}

const column = (page: Page) =>
  page.locator('section[data-column]', { has: page.locator('[data-todo-id="todo-0"]') });
const sidebarProject = (page: Page, name: string) =>
  page.getByTestId('project-name').filter({ hasText: name });

test.describe('board card', () => {
  test('projects pending: no project item, then each card’s own project', async ({ page }) => {
    await stubLiveBoot(page);
    const projects = await holdProjects(page);
    await page.goto('/app?view=board');

    await expect(card(page, 'todo-0')).toContainText('project probe alpha');
    await expect.poll(projects.count).toBeGreaterThan(0);
    await expect(card(page, 'todo-0').locator('.todo-card-meta')).toContainText('#1');
    await shot(page, 'board-pending.png', column(page));
    await expect(card(page, 'todo-0')).not.toContainText(FIXTURE_PROJECT);
    await expect(card(page, 'todo-1')).not.toContainText(FIXTURE_PROJECT);
    const pendingHeight = (await card(page, 'todo-0').boundingBox())?.height ?? Number.NaN;

    await projects.release();
    await expect(sidebarProject(page, 'atlas')).toBeVisible();
    await shot(page, 'board-loaded.png', column(page));
    await expect(card(page, 'todo-0')).toContainText('verify-1400');
    await expect(card(page, 'todo-1')).toContainText('atlas');
    await expect(card(page, 'todo-1')).not.toContainText('verify-1400');
    // the meta row is fixed height: the name arriving does not move the card
    expect((await card(page, 'todo-0').boundingBox())?.height).toBeCloseTo(pendingHeight, 1);
  });

  test('projects read failed: no project item', async ({ page }) => {
    await stubLiveBoot(page);
    const projects = await failProjects(page);
    await page.goto('/app?view=board');

    await expect(card(page, 'todo-0').locator('.todo-card-meta')).toContainText('#1');
    await projects.settled();
    await expect(card(page, 'todo-0')).not.toContainText(FIXTURE_PROJECT);
    await expect(card(page, 'todo-1')).not.toContainText(FIXTURE_PROJECT);
  });
});

/** Presses todo-0 and carries it a little way so the overlay mounts; the
 *  caller releases over the source column (same-column drop commits nothing). */
async function liftCard(page: Page) {
  const box = await card(page, 'todo-0').boundingBox();
  if (box == null) throw new Error('card missing');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 8, y + 6, { steps: 4 });
  await page.mouse.move(x - 4, y + 40, { steps: 6 });
  const overlay = page.getByTestId('drag-overlay').locator('[data-todo-id="todo-0"]');
  await overlay.waitFor({ state: 'visible', timeout: 15_000 });
  return { overlay, drop: () => page.mouse.up() };
}

test('drag overlay: no project while pending, the card’s own project once loaded', async ({
  page,
}) => {
  const writes = await stubLiveBoot(page);
  const projects = await holdProjects(page);
  await page.goto('/app?view=board');
  await expect(card(page, 'todo-0')).toContainText('project probe alpha');
  await expect.poll(projects.count).toBeGreaterThan(0);

  const pending = await liftCard(page);
  await expect(pending.overlay).toContainText('#1');
  await shot(page, 'drag-pending.png', pending.overlay);
  await expect(pending.overlay).not.toContainText(FIXTURE_PROJECT);
  await pending.drop();

  await projects.release();
  await expect(sidebarProject(page, 'atlas')).toBeVisible();
  const loaded = await liftCard(page);
  await expect(loaded.overlay).toContainText('verify-1400');
  await expect(loaded.overlay).not.toContainText(FIXTURE_PROJECT);
  await loaded.drop();
  expect(writes.list).toEqual([]);
});

test.describe('detail chip popover', () => {
  const openPopover = async (page: Page) => {
    await page.getByTestId('phase-chip').click();
    const popover = page.getByRole('dialog', { name: '任务分配' });
    await expect(popover).toBeVisible();
    return popover;
  };

  test('projects loaded: the head names the todo’s own project', async ({ page }) => {
    await stubLiveBoot(page);
    await page.route('**/api/projects?*', (route) => route.fulfill({ json: PROJECTS }));
    await page.goto('/app/todo/todo-1');
    await expect(sidebarProject(page, 'atlas')).toBeVisible();

    const popover = await openPopover(page);
    await expect(popover).toContainText('project probe beta');
    await shot(page, 'chip-popover-loaded.png', popover);
    await expect(popover).toContainText('atlas');
    await expect(popover).toContainText('#2');
    await expect(popover).not.toContainText(FIXTURE_PROJECT);
    await expect(popover).not.toContainText('verify-1400');
  });

  test('projects pending: the head has no project, then fills in', async ({ page }) => {
    await stubLiveBoot(page);
    const projects = await holdProjects(page);
    await page.goto('/app/todo/todo-1');
    await expect.poll(projects.count).toBeGreaterThan(0);

    const popover = await openPopover(page);
    await expect(popover).toContainText('#2');
    await shot(page, 'chip-popover-pending.png', popover);
    await expect(popover).not.toContainText(FIXTURE_PROJECT);

    await projects.release();
    await expect(popover).toContainText('atlas');
    await expect(popover).not.toContainText(FIXTURE_PROJECT);
  });
});

test.describe('new-task dialog', () => {
  const openDialog = async (page: Page) => {
    await page.locator('.sidebar-new-task').click();
    const dialog = page.getByRole('dialog', { name: '新建任务' });
    await expect(dialog).toBeVisible();
    return dialog;
  };

  test('projects pending: no project chip, and saving sends nothing to a fixture project', async ({
    page,
  }) => {
    const writes = await stubLiveBoot(page);
    const projects = await holdProjects(page);
    await page.goto('/app?view=board');
    await expect(card(page, 'todo-0')).toContainText('project probe alpha');
    await expect.poll(projects.count).toBeGreaterThan(0);

    const dialog = await openDialog(page);
    await expect(dialog.getByTestId('new-task-head')).toContainText('新建任务');
    await shot(page, 'newtask-pending.png', dialog.getByTestId('new-task-head'));
    await expect(dialog.getByTestId('new-task-project-chip')).toHaveCount(0);
    await expect(dialog).not.toContainText(FIXTURE_PROJECT);

    await dialog.getByTestId('new-task-spec').fill('pending save probe');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('新建任务失败，请重试。')).toBeVisible();
    // neither a todo under the fixture project id nor a stray default project
    expect(writes.list).toEqual([]);

    await projects.release();
    await expect(sidebarProject(page, 'atlas')).toBeVisible();
    const reopened = await openDialog(page);
    const chip = reopened.getByTestId('new-task-project-chip');
    await expect(chip).toContainText('verify-1400');
    await chip.click();
    const menu = page.getByRole('listbox', { name: '项目' });
    await expect(menu.getByRole('option')).toHaveCount(2);
    await shot(page, 'newtask-loaded.png', reopened);
    await expect(menu).not.toContainText(FIXTURE_PROJECT);
  });

  test('projects read failed: no project chip', async ({ page }) => {
    await stubLiveBoot(page);
    const projects = await failProjects(page);
    await page.goto('/app?view=board');
    await expect(card(page, 'todo-0')).toContainText('project probe alpha');
    await projects.settled();

    const dialog = await openDialog(page);
    await expect(dialog.getByTestId('new-task-head')).toContainText('新建任务');
    await expect(dialog.getByTestId('new-task-project-chip')).toHaveCount(0);
    await expect(dialog).not.toContainText(FIXTURE_PROJECT);
  });

  test('projects loaded and empty: no project chip, saving creates the default project', async ({
    page,
  }) => {
    const writes = await stubLiveBoot(page);
    let answered = 0;
    await page.route('**/api/projects?*', (route) => {
      answered += 1;
      return route.fulfill({ json: [] });
    });
    await page.goto('/app?view=board');
    await expect(card(page, 'todo-0')).toContainText('project probe alpha');
    await expect.poll(() => answered).toBeGreaterThan(0);

    const dialog = await openDialog(page);
    await expect(dialog.getByTestId('new-task-head')).toContainText('新建任务');
    await expect(dialog.getByTestId('new-task-project-chip')).toHaveCount(0);
    await expect(dialog).not.toContainText(FIXTURE_PROJECT);

    await dialog.getByTestId('new-task-spec').fill('empty list save probe');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    // the stub answers the write 404, so the create-project leg toasts
    await expect(page.getByText('创建项目失败，请重试。')).toBeVisible();
    expect(writes.list).toEqual([{ method: 'POST', path: '/api/projects' }]);
  });
});
