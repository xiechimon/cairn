import { expect, type Page, test } from '@playwright/test';

const THREADS_SCENARIO = 'sidebar-threads';
const STATUS_SCENARIO = 'sidebar-thread-statuses';

const P1_THREAD = 'sidebar-thread-p1';
const P2_THREAD = 'sidebar-thread-p2';

const groups = (page: Page) => page.getByTestId('sidebar-project-group');
const group = (page: Page, project: string) => groups(page).filter({ hasText: project });
const threadRows = (page: Page) => page.getByTestId('sidebar-thread-row');

test('each project group lists only its own running thread', async ({ page }) => {
  await page.goto(`/app?scenario=${THREADS_SCENARIO}`);

  await expect(groups(page)).toHaveCount(2);
  const p1 = group(page, 'P1');
  const p2 = group(page, 'P2');
  await expect(p1.getByTestId('sidebar-thread-row')).toHaveCount(1);
  await expect(p2.getByTestId('sidebar-thread-row')).toHaveCount(1);
  await expect(p1.getByTestId('sidebar-thread-row')).toContainText('P1 running thread');
  await expect(p2.getByTestId('sidebar-thread-row')).toContainText('P2 running thread');
  await expect(p1.getByTestId('sidebar-thread-row')).toHaveAttribute('data-status', 'running');
  await expect(p2.getByTestId('sidebar-thread-row')).toHaveAttribute('data-status', 'running');
});

test('status maps to data-status for every phase family', async ({ page }) => {
  await page.goto(`/app?scenario=${STATUS_SCENARIO}`);

  const status = (title: string) => threadRows(page).filter({ hasText: title });
  await expect(status('status running')).toHaveAttribute('data-status', 'running');
  await expect(status('status review')).toHaveAttribute('data-status', 'needs-you');
  await expect(status('status failed')).toHaveAttribute('data-status', 'failed');
  await expect(status('status done')).toHaveAttribute('data-status', 'done');
  await expect(status('status todo')).toHaveAttribute('data-status', 'idle');
});

test('clicking a thread row navigates to its detail route client-side', async ({ page }) => {
  await page.goto(`/app?scenario=${THREADS_SCENARIO}`);
  await page.evaluate(() => {
    (window as unknown as { __canary: string }).__canary = 'alive';
  });

  await group(page, 'P2').getByTestId('sidebar-thread-row').click();

  await expect(page).toHaveURL(new RegExp(`/app/todo/${P2_THREAD}\\?`));
  expect(await page.evaluate(() => (window as unknown as { __canary?: string }).__canary)).toBe(
    'alive',
  );
  await expect(
    group(page, 'P2').getByTestId('sidebar-thread-row').locator('[data-slot="sidebar-thread-row"]'),
  ).toHaveAttribute('data-open', '');
});

test('hover reveals the menu; archive sits inside it and drops the row', async ({ page }) => {
  await page.goto(`/app?scenario=${THREADS_SCENARIO}`);
  const row = group(page, 'P1').getByTestId('sidebar-thread-row');

  await expect(row.getByTestId('thread-row-menu')).toBeHidden();
  await row.hover();
  const menu = row.getByTestId('thread-row-menu');
  await expect(menu).toBeVisible();

  await menu.click();
  await expect(page.getByTestId('thread-row-archive')).toBeVisible();
  await expect(page.getByTestId('thread-row-copy-link')).toBeVisible();
  await expect(page.getByTestId('thread-row-delete')).toBeVisible();
  await expect(page.getByTestId('thread-row-mark-unread')).toBeVisible();
  await expect(page.getByTestId('thread-row-snooze')).toBeVisible();
  await expect(page.getByRole('menuitem')).toHaveCount(5);

  await page.getByTestId('thread-row-archive').click();
  await expect(group(page, 'P1').getByTestId('sidebar-thread-row')).toHaveCount(0);
  await expect(group(page, 'P2').getByTestId('sidebar-thread-row')).toHaveCount(1);
});

test('delete asks for confirmation; cancel keeps the row', async ({ page }) => {
  await page.goto(`/app?scenario=${THREADS_SCENARIO}`);
  const row = group(page, 'P1').getByTestId('sidebar-thread-row');

  await row.hover();
  await row.getByTestId('thread-row-menu').click();
  await page.getByTestId('thread-row-delete').click();

  const dialog = page.getByRole('alertdialog', { name: '删除任务' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveCount(1);

  await row.hover();
  await row.getByTestId('thread-row-menu').click();
  await page.getByTestId('thread-row-delete').click();
  await dialog.getByRole('button', { name: '删除' }).click();
  await expect(group(page, 'P1').getByTestId('sidebar-thread-row')).toHaveCount(0);
});

for (const [name, path] of [
  ['board', '/app'],
  ['detail', `/app/todo/${P1_THREAD}`],
  ['project', '/app/project/sidebar-project-b'],
] as const) {
  test(`the same list renders on ${name}`, async ({ page }) => {
    await page.goto(`${path}?scenario=${THREADS_SCENARIO}`);

    await expect(groups(page)).toHaveCount(2);
    await expect(group(page, 'P1').getByTestId('sidebar-thread-row')).toContainText(
      'P1 running thread',
    );
    await expect(group(page, 'P2').getByTestId('sidebar-thread-row')).toContainText(
      'P2 running thread',
    );
  });
}
