import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, TASK, THREAD } from './chief-home-mock';

const MIN = 60_000;

async function open(page: Page) {
  const now = Date.now();
  const todos = [
    { ...TASK, id: 't-run', title: 'Run the build', phase: 'building', phaseAt: now - 12 * MIN },
    { ...TASK, id: 't-fail', title: 'Failed deploy', phase: 'failed', phaseAt: now - 3 * 60 * MIN },
    { ...TASK, id: 't-ask', title: 'Pick a provider', phase: 'confirm', phaseAt: now - 5 * MIN },
    { ...TASK, id: 't-done', title: 'Finished work', phase: 'done', phaseAt: now - 2 * MIN },
    { ...TASK, id: 't-arch', title: 'Archived work', phase: 'building', archivedAt: now },
    { ...TASK, id: 't-other', projectId: 'proj-x', title: 'Other project', phase: 'building' },
  ];
  await mockLive(page, { threads: [THREAD], messages: [], todos, projects: [PROJECT] });
  await page.goto('/app');
}

const threadRows = (page: Page) => page.locator('aside [data-slot="sidebar-thread-row"]');

test('threads group by status with needs-you first and failed carrying a text tag', async ({
  page,
}) => {
  await open(page);
  const needsYou = page.getByTestId('thread-group-needs-you');
  await expect(needsYou.locator('[data-slot="sidebar-thread-row"]')).toHaveText([
    /Pick a provider/,
    /Failed deploy.*失败/,
  ]);
  const running = page.getByTestId('thread-group-running');
  await expect(running.locator('[data-slot="sidebar-thread-row"]')).toContainText(['Run the build']);
  await expect(running).toContainText('12 分');
  await expect(page.locator('aside')).not.toContainText('Archived work');
});

test('finished threads fold until the done header opens them', async ({ page }) => {
  await open(page);
  await expect(page.locator('aside')).not.toContainText('Finished work');
  const toggle = page.getByTestId('done-threads-toggle');
  await expect(toggle).toContainText('已完成');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(page.locator('aside')).toContainText('Finished work');
  await toggle.click();
  await expect(page.locator('aside')).not.toContainText('Finished work');
});

test('the project row filters the thread list to that project', async ({ page }) => {
  await open(page);
  const sidebar = page.locator('aside.board-sidebar');
  await expect(sidebar).toContainText('Other project');
  await page.locator('[data-slot="sidebar-project-row"]', { hasText: PROJECT.name }).click();
  await expect(sidebar).not.toContainText('Other project');
  await expect(sidebar).toContainText('Run the build');
});

test('clicking a thread row opens that thread', async ({ page }) => {
  await open(page);
  await threadRows(page).filter({ hasText: 'Run the build' }).getByRole('button').click();
  await expect(page).toHaveURL(/[?&]thread=t-run/);
});
