import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=home-c';

const panel = (page: Page) => page.getByRole('complementary', { name: '任务' });
const madePanel = (page: Page) => page.getByRole('complementary', { name: '成果' });
const tasksButton = (page: Page) => page.getByTestId('home-c').getByRole('button', { name: '任务' });
const madeButton = (page: Page) => page.getByTestId('home-c').getByRole('button', { name: '成果' });

test('the Tasks button opens the panel on Active: needs-you first, then in progress', async ({
  page,
}) => {
  await page.goto(HOME);
  await expect(panel(page)).toHaveCount(0);
  await expect(tasksButton(page).getByTestId('tasks-attention-dot')).toBeVisible();
  await tasksButton(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(page).toHaveURL(/[?&]pane=tasks/);
  await expect(panel(page).getByRole('tab', { name: '进行中' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const groups = panel(page).locator('[data-slot="stone-group"]');
  await expect(groups.nth(0)).toHaveAttribute('data-tone', 'waiting');
  await expect(groups.nth(1)).toHaveAttribute('data-tone', 'working');
  await expect(panel(page)).toContainText('Connect a Claude subscription token');
  await expect(panel(page)).toContainText('Orb canary round 7');
  await expect(panel(page)).not.toContainText('Unread dot on threads');

  await page.reload();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('button', { name: '关闭' }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/pane=/);
});

test('Up next lists tasks not started; a row opens its thread', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page).getByRole('tab', { name: '接下来' }).click();
  await expect(panel(page)).toContainText('Sidebar status groups');
  await expect(panel(page)).not.toContainText('Orb canary round 7');
  await panel(page).getByText('Sidebar status groups').click();
  await expect(page).toHaveURL(/\/app\/todo\/home-c-idle/);
});

test('Scheduled lists schedules and links to the full schedules page', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await panel(page).getByRole('tab', { name: '定时' }).click();
  const rows = panel(page).locator('[data-slot="thread-row"]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('#1');
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

test('the in-progress pill opens the Tasks panel on In progress', async ({ page }) => {
  await page.goto(HOME);
  await page.getByTestId('in-progress-pill').click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText('Push for finished threads');

  await panel(page).getByRole('tab', { name: '定时' }).click();
  await madeButton(page).click();
  await page.getByTestId('in-progress-pill').click();
  await expect(panel(page).getByRole('tab', { name: '进行中' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(panel(page)).toContainText('Push for finished threads');
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
