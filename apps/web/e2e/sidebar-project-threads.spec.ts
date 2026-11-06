import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, TASK, THREAD } from './chief-home-mock';

const MIN = 60_000;

async function open(page: Page) {
  const now = Date.now();
  const todos = [
    { ...TASK, id: 't-run', title: 'Run the build', phase: 'building', phaseAt: now - 12 * MIN },
    { ...TASK, id: 't-fail', title: 'Failed deploy', phase: 'failed', phaseAt: now - 3 * 60 * MIN },
    { ...TASK, id: 't-done', title: 'Finished work', phase: 'done', phaseAt: now - 2 * MIN },
    { ...TASK, id: 't-arch', title: 'Archived work', phase: 'building', archivedAt: now },
    { ...TASK, id: 't-other', projectId: 'proj-x', title: 'Other project', phase: 'building' },
  ];
  await mockLive(page, { threads: [THREAD], messages: [], todos, projects: [PROJECT] });
  await page.goto('/app');
}

const threadRows = (page: Page) => page.locator('aside [data-slot="sidebar-thread-row"]');

test('in-progress threads show under their project with status and elapsed time', async ({
  page,
}) => {
  await open(page);
  await expect(threadRows(page)).toHaveCount(2);
  await expect(threadRows(page).nth(0)).toContainText('Failed deploy');
  await expect(threadRows(page).nth(0)).toContainText('3 小时');
  await expect(threadRows(page).nth(1)).toContainText('Run the build');
  await expect(threadRows(page).nth(1)).toContainText('12 分');
  await expect(page.locator('aside')).not.toContainText('Archived work');
  await expect(page.locator('aside')).not.toContainText('Other project');
});

test('finished threads fold until the earlier toggle opens them', async ({ page }) => {
  await open(page);
  await expect(page.locator('aside')).not.toContainText('Finished work');
  const toggle = page.getByTestId('earlier-threads-toggle');
  await expect(toggle).toContainText('更早');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(page.locator('aside')).toContainText('Finished work');
  await toggle.click();
  await expect(page.locator('aside')).not.toContainText('Finished work');
});

test('clicking a thread row opens that thread', async ({ page }) => {
  await open(page);
  await threadRows(page).filter({ hasText: 'Run the build' }).getByRole('button').click();
  await expect(page).toHaveURL(/[?&]thread=t-run/);
});
