import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, THREAD } from './chief-home-mock';
import { evidenceShot } from './evidence.js';

const HOUR = 60 * 60 * 1000;
const OLDER = { ...PROJECT, id: 'proj-old', name: 'probe-older', archivedAt: Date.now() - 48 * HOUR };
const NEWER = { ...PROJECT, id: 'proj-new', name: 'probe-newer', archivedAt: Date.now() - 2 * HOUR };

async function open(page: Page, opts: { archived?: (typeof OLDER)[]; failUnarchive?: boolean; hold?: Promise<void> } = {}) {
  const projects = [PROJECT, ...(opts.archived ?? [OLDER, NEWER])].map((p) => ({ ...p }));
  const calls: string[] = [];
  await mockLive(page, { threads: [THREAD], messages: [], projects }, (path, route, json) => {
    const m = /^\/api\/projects\/([^/]+)\/unarchive$/.exec(path);
    if (m === null || route.request().method() !== 'POST') return undefined;
    calls.push(path);
    if (opts.failUnarchive === true) return json({ error: 'boom' }, 500);
    const target = projects.find((p) => p.id === m[1]);
    if (target === undefined) return json({ error: 'nope' }, 404);
    return (opts.hold ?? Promise.resolve()).then(() => {
      (target as { archivedAt: number | null }).archivedAt = null;
      return json(target);
    });
  });
  await page.goto('/app/settings/projects');
  return calls;
}

const rows = (page: Page) => page.locator('[data-slot="archived-project-row"]');

test('archived projects are listed newest archive first with when they were archived', async ({ page }) => {
  await open(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(0)).toContainText('probe-newer');
  await expect(rows(page).nth(0)).toContainText('归档于');
  await expect(rows(page).nth(1)).toContainText('probe-older');
  await expect(page.getByRole('dialog', { name: '设置' }).getByText(PROJECT.name, { exact: true })).toHaveCount(0);
});

test('unarchive takes the row out of the list and the project returns to the sidebar', async ({ page }) => {
  const calls = await open(page);
  await rows(page).filter({ hasText: 'probe-older' }).getByTestId('archived-project-unarchive').click();
  await expect(rows(page)).toHaveCount(1);
  expect(calls).toEqual(['/api/projects/proj-old/unarchive']);
  await page.goto('/app');
  await expect(page.locator('aside [data-slot="sidebar-project-row"]').filter({ hasText: 'probe-older' })).toHaveCount(1);
});

test('with nothing archived the section says so', async ({ page }) => {
  await open(page, { archived: [] });
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText('没有已归档的项目')).toBeVisible();
  await evidenceShot(page, 'archived-projects-empty.png');
});

test('the row being unarchived says so on its button until the request settles', async ({ page }) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await open(page, { hold });
  const older = rows(page).filter({ hasText: 'probe-older' }).getByTestId('archived-project-unarchive');
  const newer = rows(page).filter({ hasText: 'probe-newer' }).getByTestId('archived-project-unarchive');
  await older.click();
  await expect(older).toHaveText('取消归档中…');
  await expect(older).toBeDisabled();
  await expect(newer).toHaveText('取消归档');
  await expect(newer).toBeEnabled();
  await evidenceShot(page, 'archived-projects-unarchiving.png');
  release();
  await expect(rows(page)).toHaveCount(1);
  await expect(newer).toHaveText('取消归档');
});

test('a failed unarchive keeps the row and says why', async ({ page }) => {
  await open(page, { failUnarchive: true });
  await rows(page).filter({ hasText: 'probe-older' }).getByTestId('archived-project-unarchive').click();
  const toast = page.locator('[data-sonner-toast]').first();
  await expect(toast).toContainText('取消归档失败，请重试。');
  await expect(toast).not.toContainText('boom');
  await expect(rows(page)).toHaveCount(2);
  await evidenceShot(page, 'archived-projects-unarchive-failed.png');
});

test('at 390px the rows fit without sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(rows(page)).toHaveCount(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await evidenceShot(page, 'archived-projects-phone.png');
});

for (const theme of ['light', 'dark'] as const) {
  test(`the section has no axe violations (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(rows(page)).toHaveCount(2);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
    await evidenceShot(page, `archived-projects-${theme}.png`);
  });
}
