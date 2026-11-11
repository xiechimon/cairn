import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, THREAD } from './chief-home-mock';

const ARCHIVED = { ...PROJECT, id: 'proj-old', name: 'old-landing', archivedAt: 5 };
const GROUPED = { ...PROJECT, id: 'proj-v1', name: 'acme-api-v1', group: '客户', archivedAt: 6 };

interface Calls {
  posts: string[];
  deletes: string[];
  refuse: Set<string>;
}

async function open(page: Page, url = '/app', archived = [ARCHIVED, GROUPED]): Promise<Calls> {
  const projects = [PROJECT, ...archived].map((p) => ({ ...p })) as {
    id: string;
    archivedAt: number | null;
  }[];
  const calls: Calls = { posts: [], deletes: [], refuse: new Set() };
  await mockLive(page, { threads: [THREAD], messages: [], projects }, (path, route, json) => {
    const method = route.request().method();
    const flip = /^\/api\/projects\/([^/]+)\/(archive|unarchive)$/.exec(path);
    if (flip !== null && method === 'POST') {
      calls.posts.push(path);
      const target = projects.find((p) => p.id === flip[1]);
      if (target === undefined) return json({ error: 'nope' }, 404);
      target.archivedAt = flip[2] === 'archive' ? 123 : null;
      return json(target);
    }
    const remove = /^\/api\/projects\/([^/]+)$/.exec(path);
    if (remove !== null && method === 'DELETE') {
      calls.deletes.push(path);
      if (calls.refuse.has(remove[1] ?? '')) return json({ error: 'still running' }, 409);
      const index = projects.findIndex((p) => p.id === remove[1]);
      if (index >= 0) projects.splice(index, 1);
      return route.fulfill({ status: 204, body: '' });
    }
    return undefined;
  });
  await page.goto(url);
  return calls;
}

const rows = (page: Page) => page.locator('aside [data-slot="sidebar-project-row"]');

async function chooseFilter(page: Page, label: '进行中' | '已归档' | '全部') {
  if ((await page.getByTestId('sidebar-archived-page').count()) === 0) {
    await page.locator('aside [data-slot="sidebar-nav-row"]').first().hover();
  }
  await page.getByTestId('sidebar-project-filter').click();
  await page.getByRole('menuitem', { name: /状态/ }).hover();
  await page.getByRole('menuitemradio', { name: label }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

test('the filter starts on active and lists archived projects, groups included', async ({
  page,
}) => {
  await open(page);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toHaveText('cairn');
  await chooseFilter(page, '已归档');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toHaveAttribute('data-archived', '');
  await expect(page.getByTestId('sidebar-archived-note')).toHaveText(
    '已归档的项目和它们的对话会一直保留，直到你删除。',
  );
  await expect(page.getByTestId('project-group-header')).toHaveCount(0);
  await expect(page.locator('aside [data-slot="sidebar-new-project"]')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-project-filter')).toHaveCount(1);
  await expect(page.getByTestId('sidebar-archived-page').getByRole('heading')).toHaveText(
    '已归档的项目',
  );
  await page.mouse.move(900, 400);
  await expect(page.getByTestId('sidebar-project-filter')).toBeVisible();
});

test('the normal list never shows the note and pins the archived entry above the footer', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByTestId('sidebar-archived-note')).toHaveCount(0);
  const entry = page.locator('aside [data-slot="sidebar-archived-entry"]');
  await expect(entry).toHaveText('已归档');
  const footer = await page.getByTestId('sidebar-footer').boundingBox();
  const box = await entry.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(footer!.y);
  await entry.click();
  await expect(page.getByTestId('sidebar-archived-note')).toBeVisible();
  await expect(page.locator('aside [data-slot="sidebar-archived-entry"]')).toHaveCount(0);
  await page.locator('aside [data-slot="sidebar-filter-back"]').click();
  await expect(page.getByTestId('sidebar-archived-note')).toHaveCount(0);
  await expect(entry).toBeVisible();
});

test('the filter choice survives a reload and the back row returns to active', async ({
  page,
}) => {
  await open(page);
  await chooseFilter(page, '已归档');
  await page.reload();
  await expect(rows(page)).toHaveCount(2);
  await page.locator('aside [data-slot="sidebar-filter-back"]').click();
  await expect(rows(page)).toHaveCount(1);
  await page.reload();
  await expect(rows(page)).toHaveCount(1);
});

test('all shows both, with only the archived rows marked', async ({ page }) => {
  await open(page);
  await chooseFilter(page, '全部');
  await expect(page.getByTestId('sidebar-archived-note')).toHaveCount(0);
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator('aside [data-slot="sidebar-project-row"][data-archived]')).toHaveCount(
    2,
  );
  await expect(rows(page).filter({ hasText: 'cairn' })).not.toHaveAttribute('data-archived');
  await expect(rows(page).filter({ hasText: 'old-landing' })).toHaveAttribute(
    'aria-description',
    '已归档',
  );
});

test('an empty archived view says so in one line', async ({ page }) => {
  await open(page, '/app', []);
  await chooseFilter(page, '已归档');
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByTestId('sidebar-archived-empty')).toHaveText('没有已归档的项目');
});

test('the archived row menu unarchives back into the active list', async ({ page }) => {
  const calls = await open(page);
  await chooseFilter(page, '已归档');
  await rows(page).filter({ hasText: 'old-landing' }).hover();
  await page.getByRole('button', { name: 'old-landing 的菜单' }).click();
  const items = page.getByRole('menuitem');
  await expect(items).toHaveText(['取消归档', '删除']);
  await page.getByRole('menuitem', { name: '取消归档' }).click();
  await expect(rows(page)).toHaveCount(1);
  expect(calls.posts).toEqual(['/api/projects/proj-old/unarchive']);
  await page.locator('aside [data-slot="sidebar-filter-back"]').click();
  await expect(rows(page).filter({ hasText: 'old-landing' })).toHaveCount(1);
});

test('deleting an archived project needs its typed name', async ({ page }) => {
  const calls = await open(page);
  await chooseFilter(page, '已归档');
  await rows(page).filter({ hasText: 'old-landing' }).hover();
  await page.getByRole('button', { name: 'old-landing 的菜单' }).click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  const dialog = page.getByRole('alertdialog');
  const confirm = dialog.getByRole('button', { name: '删除' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('输入 old-landing 以确认删除').fill('old-landing');
  await confirm.click();
  await expect(rows(page)).toHaveCount(1);
  expect(calls.deletes).toEqual(['/api/projects/proj-old']);
});

test('an archived project opens read-only and unarchiving brings the composer back', async ({
  page,
}) => {
  const calls = await open(page);
  await chooseFilter(page, '已归档');
  await rows(page).filter({ hasText: 'old-landing' }).click();
  await expect(page).toHaveURL(/[?&]project=proj-old/);
  await expect(page).toHaveURL(/[?&]chat=1/);
  const block = page.getByTestId('chief-composer-block');
  await expect(block.getByTestId('archived-project-bar')).toContainText(
    '这个项目已归档。取消归档后才能发消息。',
  );
  await expect(block.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByTestId('home-c-starters')).toHaveCount(0);
  await page.getByTestId('archived-project-bar-unarchive').click();
  await expect.poll(() => calls.posts).toEqual(['/api/projects/proj-old/unarchive']);
  await expect(block.getByTestId('archived-project-bar')).toHaveCount(0);
  await expect(block.getByRole('textbox')).toHaveCount(1);
});

test('the project home of an archived project swaps the ask box for the bar', async ({ page }) => {
  await open(page, '/app?project=proj-old');
  await expect(page.getByTestId('project-home')).toBeVisible();
  await expect(page.getByTestId('project-home-ask')).toHaveCount(0);
  await expect(page.getByTestId('archived-project-bar')).toBeVisible();
  await expect(page.getByTestId('project-home-edit-blocked')).toHaveAttribute(
    'aria-description',
    '这个项目已归档。取消归档后才能修改。',
  );
});

test('the tasks panel of an archived project cannot add a task', async ({ page }) => {
  await open(page, '/app?project=proj-old&chat=1&pane=tasks');
  const add = page.getByTestId('tasks-new');
  await expect(add).toHaveAttribute('aria-disabled', 'true');
  await expect(add).toHaveAccessibleName('这个项目已归档。取消归档后才能修改。');
  await add.click({ force: true });
  await expect(page.getByTestId('tasks-add-input')).toHaveCount(0);
});

test('the phone drawer carries the archived entry and page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole('button', { name: '展开侧边栏' }).first().click();
  const drawer = page.getByRole('dialog');
  await drawer.locator('[data-slot="sidebar-archived-entry"]').click();
  await expect(drawer.locator('[data-slot="sidebar-project-row"]')).toHaveCount(2);
  await expect(drawer.getByTestId('sidebar-archived-note')).toBeVisible();
  await expect(drawer.locator('[data-slot="sidebar-filter-back"]')).toBeVisible();
});

test('the archived page pairs the note with a delete-all button and a pill per row', async ({
  page,
}) => {
  await open(page);
  await chooseFilter(page, '已归档');
  const del = page.getByTestId('sidebar-archived-delete-all');
  await expect(del).toHaveText('全部删除');
  const note = await page.getByTestId('sidebar-archived-note').boundingBox();
  const button = await del.boundingBox();
  expect(button!.x).toBeGreaterThan(note!.x + note!.width);
  const pill = rows(page).first().locator('[data-slot="archived-tag"]');
  await expect(pill).toHaveText('已归档');
  expect((await pill.boundingBox())!.height).toBeCloseTo(20, 0);
  await rows(page).first().hover();
  await expect(pill).toBeHidden();
  await expect(page.getByRole('button', { name: /的菜单/ }).first()).toBeVisible();
});

test('the back row and the pinned entries sit in the rows icon and label columns', async ({
  page,
}) => {
  await open(page);
  const coordinator = page.locator('aside [data-slot="sidebar-nav-row"]').first();
  const iconX = async (row: ReturnType<Page['locator']>) =>
    (await row.locator('svg').first().boundingBox())!.x;
  const labelX = async (row: ReturnType<Page['locator']>) =>
    (await row.locator('span').last().boundingBox())!.x;
  const entry = page.locator('aside [data-slot="sidebar-archived-entry"]');
  expect(await iconX(entry)).toBeCloseTo(await iconX(coordinator), 0);
  await entry.click();
  const back = page.locator('aside [data-slot="sidebar-filter-back"]');
  expect(await iconX(back)).toBeCloseTo(await iconX(rows(page).first()), 0);
  expect(await labelX(coordinator)).toBeGreaterThan(0);
});

test('delete all asks with the count, then deletes every archived project', async ({ page }) => {
  const calls = await open(page);
  await chooseFilter(page, '已归档');
  await page.getByTestId('sidebar-archived-delete-all').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('删除 2 个已归档的项目？');
  await dialog.getByRole('button', { name: '全部删除' }).click();
  await expect(rows(page)).toHaveCount(0);
  expect(calls.deletes.sort()).toEqual(['/api/projects/proj-old', '/api/projects/proj-v1']);
  await expect(page.getByTestId('sidebar-archived-empty')).toBeVisible();
  await expect(page.getByTestId('sidebar-archived-delete-all')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('cancelling delete all deletes nothing', async ({ page }) => {
  const calls = await open(page);
  await chooseFilter(page, '已归档');
  await page.getByTestId('sidebar-archived-delete-all').click();
  await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(rows(page)).toHaveCount(2);
  expect(calls.deletes).toEqual([]);
});

test('a refused project stays in the list and one toast counts it', async ({ page }) => {
  const calls = await open(page);
  calls.refuse.add('proj-v1');
  await chooseFilter(page, '已归档');
  await page.getByTestId('sidebar-archived-delete-all').click();
  await page.getByRole('alertdialog').getByRole('button', { name: '全部删除' }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText('acme-api-v1');
  await expect(page.getByText('1 个项目没能删除，已留在列表里。')).toBeVisible();
  expect(calls.deletes).toHaveLength(2);
});

test('delete all is disabled with a reason when nothing is archived', async ({ page }) => {
  await open(page, '/app', []);
  await chooseFilter(page, '已归档');
  const del = page.getByTestId('sidebar-archived-delete-all');
  await expect(del).toHaveAttribute('aria-disabled', 'true');
  await del.click({ force: true });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.mouse.move(900, 400);
  await del.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(
    '没有可删除的已归档项目',
  );
});
