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
  fail: { patch?: boolean } = {},
) {
  const todos = tasks.map((row) => ({ ...(row as Record<string, unknown>), kind: undefined }));
  await mockLive(page, { threads: [THREAD], messages: [], todos, tasks, projects }, (path, route, json) => {
    const m = /^\/api\/projects\/([^/]+)$/.exec(path);
    const method = route.request().method();
    if (m === null || (method !== 'PATCH' && method !== 'DELETE')) return undefined;
    const index = projects.findIndex((row) => row.id === m[1]);
    if (method === 'DELETE') {
      patches.push({ id: m[1]!, body: 'DELETE' });
      if (index >= 0) projects.splice(index, 1);
      return json({});
    }
    const body = route.request().postDataJSON() as Partial<Project>;
    patches.push({ id: m[1]!, body });
    if (fail.patch === true) return json({ error: 'boom' }, 500);
    const target = projects[index];
    if (target === undefined) return json({ error: 'nope' }, 404);
    Object.assign(target, body);
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
  await expect(sidebar(page).locator('nav').getByRole('button')).toHaveText(['Coordinator', 'cairn']);
  await expect(sidebar(page).getByText('项目', { exact: true })).toHaveCount(0);
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
  await expect(page.getByTestId('sidebar-archived-page')).toHaveCount(0);
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
    await page.getByRole('menuitem', { name: '移到分组' }).click();
    await page.getByRole('menuitem', { name: '移出分组' }).click();
  }
  await expect(groupHeaders(page)).toHaveCount(0);
  expect(patches.slice(1)).toEqual([
    { id: 'proj-1', body: { group: 'Sandboxes' } },
    { id: 'proj-1', body: { group: null } },
    { id: 'proj-2', body: { group: null } },
  ]);
});

const openMenu = async (page: Page, name: string) => {
  await rows(page).filter({ hasText: name }).hover();
  await page.getByRole('button', { name: `${name} 的菜单` }).click();
};

test('Rename saves the new name and keeps the input when the save fails', async ({ page }) => {
  const projects = [PROJECT, project('proj-2', 'dogfood-sandbox')];
  const patches: { id: string; body: unknown }[] = [];
  const fail = { patch: true };
  await open(page, projects, [], patches, fail);
  await openMenu(page, 'dogfood-sandbox');
  await page.getByRole('menuitem', { name: '重命名' }).click();
  const dialog = page.getByRole('dialog', { name: '重命名项目' });
  await expect(dialog.getByText('项目名称', { exact: true })).toBeVisible();
  await dialog.getByRole('textbox', { name: '项目名称' }).fill('sandbox');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('无法重命名项目。')).toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveValue('sandbox');
  fail.patch = false;
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rows(page)).toHaveText(['cairn', 'sandbox']);
  expect(patches).toEqual([
    { id: 'proj-2', body: { name: 'sandbox' } },
    { id: 'proj-2', body: { name: 'sandbox' } },
  ]);
});

test('Delete asks for the name, then removes the project', async ({ page }) => {
  const projects = [PROJECT, project('proj-2', 'dogfood-sandbox')];
  const patches: { id: string; body: unknown }[] = [];
  await open(page, projects, [], patches);
  await openMenu(page, 'dogfood-sandbox');
  await page.getByRole('menuitem', { name: '删除' }).click();
  const confirm = page.getByRole('alertdialog', { name: '删除项目' });
  await expect(confirm.getByRole('button', { name: '删除' })).toBeDisabled();
  await confirm.getByRole('textbox').fill('dogfood-sandbox');
  await confirm.getByRole('button', { name: '删除' }).click();
  await expect(rows(page)).toHaveText(['cairn']);
  expect(patches).toEqual([{ id: 'proj-2', body: 'DELETE' }]);
});

test('Project instructions opens the memory tab of the project settings', async ({ page }) => {
  await open(page, [PROJECT]);
  await openMenu(page, 'cairn');
  await page.getByRole('menuitem', { name: '项目说明' }).click();
  await expect(page).toHaveURL(/\/app\/project\/proj-1\/settings\?tab=memory$/);
  await expect(page.getByText('像 AGENTS.md：本项目的每个 thread 和 Coordinator 都会读到并遵守。')).toBeVisible();
});

test('the group menu renames a group and ungroups its projects', async ({ page }) => {
  const projects = [
    PROJECT,
    project('proj-2', 'atlas', { group: 'Side' }),
    project('proj-3', 'site', { group: 'Side' }),
  ];
  const patches: { id: string; body: unknown }[] = [];
  await open(page, projects, [], patches);
  await groupHeaders(page).hover();
  await page.getByRole('button', { name: '分组 Side 的菜单' }).click();
  await page.getByRole('menuitem', { name: '重命名分组' }).click();
  const dialog = page.getByRole('dialog', { name: '重命名分组' });
  await dialog.getByRole('textbox').fill('Clients');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(groupHeaders(page)).toHaveText(['Clients']);
  await groupHeaders(page).hover();
  await page.getByRole('button', { name: '分组 Clients 的菜单' }).click();
  await page.getByRole('menuitem', { name: '解散分组' }).click();
  await expect(groupHeaders(page)).toHaveCount(0);
  await expect(rows(page)).toHaveText(['cairn', 'atlas', 'site']);
  const byId = (list: typeof patches) => [...list].sort((a, b) => a.id.localeCompare(b.id));
  expect(byId(patches.slice(0, 2))).toEqual([
    { id: 'proj-2', body: { group: 'Clients' } },
    { id: 'proj-3', body: { group: 'Clients' } },
  ]);
  expect(byId(patches.slice(2))).toEqual([
    { id: 'proj-2', body: { group: null } },
    { id: 'proj-3', body: { group: null } },
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

  test('group headers, project rows and their menus in the drawer are 44px touch targets that do not overlap', async ({ page }) => {
    await open(page, [PROJECT, project('proj-3', 'site', { group: 'Side' })]);
    await page.getByRole('button', { name: '展开侧边栏' }).click();
    const header = groupHeaders(page).filter({ hasText: 'Side' });
    await expect(header).toBeVisible();
    await expect(page.getByRole('button', { name: 'cairn 的菜单' })).toBeVisible();
    const boxes = await page.locator('aside.board-sidebar').evaluate((aside) => {
      const rect = (node: Element | null) => {
        const box = node!.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height, width: box.width };
      };
      const row = [...aside.querySelectorAll('[data-slot="sidebar-project-row"]')].find((node) => node.textContent === 'cairn')!;
      return {
        header: rect(aside.querySelector('[data-testid="project-group-header"]')),
        row: rect(row),
        name: rect(row.querySelector('span[title]')),
        menu: rect(row.parentElement!.querySelector('[aria-label="cairn 的菜单"]')),
      };
    });
    expect(boxes.header.height).toBeGreaterThanOrEqual(44);
    expect(boxes.row.height).toBeGreaterThanOrEqual(44);
    expect(Math.min(boxes.menu.width, boxes.menu.height)).toBeGreaterThanOrEqual(44);
    expect(boxes.menu.top).toBeGreaterThanOrEqual(boxes.row.top);
    expect(boxes.menu.bottom).toBeLessThanOrEqual(boxes.row.bottom);
    expect(boxes.name.right).toBeLessThanOrEqual(boxes.menu.left);
  });
});
