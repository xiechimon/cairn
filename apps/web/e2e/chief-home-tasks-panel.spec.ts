import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=home-c';

const panel = (page: Page) => page.getByRole('complementary', { name: '任务' });
const madePanel = (page: Page) => page.getByRole('complementary', { name: '成果' });
const tasksButton = (page: Page) => page.getByTestId('home-c').getByRole('button', { name: '任务' });
const madeButton = (page: Page) => page.getByTestId('home-c').getByRole('button', { name: '成果' });

test('the Tasks button opens one list grouped as needs you, in progress, idle', async ({
  page,
}) => {
  await page.goto(HOME);
  await expect(panel(page)).toHaveCount(0);
  await expect(tasksButton(page).getByTestId('tasks-attention-dot')).toBeVisible();
  await tasksButton(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(page).toHaveURL(/[?&]pane=tasks/);
  await expect(panel(page).getByRole('tab')).toHaveCount(0);
  const groups = panel(page).locator('[data-slot="stone-group"]');
  await expect(groups).toHaveCount(3);
  await expect(groups.nth(0)).toHaveAttribute('data-tone', 'waiting');
  await expect(groups.nth(1)).toHaveAttribute('data-tone', 'working');
  await expect(groups.nth(2)).toHaveAttribute('data-tone', 'idle');
  await expect(groups.nth(0)).toContainText('Connect a Claude subscription token');
  await expect(groups.nth(1)).toContainText('Orb canary round 7');
  await expect(groups.nth(2)).toContainText('Sidebar status groups');
  await expect(panel(page)).not.toContainText('Unread dot on threads');

  await page.reload();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('button', { name: '关闭' }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/pane=/);
});

test('an idle row opens its thread in the side chat', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page).getByText('Sidebar status groups').click();
  await expect(page).toHaveURL(/[?&]thread=home-c-idle/);
  await expect(page.getByTestId('side-chat')).toContainText('Sidebar status groups');
});

test('a schedule sits in idle once, never beside its own running or idle task, and links to the full schedules page', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  const idle = panel(page).locator('[data-slot="stone-group"][data-tone="idle"]');
  await expect(idle.locator('[data-slot="thread-row"]').filter({ hasText: '#1' })).toHaveCount(1);
  await expect(
    idle.locator('[data-slot="thread-row"]').filter({ hasText: 'Sidebar status groups' }),
  ).toHaveCount(1);
  await expect(idle.locator('[data-slot="thread-row"]')).toHaveCount(2);
  await expect(idle).not.toContainText('Orb canary round 7');
  await panel(page).getByRole('link', { name: '管理定时' }).click();
  await expect(page).toHaveURL(/\/app\/schedules/);
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

test('a group header folds its rows', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  const waiting = panel(page).locator('[data-slot="stone-group"][data-tone="waiting"]');
  await expect(waiting.locator('[data-slot="thread-row"]')).toHaveCount(3);
  await waiting.getByRole('button', { name: /等你处理/ }).click();
  await expect(waiting.locator('[data-slot="thread-row"]')).toHaveCount(0);
  await expect(panel(page)).toContainText('Orb canary round 7');
});
