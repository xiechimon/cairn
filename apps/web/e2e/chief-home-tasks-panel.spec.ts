import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=home-c';

const panel = (page: Page) => page.getByRole('complementary', { name: '任务' });
const madePanel = (page: Page) => page.getByRole('complementary', { name: '成果' });
const tasksButton = (page: Page) => page.getByTestId('home-c').getByRole('button', { name: '任务' });
const madeButton = (page: Page) => page.getByTestId('home-c').getByRole('button', { name: '成果' });

test('the Tasks toggle carries the needs-you count and opens sections in Duet order', async ({
  page,
}) => {
  await page.goto(HOME);
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByTestId('tasks-badge')).toHaveText('3');
  await tasksButton(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(page).toHaveURL(/[?&]pane=tasks/);
  const sections = panel(page).getByTestId('tasks-section');
  await expect(sections).toHaveCount(4);
  await expect(sections.nth(0)).toHaveAttribute('data-section', 'ready_for_review');
  await expect(sections.nth(1)).toHaveAttribute('data-section', 'needs_input');
  await expect(sections.nth(2)).toHaveAttribute('data-section', 'working');
  await expect(sections.nth(3)).toHaveAttribute('data-section', 'resolved');
  await expect(sections.nth(0)).toContainText('Fold finished turns into purpose and duration');
  await expect(sections.nth(1)).toContainText('Connect a Claude subscription token');
  await expect(sections.nth(2)).toContainText('Orb canary round 7');
  await expect(sections.nth(2)).toContainText('Rerun the relay probe');
  await expect(sections.nth(3).locator('[data-slot="task-row"]')).toHaveCount(0);
  await expect(panel(page)).not.toContainText('Sidebar status groups');

  await page.reload();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('button', { name: '关闭' }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/pane=/);
});

test('every row waiting on the owner says what is waiting and where to act', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  const waiting = panel(page).locator('[data-slot="task-row"][data-waiting]');
  await expect(waiting).toHaveCount(3);
  for (const row of await waiting.all()) {
    await expect(row.locator('[data-slot="task-row-where"]')).toBeVisible();
    await expect(row).not.toContainText('已就绪，等你审阅');
  }
  const question = panel(page)
    .locator('[data-section="needs_input"] [data-slot="task-row"]')
    .first();
  await expect(question).toContainText('Credential relay · #74');
  await expect(question).toContainText('在问题卡里选');
  await expect(
    panel(page).locator('[data-slot="task-row"]').filter({ hasText: 'Connect a Claude' }),
  ).toContainText('到任务里批准计划');
  await expect(
    panel(page).locator('[data-slot="task-row"]').filter({ hasText: 'Fold finished turns' }),
  ).toContainText('到任务里看改动');
  const working = panel(page).locator('[data-section="working"] [data-slot="task-row"]');
  await expect(working.locator('[data-slot="task-row-where"]')).toHaveCount(0);
  await expect(working.locator('[data-slot="task-row-running"]')).toHaveCount(3);
});

test('Resolved opens on demand and Up next lists tasks not started', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page).getByRole('button', { name: /^已解决/ }).click();
  await expect(panel(page).locator('[data-section="resolved"]')).toContainText(
    'Unread dot on threads',
  );
  await panel(page).getByRole('tab', { name: /待开始/ }).click();
  const next = panel(page).locator('[data-section="up_next"] [data-slot="task-row"]');
  await expect(next).toHaveCount(1);
  await expect(next).toContainText('Sidebar status groups');
});

test('a row opens its thread in the side chat', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page).getByText('Orb canary round 7').click();
  await expect(page).toHaveURL(/[?&]thread=home-c-working-c/);
  await expect(page.getByTestId('side-chat')).toContainText('Orb canary round 7');
});

test('the plus button focuses the Coordinator composer', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page).getByTestId('tasks-new').click();
  await expect(page.locator('.chief-composer textarea')).toBeFocused();
});

test('Manage schedules links to the schedules page', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page).getByRole('link', { name: '管理定时' }).click();
  await expect(page).toHaveURL(/\/app\/schedules/);
});

test('with no tasks the panel shows one sentence and the toggle has no badge', async ({ page }) => {
  await page.goto('/app?scenario=home-c-empty&pane=tasks');
  await expect(panel(page).getByTestId('tasks-empty')).toBeVisible();
  await expect(page.getByTestId('tasks-badge')).toHaveCount(0);
});

test('the Made button swaps the panel to finished work', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await madeButton(page).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(madePanel(page)).toBeVisible();
  await expect(page).toHaveURL(/[?&]pane=made/);
  await expect(madePanel(page)).toContainText('Unread dot on threads');
  await expect(madePanel(page)).not.toContainText('Orb canary round 7');
  await madeButton(page).click();
  await expect(madePanel(page)).toHaveCount(0);
});

test('Made shows an empty state when nothing has finished', async ({ page }) => {
  await page.goto('/app?scenario=home-c-empty&pane=made');
  await expect(madePanel(page).getByTestId('made-empty')).toBeVisible();
});

test('the composer has no in-progress pill above it', async ({ page }) => {
  await page.goto(HOME);
  await expect(page.getByTestId('home-c').locator('.chief-composer')).toBeVisible();
  await expect(page.getByTestId('in-progress-pill')).toHaveCount(0);
});

test('the sidebar has no Schedules row in any layout', async ({ page }) => {
  await page.goto(HOME);
  const aside = page.locator('.board-sidebar');
  await expect(aside.getByRole('button', { name: '定时' })).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
  await page.reload();
  await expect(page.getByRole('complementary').first().getByRole('link', { name: '定时' })).toHaveCount(0);
});

test('at phone width the panel overlays without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${HOME}&pane=tasks`);
  await expect(panel(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );
});
