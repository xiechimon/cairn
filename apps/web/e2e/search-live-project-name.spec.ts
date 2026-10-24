import { expect, type Page, type Route, test } from '@playwright/test';
import { pressAndExpect } from './helpers.js';

// ⌘K live face, the frame before GET /api/search answers. While the server
// query is in flight (250ms debounce + round trip) the rows come from the
// client-side filter over the live todo set; each todo row's second line
// must be that todo's own live project name, never the fixture capture
// project (r3-lifecycle), and the 项目 group must come from the live
// project list, never the fixture project. The search route is held open so
// the pre-response frame is the one under assertion, then released to show
// the server frame agrees.
//
// Boot stubs follow schedules-live.spec.ts: teams + user me succeed, every
// other GET 500s into the app's isError tolerance; no ?scenario= = live.

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
  wireTodo(0, 'proj-a', 'search probe alpha'),
  wireTodo(1, 'proj-b', 'search probe beta'),
];

async function stubLiveBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: WIRE_TASKS }));
}

/** Holds every GET /api/search until release(); answers with the server
 *  envelope for its own q (LIKE on title / project name, real names). */
function holdSearch(page: Page) {
  const held: { q: string; route: Route }[] = [];
  const answer = (q: string) => ({
    todos: WIRE_TASKS.filter((t) => t.title.includes(q)).map((t) => ({
      id: t.id,
      seqNum: t.seqNum,
      title: t.title,
      phase: t.phase,
      phaseAt: t.phaseAt,
      projectName: PROJECTS.find((p) => p.id === t.projectId)?.name ?? '',
    })),
    projects: PROJECTS.filter((p) => p.name.includes(q)).map((p) => ({ id: p.id, name: p.name })),
    agents: [],
  });
  return {
    install: () =>
      page.route('**/api/search?*', (route) => {
        held.push({ q: new URL(route.request().url()).searchParams.get('q') ?? '', route });
      }),
    queries: () => held.map((h) => h.q),
    release: async () => {
      for (const { q, route } of held.splice(0)) await route.fulfill({ json: answer(q) });
    },
  };
}

const panel = (page: Page) => page.getByRole('dialog', { name: '搜索' });
const todoRow = (page: Page, title: string) =>
  panel(page).locator('[data-row-kind="todo"]', { hasText: title });
const projectRows = (page: Page) => panel(page).locator('[data-row-kind="project"]');

async function openPanel(page: Page) {
  await pressAndExpect(page, 'Meta+k', panel(page));
}

async function typeQuery(page: Page, query: string) {
  const input = panel(page).getByRole('textbox');
  await input.fill('');
  await input.pressSequentially(query);
}

test('live, projects loaded: pre-response rows carry each todo’s own project', async ({
  page,
}) => {
  await stubLiveBoot(page);
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: PROJECTS }));
  const search = holdSearch(page);
  await search.install();

  await page.goto('/app');
  // both reads landed: sidebar project rows (projects) + a board card (todos)
  await expect(page.getByTestId('project-name').filter({ hasText: 'atlas' })).toBeVisible();
  await expect(page.getByText('search probe beta').first()).toBeVisible();
  await openPanel(page);

  await typeQuery(page, 'search probe');
  await expect.poll(() => search.queries()).toContain('search probe');
  // /api/search is held: this is the client-filtered frame
  await expect(todoRow(page, 'search probe alpha')).toContainText('verify-1400');
  await expect(todoRow(page, 'search probe beta')).toContainText('atlas');
  await expect(todoRow(page, 'search probe beta')).not.toContainText('verify-1400');
  await expect(panel(page)).not.toContainText(FIXTURE_PROJECT);

  // 项目 group from the live list: a project-name query lists the live hit
  await typeQuery(page, 'atlas');
  await expect.poll(() => search.queries()).toContain('atlas');
  await expect(projectRows(page)).toHaveCount(1);
  await expect(projectRows(page)).toContainText('atlas');
  // a query that only the fixture project name matches finds nothing live
  await typeQuery(page, 'lifecycle');
  await expect.poll(() => search.queries()).toContain('lifecycle');
  await expect(panel(page)).toContainText('没有与“lifecycle”匹配的结果');
  await expect(panel(page)).not.toContainText(FIXTURE_PROJECT);

  // server frame: same names once /api/search answers
  await typeQuery(page, 'search probe');
  await search.release();
  await expect(todoRow(page, 'search probe alpha')).toContainText('verify-1400');
  await expect(todoRow(page, 'search probe beta')).toContainText('atlas');
  await expect(panel(page)).not.toContainText(FIXTURE_PROJECT);
});

test('live, projects read failed: pre-response rows show no project line', async ({ page }) => {
  await stubLiveBoot(page);
  const search = holdSearch(page);
  await search.install();

  await page.goto('/app');
  await expect(page.getByText('search probe alpha').first()).toBeVisible();
  await openPanel(page);

  await typeQuery(page, 'search probe');
  await expect.poll(() => search.queries()).toContain('search probe');
  await expect(todoRow(page, 'search probe alpha')).toBeVisible();
  await expect(panel(page)).not.toContainText(FIXTURE_PROJECT);
  await expect(panel(page)).not.toContainText('verify-1400');
  await search.release();
});
