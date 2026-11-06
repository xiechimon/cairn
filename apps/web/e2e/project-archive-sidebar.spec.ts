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

test('archive hides the project from the list and the archived group reaches it', async ({
  page,
}) => {
  const calls = await open(page);
  await expect(rows(page)).toHaveCount(2);
  await rows(page).filter({ hasText: 'probe-old' }).hover();
  await page.getByRole('button', { name: 'probe-old 的菜单' }).click();
  await page.getByRole('menuitem', { name: '归档' }).click();
  await expect(rows(page).filter({ hasText: 'probe-old' })).toHaveCount(0);
  expect(calls).toEqual(['/api/projects/proj-2/archive']);

  const group = page.getByTestId('archived-group');
  await expect(group).toContainText('已归档');
  await group.getByRole('button', { name: /已归档/ }).click();
  await expect(group.locator('[data-slot="sidebar-project-row"]')).toContainText('probe-old');
});

test('unarchive returns the project to the main list', async ({ page }) => {
  const calls = await open(page);
  await rows(page).filter({ hasText: 'probe-old' }).hover();
  await page.getByRole('button', { name: 'probe-old 的菜单' }).click();
  await page.getByRole('menuitem', { name: '归档' }).click();
  const group = page.getByTestId('archived-group');
  await group.getByRole('button', { name: /已归档/ }).click();
  const archivedRow = group.locator('[data-slot="sidebar-project-row"]');
  await archivedRow.hover();
  await page.getByRole('button', { name: 'probe-old 的菜单' }).click();
  await page.getByRole('menuitem', { name: '取消归档' }).click();
  await expect(page.getByTestId('archived-group')).toHaveCount(0);
  await expect(rows(page).filter({ hasText: 'probe-old' })).toHaveCount(1);
  expect(calls).toEqual(['/api/projects/proj-2/archive', '/api/projects/proj-2/unarchive']);
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
  await expect(page.getByTestId('archived-group')).toBeVisible();
  expect(deletes).toEqual([]);
});
