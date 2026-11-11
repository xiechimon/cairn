import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=home-c';

const sideChat = (page: Page) => page.getByTestId('side-chat');
const tasksPanel = (page: Page) => page.getByRole('complementary', { name: '任务' });
const handle = (page: Page) => page.getByTestId('side-panel-resize');
const panelWidth = (page: Page) =>
  page
    .locator('aside.side-panel')
    .evaluate((node) => Math.round(node.getBoundingClientRect().width));
const slideInDone = (page: Page) =>
  page
    .locator('.side-panel')
    .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

test('a task row opens its thread beside the Coordinator, and going back returns to the list', async ({
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

  await sideChat(page).getByRole('button', { name: '返回' }).click();
  await expect(sideChat(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/thread=/);
  await expect(tasksPanel(page)).toBeVisible();
});

test('a waiting task in the Tasks panel opens the thread in the side chat', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await tasksPanel(page)
    .locator('[data-slot="task-row"]')
    .filter({ hasText: 'Connect a Claude subscription token' })
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
  await handle(page).hover();
  await expect(page.locator('[data-slot="side-panel-resize-tip"]')).toHaveText('拖动调宽');
  await handle(page).focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(handle(page)).toHaveAttribute('aria-valuenow', '452');
  expect(await panelWidth(page)).toBe(452);

  await slideInDone(page);
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
    await slideInDone(page);
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

const changesButton = (page: Page) => page.getByTestId('side-chat-changes');

test('a reviewed thread shows its diff counts in the header and swaps the transcript for the changes', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  const button = changesButton(page);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).toContainText('+1');
  await expect(page.getByTestId('transcript-col')).toBeVisible();

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('side-chat-changes-view').getByTestId('doc-pane')).toBeVisible();
  await expect(page.getByTestId('side-chat-changes-view')).toContainText('README.md');
  await expect(page.getByTestId('doc-pane').getByRole('button', { name: /^v\d/ })).toHaveCount(0);
  await expect(page.getByTestId('transcript-col')).toHaveCount(0);

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('transcript-col')).toBeVisible();
  await expect(page.getByTestId('side-chat-changes-view')).toHaveCount(0);
});

test('a thread without build changes has no changes button', async ({ page }) => {
  for (const id of ['home-c-idle', 'home-c-working-a', 'home-c-confirm']) {
    await page.goto(`${HOME}&thread=${id}`);
    await expect(sideChat(page), id).toBeVisible();
    await expect(changesButton(page), id).toHaveCount(0);
  }
});

test('Escape leaves the changes first and closes the panel on the second press', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  await changesButton(page).click();
  await expect(page.getByTestId('side-chat-changes-view')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('side-chat-changes-view')).toHaveCount(0);
  await expect(sideChat(page)).toBeVisible();
  await expect(page.getByTestId('transcript-col')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sideChat(page)).toHaveCount(0);
});

test('the composer stays usable while the changes show, and switching threads returns to the conversation', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  await changesButton(page).click();
  const input = page.locator('.side-panel textarea');
  await input.fill('looks good');
  await expect(input).toHaveValue('looks good');
  await expect(page.getByTestId('side-chat-changes-view')).toBeVisible();

  await page.goto(`${HOME}&thread=home-c-working-a`);
  await expect(page.getByTestId('transcript-col')).toBeVisible();
  await expect(page.getByTestId('side-chat-changes-view')).toHaveCount(0);
  await page.goto(`${HOME}&thread=home-c-review`);
  await expect(changesButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test.describe('phone width changes', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the changes view and header fit the screen', async ({ page }) => {
    await page.goto(`${HOME}&thread=home-c-review`);
    await changesButton(page).click();
    await expect(page.getByTestId('side-chat-changes-view')).toBeVisible();
    const overflow = await page
      .locator('aside.side-panel')
      .evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await changesButton(page).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(32);
  });
});

test('with a thread open, digits leave the Coordinator question alone', async ({ page }) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  await expect(sideChat(page)).toBeVisible();
  const option = page.getByTestId('chief-question').getByTestId('chief-question-option-0-0');
  await expect(option).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('1');
  await expect(option).toHaveAttribute('aria-pressed', 'false');
});
