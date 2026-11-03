import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=home-c';

const sideChat = (page: Page) => page.getByTestId('side-chat');
const tasksPanel = (page: Page) => page.getByRole('complementary', { name: '任务' });
const handle = (page: Page) => page.getByTestId('side-panel-resize');
const panelWidth = (page: Page) =>
  page
    .locator('aside.side-panel')
    .evaluate((node) => Math.round(node.getBoundingClientRect().width));

test('a task row opens its thread beside the Coordinator, and closing it returns to the list', async ({
  page,
}) => {
  await page.goto(`${HOME}&pane=tasks`);
  await tasksPanel(page).getByText('Push for finished threads').click();
  await expect(page).toHaveURL(/[?&]thread=home-c-working-a/);
  await expect(page).toHaveURL(/\/app\?/);
  await expect(sideChat(page)).toContainText('#2302');
  await expect(sideChat(page)).toContainText('Push for finished threads');
  await expect(page.getByTestId('side-chat-status')).toContainText('运行中');
  await expect(page.getByTestId('transcript-col')).toBeVisible();
  await expect(page.getByTestId('home-c')).toBeVisible();
  await expect(tasksPanel(page)).toHaveCount(0);
  expect(await panelWidth(page)).toBe(420);

  await sideChat(page).getByRole('button', { name: '关闭' }).click();
  await expect(sideChat(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/thread=/);
  await expect(tasksPanel(page)).toBeVisible();
});

test('a needs-you card opens the thread in the side chat', async ({ page }) => {
  await page.goto(HOME);
  await page
    .locator('[data-slot="thread-card"]')
    .filter({ hasText: 'Connect a Claude subscription token' })
    .getByRole('button', { name: '查看 thread' })
    .click();
  await expect(sideChat(page)).toContainText('Connect a Claude subscription token');
  await expect(page.getByTestId('side-chat-status')).toContainText('待你决定');
});

test('Escape closes the side chat', async ({ page }) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  await expect(sideChat(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sideChat(page)).toHaveCount(0);
});

test('the panel is resizable by keyboard and by drag, shared with Tasks, and remembered', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  await expect(handle(page)).toHaveAttribute('aria-valuenow', '420');
  await handle(page).focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(handle(page)).toHaveAttribute('aria-valuenow', '452');
  expect(await panelWidth(page)).toBe(452);

  const box = await handle(page).boundingBox();
  if (box == null) throw new Error('resize handle has no box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 5 });
  await page.mouse.up();
  await expect(handle(page)).toHaveAttribute('aria-valuenow', '552');

  await page.reload();
  await expect(sideChat(page)).toBeVisible();
  expect(await panelWidth(page)).toBe(552);
  await sideChat(page).getByRole('button', { name: '关闭' }).click();
  await page.getByTestId('home-c').getByRole('button', { name: '任务' }).click();
  await expect(tasksPanel(page)).toBeVisible();
  expect(await panelWidth(page)).toBe(552);

  await handle(page).dblclick();
  await expect(handle(page)).toHaveAttribute('aria-valuenow', '420');
  await handle(page).focus();
  await page.keyboard.press('End');
  await expect(handle(page)).toHaveAttribute('aria-valuenow', String(Math.floor(1440 * 0.6)));
  await page.keyboard.press('Home');
  await expect(handle(page)).toHaveAttribute('aria-valuenow', '360');
});

test('a thread that has not started says so and takes no message', async ({ page }) => {
  await page.goto(`${HOME}&thread=home-c-idle`);
  await expect(page.locator('.side-panel').getByTestId('composer-placeholder')).toHaveText(
    '开始后才能回复 #2240',
  );
  await expect(page.locator('.side-panel textarea')).toHaveCount(0);
});

test('an unknown thread id shows a not-found state', async ({ page }) => {
  await page.goto(`${HOME}&thread=no-such-thread`);
  await expect(page.getByTestId('side-chat-unavailable')).toHaveAttribute('data-state', 'missing');
  await expect(page.getByTestId('side-chat-unavailable')).toContainText('任务不存在或已被删除');
});

test('a wide panel re-clamps when the window narrows', async ({ page }) => {
  await page.setViewportSize({ width: 2000, height: 900 });
  await page.goto(`${HOME}&thread=home-c-review`);
  await handle(page).focus();
  await page.keyboard.press('End');
  expect(await panelWidth(page)).toBe(1200);
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect.poll(() => panelWidth(page)).toBe(720);
  await expect(handle(page)).toHaveAttribute('aria-valuenow', '720');
});

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the side chat covers the screen and hides the menu button and resize handle', async ({
    page,
  }) => {
    await page.goto(`${HOME}&thread=home-c-review`);
    await expect(sideChat(page)).toBeVisible();
    expect(await panelWidth(page)).toBe(390);
    await expect(page.locator('.app-menu-trigger')).toBeHidden();
    await expect(handle(page)).toBeHidden();
  });

  test('typing never lands in the Coordinator composer the side chat covers', async ({ page }) => {
    await page.goto(HOME);
    await page.locator('body').click({ position: { x: 5, y: 400 } });
    await page.keyboard.type('h');
    await expect(page.getByTestId('chief-composer-input')).toBeFocused();
    await page.goto(`${HOME}&thread=home-c-working-a`);
    await expect(sideChat(page)).toBeVisible();
    await page.locator('body').click({ position: { x: 5, y: 400 } });
    await page.keyboard.type('h');
    await expect(page.getByTestId('chief-composer-input')).not.toBeFocused();
  });
});

const action = (page: Page) => page.getByTestId('side-chat-action');

test('each waiting phase puts its next step in a card above the composer', async ({ page }) => {
  const cases = [
    ['home-c-idle', 'start', '开始'],
    ['home-c-confirm', 'approve', '批准计划'],
    ['home-c-review', 'finish', '完成…'],
    ['home-c-failed', 'retry', '重试'],
  ] as const;
  for (const [id, kind, label] of cases) {
    await page.goto(`${HOME}&thread=${id}`);
    await expect(action(page), id).toHaveAttribute('data-action', kind);
    await expect(action(page).getByRole('button', { name: label })).toBeVisible();
  }
  await page.goto(`${HOME}&thread=home-c-working-a`);
  await expect(sideChat(page)).toBeVisible();
  await expect(action(page)).toHaveCount(0);
});

test('finishing a reviewed thread asks to merge or keep the branch', async ({ page }) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  await action(page).getByRole('button', { name: '完成…' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(sideChat(page)).toBeVisible();
});

test('the more menu holds archive and delete, and Escape closes the menu first', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-failed`);
  await sideChat(page).getByRole('button', { name: '更多操作…' }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /删除/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Archive|归档/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(sideChat(page)).toBeVisible();

  await sideChat(page).getByRole('button', { name: '更多操作…' }).click();
  await page.getByRole('menuitem', { name: /删除/ }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Rerun the relay probe');
});

test('a plan waiting for approval opens in full from the card and from the transcript', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-confirm`);
  await action(page).getByRole('button', { name: '查看计划' }).click();
  const plan = page.getByTestId('side-chat-plan');
  await expect(plan).toBeVisible();
  await expect(plan.locator('.doc-body, [data-testid="doc-pane"]').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(plan).toHaveCount(0);
  await expect(sideChat(page)).toBeVisible();
});
