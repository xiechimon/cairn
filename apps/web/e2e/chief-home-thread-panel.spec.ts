import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=home-c';
const panel = (page: Page) => page.getByTestId('side-chat');

test('a review thread leads with the updates block and shows the update count in the head', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  await expect(page.getByTestId('thread-updates')).toContainText('决定与更新');
  await expect(page.getByTestId('thread-updates')).toContainText('r7 rebaseline probe');
  await expect(page.getByTestId('thread-updates').locator('time')).toContainText('更新');
  await expect(page.getByTestId('side-chat-status')).toContainText('待你决定·1 条更新');
});

test('a working thread has no updates block', async ({ page }) => {
  await page.goto(`${HOME}&thread=home-c-working-c`);
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId('thread-updates')).toHaveCount(0);
});

test('the origin line names the main-chat message and scrolls the conversation to it', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  await expect(page.getByTestId('thread-origin')).toContainText('来自主对话 · ');
  await page.getByTestId('thread-origin-jump').click();
  await expect(
    page.locator('[data-testid="home-c"] [data-reply-source="home-c-ask-fold"]'),
  ).toBeInViewport();
});

test('a thread with no originating message shows no origin line', async ({ page }) => {
  await page.goto(`${HOME}&thread=home-c-working-a`);
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId('thread-origin')).toHaveCount(0);
});

test('a task waiting for review offers finishing once, as a quiet note above the composer', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  const note = page.getByTestId('side-chat-action');
  await expect(note).toHaveAttribute('data-action', 'finish');
  await expect(page.locator('.side-panel').getByRole('button', { name: /^(完成…|标记完成)$/ })).toHaveCount(1);
  const face = await note.evaluate((el) => {
    const button = el.querySelector('button')!;
    return {
      shadow: getComputedStyle(el).boxShadow,
      fill: getComputedStyle(el).backgroundColor,
      buttonFill: getComputedStyle(button).backgroundColor,
    };
  });
  expect(face).toEqual({
    shadow: 'none',
    fill: 'rgba(0, 0, 0, 0)',
    buttonFill: 'rgba(0, 0, 0, 0)',
  });
  await note.getByRole('button', { name: '完成…' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a working thread offers no action note', async ({ page }) => {
  await page.goto(`${HOME}&thread=home-c-working-c`);
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId('side-chat-action')).toHaveCount(0);
});

test('back returns to the tasks list and close leaves the panel area empty', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks&thread=home-c-review`);
  await panel(page).getByTestId('side-chat-back').click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: '任务' })).toBeVisible();
  await page.goto(`${HOME}&pane=tasks&thread=home-c-review`);
  await panel(page).getByRole('button', { name: '关闭' }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: '任务' })).toHaveCount(0);
});

test('an unread thread shows a dot on its task card, and opening the thread clears it', async ({
  page,
}) => {
  await page.goto('/app?scenario=home-c-unread');
  const card = page.locator('[data-slot="task-card"]').filter({ hasText: 'Orb canary round 7' });
  await expect(card.locator('[data-slot="task-card-unread"]')).toBeVisible();
  await expect(
    page
      .locator('[data-slot="task-card"]')
      .filter({ hasText: 'Fold finished turns' })
      .locator('[data-slot="task-card-unread"]'),
  ).toHaveCount(0);
  await card.click();
  await expect(page.getByTestId('side-chat')).toBeVisible();
  await expect(card.locator('[data-slot="task-card-unread"]')).toHaveCount(0);
});

test('the panel width is resizable and remembered', async ({ page }) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  const handle = page.getByTestId('side-panel-resize');
  await expect(handle).toHaveAttribute('aria-valuenow', '420');
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(handle).not.toHaveAttribute('aria-valuenow', '420');
  await page.reload();
  await expect(page.getByTestId('side-panel-resize')).not.toHaveAttribute('aria-valuenow', '420');
});
