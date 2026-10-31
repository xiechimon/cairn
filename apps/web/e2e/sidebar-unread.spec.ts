import { expect, type Page, test } from '@playwright/test';

const SCENARIO = 'sidebar-unread';
const UNREAD_THREAD = 'sidebar-unread-a';
const READ_THREAD = 'sidebar-unread-b';

const row = (page: Page, title: string) =>
  page.getByTestId('sidebar-thread-row').filter({ hasText: title });
const dot = (page: Page, title: string) => row(page, title).getByTestId('unread-dot');

async function markUnread(page: Page, title: string) {
  await row(page, title).hover();
  await row(page, title).getByTestId('thread-row-menu').click();
  await page.getByTestId('thread-row-mark-unread').click();
}

test('only the unread thread shows the dot', async ({ page }) => {
  await page.goto(`/app?scenario=${SCENARIO}`);

  await expect(dot(page, 'unread thread A')).toHaveCount(1);
  await expect(dot(page, 'read thread B')).toHaveCount(0);
  await expect(page.getByTestId('unread-dot')).toHaveCount(1);
});

test('opening the thread clears the dot and it stays cleared after reload', async ({ page }) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await expect(dot(page, 'unread thread A')).toHaveCount(1);

  await row(page, 'unread thread A').click();
  await expect(page).toHaveURL(new RegExp(`/app/todo/${UNREAD_THREAD}\\?`));
  await expect(page.getByTestId('unread-dot')).toHaveCount(0);

  await page.reload();
  await expect(row(page, 'unread thread A')).toHaveCount(1);
  await expect(page.getByTestId('unread-dot')).toHaveCount(0);
});

test('Mark as unread is the first menu item and brings the dot back across reload', async ({
  page,
}) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await expect(dot(page, 'read thread B')).toHaveCount(0);

  await row(page, 'read thread B').hover();
  await row(page, 'read thread B').getByTestId('thread-row-menu').click();
  await expect(page.getByRole('menuitem').first()).toHaveAttribute(
    'data-testid',
    'thread-row-mark-unread',
  );
  await page.getByTestId('thread-row-mark-unread').click();

  await expect(dot(page, 'read thread B')).toHaveCount(1);
  await page.reload();
  await expect(dot(page, 'read thread B')).toHaveCount(1);
  await expect(dot(page, 'unread thread A')).toHaveCount(1);
});

test('marking the open thread unread keeps the dot until you leave it', async ({ page }) => {
  await page.goto(`/app/todo/${READ_THREAD}?scenario=${SCENARIO}`);
  await expect(row(page, 'read thread B')).toHaveCount(1);
  await expect(dot(page, 'read thread B')).toHaveCount(0);

  await markUnread(page, 'read thread B');
  await expect(dot(page, 'read thread B')).toHaveCount(1);

  await row(page, 'unread thread A').click();
  await expect(page).toHaveURL(new RegExp(`/app/todo/${UNREAD_THREAD}\\?`));
  await expect(dot(page, 'read thread B')).toHaveCount(1);
  await expect(dot(page, 'unread thread A')).toHaveCount(0);
});

test('the dot yields to the hover menu trigger', async ({ page }) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await expect(dot(page, 'unread thread A')).toBeVisible();

  await row(page, 'unread thread A').hover();
  await expect(dot(page, 'unread thread A')).toBeHidden();
  await expect(row(page, 'unread thread A').getByTestId('thread-row-menu')).toBeVisible();
});

test('opening an unread thread on a narrow viewport with the drawer closed marks it read', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/app/todo/${UNREAD_THREAD}?scenario=${SCENARIO}`);
  await expect(page).toHaveURL(new RegExp(`/app/todo/${UNREAD_THREAD}\\?`));

  await page.getByRole('link', { name: '返回' }).click();
  await page.getByRole('button', { name: '展开侧边栏' }).click();
  const drawer = page.getByRole('dialog', { name: '侧边栏' });
  await expect(drawer.getByTestId('sidebar-thread-row').filter({ hasText: 'unread thread A' })).toBeVisible();
  await expect(page.getByTestId('unread-dot')).toHaveCount(0);
});

test('a hidden document keeps the dot until it becomes visible', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { visibility: 'hidden' };
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state.visibility,
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => state.visibility === 'hidden',
    });
    (window as unknown as { __setVisibility: (value: string) => void }).__setVisibility = (
      value,
    ) => {
      state.visibility = value;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
  await page.goto(`/app/todo/${UNREAD_THREAD}?scenario=${SCENARIO}`);
  await expect(dot(page, 'unread thread A')).toHaveCount(1);
  await page.waitForTimeout(500);
  await expect(dot(page, 'unread thread A')).toHaveCount(1);

  await page.evaluate(() =>
    (window as unknown as { __setVisibility: (value: string) => void }).__setVisibility('visible'),
  );
  await expect(page.getByTestId('unread-dot')).toHaveCount(0);
});
