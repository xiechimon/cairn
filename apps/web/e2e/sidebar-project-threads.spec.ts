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
  await mockLive(page, { threads: [THREAD], messages: [], todos, projects: [PROJECT] }, (path, _route, json) => {
    const match = path.match(/^\/api\/todos\/([^/]+)$/);
    const found = match === null ? undefined : todos.find((row) => row.id === match[1]);
    return found === undefined ? undefined : json(found);
  });
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

test('opening and closing a thread keeps the project filter', async ({ page }) => {
  await open(page);
  const sidebar = page.locator('aside.board-sidebar');
  await sidebar.locator('[data-slot="sidebar-project-row"]', { hasText: PROJECT.name }).click();
  await expect(page).toHaveURL(/[?&]project=proj-1/);
  await expect(sidebar).not.toContainText('Other project');
  await sidebar.locator('[data-slot="sidebar-thread-row"]', { hasText: 'Pick a provider' }).getByRole('button').click();
  await expect(page).toHaveURL(/[?&]thread=t-ask/);
  await expect(page).toHaveURL(/[?&]project=proj-1/);
  await expect(sidebar).not.toContainText('Other project');
  await expect(page.getByTestId('side-chat')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/[?&]thread=/);
  await expect(page).toHaveURL(/[?&]project=proj-1/);
  await expect(sidebar).not.toContainText('Other project');
});

test('threads of an archived project leave the groups and counts until it is selected', async ({
  page,
}) => {
  const now = Date.now();
  const todos = [
    { ...TASK, id: 't-live', title: 'Live thread', phase: 'building', phaseAt: now - 5 * MIN },
    {
      ...TASK,
      id: 't-old',
      projectId: 'proj-old',
      title: 'Archived project thread',
      phase: 'confirm',
      phaseAt: now - 5 * MIN,
    },
  ];
  const projects = [PROJECT, { ...PROJECT, id: 'proj-old', name: 'attic', archivedAt: now }];
  await mockLive(page, { threads: [THREAD], messages: [], todos, projects });
  await page.goto('/app');
  const sidebar = page.locator('aside.board-sidebar');
  await expect(sidebar).toContainText('Live thread');
  await expect(sidebar).not.toContainText('Archived project thread');
  await expect(sidebar.getByTestId('thread-group-needs-you')).toHaveCount(0);
  await expect(sidebar.getByTestId('attention-badge')).toHaveCount(0);
  await sidebar.getByTestId('archived-group').getByRole('button').first().click();
  await sidebar.locator('[data-slot="sidebar-project-row"]', { hasText: 'attic' }).click();
  await expect(sidebar).toContainText('Archived project thread');
  await expect(sidebar.getByTestId('attention-badge')).toHaveText('1');
});
