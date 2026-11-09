import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, taskEntry, THREAD } from './chief-home-mock';

const MIN = 60_000;

type Project = typeof PROJECT & { group?: string | null; archivedAt?: number | null };

const project = (id: string, name: string, extra: Partial<Project> = {}): Project => ({
  ...PROJECT,
  id,
  name,
  ...extra,
});

const task = (id: string, projectId: string, title: string, phase: string, section: string) =>
  taskEntry({ id, projectId, title, phase, section, phaseAt: Date.now() - 5 * MIN });

async function open(
  page: Page,
  projects: Project[],
  tasks: unknown[] = [],
  patches: { id: string; body: unknown }[] = [],
) {
  const todos = tasks.map((row) => ({ ...(row as Record<string, unknown>), kind: undefined }));
  await mockLive(page, { threads: [THREAD], messages: [], todos, tasks, projects }, (path, route, json) => {
    const m = /^\/api\/projects\/([^/]+)$/.exec(path);
    if (m === null || route.request().method() !== 'PATCH') return undefined;
    const body = route.request().postDataJSON() as { group: string | null };
    patches.push({ id: m[1]!, body });
    const target = projects.find((row) => row.id === m[1]);
    if (target === undefined) return json({ error: 'nope' }, 404);
    target.group = body.group;
    return json(target);
  });
  await page.goto('/app');
}

const sidebar = (page: Page) => page.locator('aside.board-sidebar');
const rows = (page: Page) => sidebar(page).locator('[data-slot="sidebar-project-row"]');
const groupHeaders = (page: Page) => sidebar(page).getByTestId('project-group-header');

test('the sidebar lists the Coordinator row and projects only, with no count on the Coordinator', async ({
  page,
}) => {
  await open(
    page,
    [PROJECT],
    [task('t-rev', 'proj-1', 'Review the relay', 'review', 'ready_for_review')],
  );
  const coordinator = sidebar(page).getByRole('button', { name: 'Coordinator', exact: true });
  await expect(coordinator).toBeVisible();
  await expect(coordinator).toHaveText('Coordinator');
  await expect(rows(page)).toHaveText(['cairn']);
  await expect(sidebar(page).locator('nav').getByRole('button')).toHaveText(['项目', 'cairn']);
  await expect(sidebar(page).locator('[data-slot="thread-row"], [data-slot="task-row"]')).toHaveCount(0);
});

test('archived projects are not listed in the sidebar', async ({ page }) => {
  await open(page, [
    PROJECT,
    project('proj-2', 'dogfood-sandbox'),
    project('proj-3', 'pacman-gh-probe', { archivedAt: 1 }),
    project('proj-4', 'harbor-eval-1518', { archivedAt: 1, group: '评测' }),
  ]);
  await expect(rows(page)).toHaveText(['cairn', 'dogfood-sandbox']);
  await expect(sidebar(page)).not.toContainText('pacman-gh-probe');
  await expect(sidebar(page)).not.toContainText('已归档');
  await expect(groupHeaders(page)).toHaveCount(0);
});

test('without an owner-made group the projects are flat with no group header', async ({ page }) => {
  await open(page, [PROJECT, project('proj-2', 'dogfood-sandbox')]);
  await expect(rows(page)).toHaveText(['cairn', 'dogfood-sandbox']);
  await expect(groupHeaders(page)).toHaveCount(0);
});

test('groups follow the ungrouped projects in name order and fold on click', async ({ page }) => {
  await open(page, [
    project('proj-3', 'site', { group: 'Side' }),
    PROJECT,
    project('proj-4', 'atlas', { group: 'Archive tools' }),
  ]);
  await expect(rows(page)).toHaveText(['cairn', 'atlas', 'site']);
  await expect(groupHeaders(page)).toHaveText(['Archive tools', 'Side']);
  await groupHeaders(page).filter({ hasText: 'Side' }).click();
  await expect(groupHeaders(page).filter({ hasText: 'Side' })).toHaveAttribute('aria-expanded', 'false');
  await expect(rows(page)).toHaveText(['cairn', 'atlas']);
});

test('a waiting task puts an ochre dot on its project and the count lives only on Tasks', async ({
  page,
}) => {
  await open(
    page,
    [PROJECT, project('proj-2', 'dogfood-sandbox')],
    [
      task('t-rev', 'proj-1', 'Review the relay', 'review', 'ready_for_review'),
      task('t-run', 'proj-2', 'Run the build', 'building', 'working'),
    ],
  );
  await expect(rows(page).filter({ hasText: 'cairn' }).locator('[data-slot="needs-you-dot"]')).toHaveCount(1);
  await expect(
    rows(page).filter({ hasText: 'dogfood-sandbox' }).locator('[data-slot="needs-you-dot"]'),
  ).toHaveCount(0);
  await expect(sidebar(page).getByTestId('attention-badge')).toHaveCount(0);
  await expect(sidebar(page)).not.toContainText('Review the relay');
  await expect(sidebar(page)).not.toContainText('Run the build');
  await expect(page.getByTestId('tasks-badge')).toHaveText('1');
  await expect(page).toHaveTitle('(1) Cairn');
});

test('Move to group files a project under a new group, then back out', async ({ page }) => {
  const projects = [PROJECT, project('proj-2', 'dogfood-sandbox')];
  const patches: { id: string; body: unknown }[] = [];
  await open(page, projects, [], patches);
  await rows(page).filter({ hasText: 'dogfood-sandbox' }).hover();
  await page.getByRole('button', { name: 'dogfood-sandbox 的菜单' }).click();
  await page.getByRole('menuitem', { name: '移到分组' }).click();
  await page.getByRole('menuitem', { name: '新建分组' }).click();
  const dialog = page.getByRole('dialog', { name: '新建分组' });
  await dialog.getByRole('textbox').fill('Sandboxes');
  await dialog.getByRole('button', { name: '移入' }).click();
  await expect(groupHeaders(page)).toHaveText(['Sandboxes']);
  expect(patches).toEqual([{ id: 'proj-2', body: { group: 'Sandboxes' } }]);

  await rows(page).filter({ hasText: 'cairn' }).hover();
  await page.getByRole('button', { name: 'cairn 的菜单' }).click();
  await page.getByRole('menuitem', { name: '移到分组' }).click();
  await page.getByRole('menuitem', { name: 'Sandboxes' }).click();
  await expect(rows(page)).toHaveText(['cairn', 'dogfood-sandbox']);
  await expect(groupHeaders(page)).toHaveText(['Sandboxes']);

  for (const name of ['cairn', 'dogfood-sandbox']) {
    await rows(page).filter({ hasText: name }).hover();
    await page.getByRole('button', { name: `${name} 的菜单` }).click();
    await page.getByRole('menuitem', { name: '移出分组' }).click();
  }
  await expect(groupHeaders(page)).toHaveCount(0);
  expect(patches.slice(1)).toEqual([
    { id: 'proj-1', body: { group: 'Sandboxes' } },
    { id: 'proj-1', body: { group: null } },
    { id: 'proj-2', body: { group: null } },
  ]);
});

test('the collapsed rail names a waiting project with its status', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
  await open(
    page,
    [PROJECT, project('proj-2', 'dogfood-sandbox')],
    [task('t-rev', 'proj-1', 'Review the relay', 'review', 'ready_for_review')],
  );
  await expect(sidebar(page).getByRole('link', { name: 'cairn：有任务在等你' })).toBeVisible();
  await expect(sidebar(page).getByRole('link', { name: 'dogfood-sandbox', exact: true })).toBeVisible();
});

test.describe('on a touch screen', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('group headers and project menus in the drawer are 44px touch targets', async ({ page }) => {
    await open(page, [PROJECT, project('proj-3', 'site', { group: 'Side' })]);
    await page.getByRole('button', { name: '展开侧边栏' }).click();
    const header = groupHeaders(page).filter({ hasText: 'Side' });
    await expect(header).toBeVisible();
    expect((await header.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const menu = page.getByRole('button', { name: 'cairn 的菜单' });
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  });
});
