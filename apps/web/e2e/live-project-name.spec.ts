import { expect, type Locator, type Page, type Route, test } from '@playwright/test';
import { mockLive, PROJECT as HOME_PROJECT } from './chief-home-mock';
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

type Json = (body: unknown, status?: number) => Promise<void>;

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

/** evidencePanelShot after the 150-200ms enter fades; regression runs skip both. */
async function shot(page: Page, name: string, panel: Locator) {
  if (process.env.CAIRN_E2E_EVIDENCE === undefined) return;
  await page.waitForTimeout(300);
  await evidencePanelShot(page, name, panel);
}

const sidebarProject = (page: Page, name: string) =>
  page.locator('[data-slot="sidebar-project-row"]').filter({ hasText: name });

test.describe('detail head', () => {
  const openPopover = async (page: Page) => {
    const head = page.getByTestId('detail-head');
    await expect(head).toBeVisible();
    return head;
  };

  test('projects loaded: the head names the todo’s own project', async ({ page }) => {
    await stubLiveBoot(page);
    await page.route('**/api/projects?*', (route) => route.fulfill({ json: PROJECTS }));
    await page.goto('/app/todo/todo-1');
    await expect(sidebarProject(page, 'atlas')).toBeVisible();

    const popover = await openPopover(page);
    await expect(page.getByTestId('detail-title')).toHaveText('project probe beta');
    await shot(page, 'head-loaded.png', popover);
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
    await shot(page, 'head-pending.png', popover);
    await expect(popover).not.toContainText(FIXTURE_PROJECT);

    await projects.release();
    await expect(popover).toContainText('atlas');
    await expect(popover).not.toContainText(FIXTURE_PROJECT);
  });
});
