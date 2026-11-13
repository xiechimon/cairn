import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, THREAD } from './chief-home-mock';

const OLD = { ...PROJECT, id: 'proj-2', name: 'probe-old', archivedAt: null };

async function open(page: Page) {
  const projects = [PROJECT, OLD].map((p) => ({ ...p }));
  const calls: string[] = [];
  await mockLive(page, { threads: [THREAD], messages: [], projects }, (path, route, json) => {
    const m = /^\/api\/projects\/([^/]+)\/(archive|unarchive)$/.exec(path);
    if (m === null || route.request().method() !== 'POST') return undefined;
    calls.push(path);
    const target = projects.find((p) => p.id === m[1]);
    if (target === undefined) return json({ error: 'nope' }, 404);
    (target as { archivedAt: number | null }).archivedAt = m[2] === 'archive' ? 123 : null;
    return json(target);
  });
  await page.goto('/app');
  return calls;
}

const rows = (page: Page) => page.locator('aside [data-slot="sidebar-project-row"]');

test('archive takes the project out of the sidebar and leaves the list on the active view', async ({ page }) => {
  const calls = await open(page);
  await expect(rows(page)).toHaveCount(2);
  await rows(page).filter({ hasText: 'probe-old' }).hover();
  await page.getByRole('button', { name: 'probe-old 的菜单' }).click();
  await page.getByRole('menuitem', { name: '归档' }).click();
  await expect(rows(page).filter({ hasText: 'probe-old' })).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId('sidebar-archived-page')).toHaveCount(0);
  expect(calls).toEqual(['/api/projects/proj-2/archive']);
});

test('archiving the open project returns to the Coordinator', async ({ page }) => {
  await open(page);
  await rows(page).filter({ hasText: 'probe-old' }).click();
  await expect(page).toHaveURL(/[?&]project=proj-2/);
  await rows(page).filter({ hasText: 'probe-old' }).hover();
  await page.getByRole('button', { name: 'probe-old 的菜单' }).click();
  await page.getByRole('menuitem', { name: '归档' }).click();
  await expect(page).not.toHaveURL(/[?&]project=/);
});

test('archiving never issues a delete', async ({ page }) => {
  await open(page);
  const deletes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'DELETE') deletes.push(request.url());
  });
  await rows(page).filter({ hasText: 'probe-old' }).hover();
  await page.getByRole('button', { name: 'probe-old 的菜单' }).click();
  await page.getByRole('menuitem', { name: '归档' }).click();
  await expect(rows(page).filter({ hasText: 'probe-old' })).toHaveCount(0);
  expect(deletes).toEqual([]);
});

test('archive toast names the project and Undo brings it back', async ({ page }) => {
  const calls = await open(page);
  await rows(page).filter({ hasText: 'probe-old' }).hover();
  await page.getByRole('button', { name: 'probe-old 的菜单' }).click();
  await page.getByRole('menuitem', { name: '归档' }).click();
  await expect(page.getByText('已归档「probe-old」')).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(rows(page).filter({ hasText: 'probe-old' })).toHaveCount(1);
  expect(calls).toEqual(['/api/projects/proj-2/archive', '/api/projects/proj-2/unarchive']);
});
