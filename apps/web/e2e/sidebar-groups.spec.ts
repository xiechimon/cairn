import { expect, type Page, test } from '@playwright/test';

const SCENARIO = 'sidebar-groups';

const row = (page: Page, title: string) =>
  page.getByTestId('sidebar-thread-row').filter({ hasText: title });
const archivedGroup = (page: Page) => page.getByTestId('group-archived');
const archivedRow = (page: Page, title: string) =>
  page.getByTestId('archived-thread-row').filter({ hasText: title });

async function openRowMenu(page: Page, title: string) {
  await row(page, title).hover();
  await row(page, title).getByTestId('thread-row-menu').click();
  await expect(page.getByRole('menuitem').first()).toBeVisible();
}

test('the archived group is collapsed by default and shows the archived count', async ({
  page,
}) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await expect(archivedGroup(page)).toBeVisible();
  await expect(archivedGroup(page)).toHaveAttribute('data-count', '2');
  await expect(page.getByTestId('group-archived-count')).toHaveText('2');
  await expect(page.getByTestId('group-archived-toggle')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByTestId('archived-thread-row')).toHaveCount(0);
});

test('the archived group sits below the snoozed group and there is no inactive group', async ({
  page,
}) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  const snoozed = await page.getByTestId('group-snoozed').boundingBox();
  const archived = await archivedGroup(page).boundingBox();
  expect(snoozed).not.toBeNull();
  expect(archived).not.toBeNull();
  expect((archived?.y ?? 0) > (snoozed?.y ?? 0)).toBe(true);
  await expect(page.getByTestId('group-inactive')).toHaveCount(0);
});

test('expanding lists the archived threads and Unarchive puts the row back', async ({ page }) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await page.getByTestId('group-archived-toggle').click();
  await expect(archivedRow(page, 'archived thread C')).toHaveCount(1);
  await expect(archivedRow(page, 'archived thread D')).toHaveCount(1);
  await expect(row(page, 'archived thread C')).toHaveCount(0);

  await archivedRow(page, 'archived thread C').hover();
  await archivedRow(page, 'archived thread C').getByTestId('archived-row-menu').click();
  await page.getByTestId('thread-row-unarchive').click();

  await expect(row(page, 'archived thread C')).toHaveCount(1);
  await expect(archivedRow(page, 'archived thread C')).toHaveCount(0);
  await expect(page.getByTestId('group-archived-count')).toHaveText('1');
});

test('archiving a thread adds it to the archived group count', async ({ page }) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await openRowMenu(page, 'active thread A');
  await page.getByTestId('thread-row-archive').click();
  await expect(row(page, 'active thread A')).toHaveCount(0);
  await expect(page.getByTestId('group-archived-count')).toHaveText('3');
});

test('the last unarchived thread removes the archived group', async ({ page }) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await page.getByTestId('group-archived-toggle').click();
  for (const title of ['archived thread C', 'archived thread D']) {
    await archivedRow(page, title).hover();
    await archivedRow(page, title).getByTestId('archived-row-menu').click();
    await page.getByTestId('thread-row-unarchive').click();
    await expect(archivedRow(page, title)).toHaveCount(0);
  }
  await expect(archivedGroup(page)).toHaveCount(0);
});

test('Rename opens a dialog and saving changes the row title', async ({ page }) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await openRowMenu(page, 'active thread A');
  await page.getByTestId('thread-row-rename').click();
  const dialog = page.getByRole('dialog', { name: '重命名线程' });
  await expect(dialog).toBeVisible();
  const input = dialog.getByTestId('thread-rename-input');
  await expect(input).toHaveValue('active thread A');
  await input.fill('renamed thread');
  await dialog.getByTestId('thread-rename-confirm').click();
  await expect(dialog).toBeHidden();
  await expect(row(page, 'renamed thread')).toHaveCount(1);
  await expect(row(page, 'active thread A')).toHaveCount(0);
});

test('Rename ignores the Enter that confirms an IME candidate and saves on a plain Enter', async ({
  page,
}) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await openRowMenu(page, 'active thread A');
  await page.getByTestId('thread-row-rename').click();
  const dialog = page.getByRole('dialog', { name: '重命名线程' });
  const input = dialog.getByTestId('thread-rename-input');
  await input.fill('改名中');
  await input.evaluate((el) => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }),
    );
  });
  await expect(dialog).toBeVisible();
  await expect(row(page, 'active thread A')).toHaveCount(1);
  await input.fill('改名完成');
  await input.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(row(page, '改名完成')).toHaveCount(1);
});

test('Rename with a blank title keeps Save disabled and Cancel keeps the title', async ({
  page,
}) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await openRowMenu(page, 'active thread A');
  await page.getByTestId('thread-row-rename').click();
  const dialog = page.getByRole('dialog', { name: '重命名线程' });
  await dialog.getByTestId('thread-rename-input').fill('   ');
  await expect(dialog.getByTestId('thread-rename-confirm')).toBeDisabled();
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, 'active thread A')).toHaveCount(1);
});

test('each menu item shows its single-key hint on the right', async ({ page }) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await openRowMenu(page, 'active thread A');
  const hint = (testId: string) => page.getByTestId(testId).getByTestId('menu-key-hint');
  await expect(hint('thread-row-mark-unread')).toHaveText('U');
  await expect(hint('thread-row-rename')).toHaveText('R');
  await expect(hint('thread-row-snooze')).toHaveText('S');
  await expect(hint('thread-row-copy-link')).toHaveText('L');
  await expect(hint('thread-row-archive')).toHaveText('A');
  await expect(hint('thread-row-delete')).toHaveText('D');
  await expect(page.getByRole('menuitem')).toHaveCount(6);
});

test('pressing A with the menu open archives the thread', async ({ page }) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await openRowMenu(page, 'active thread A');
  await page.keyboard.press('a');
  await expect(row(page, 'active thread A')).toHaveCount(0);
  await expect(page.getByTestId('group-archived-count')).toHaveText('3');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('pressing R opens the rename dialog and D opens the delete confirmation', async ({ page }) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await openRowMenu(page, 'active thread A');
  await page.keyboard.press('r');
  await expect(page.getByRole('dialog', { name: '重命名线程' })).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();

  await openRowMenu(page, 'active thread B');
  await page.keyboard.press('d');
  await expect(page.getByRole('alertdialog', { name: '删除任务' })).toBeVisible();
});

test('pressing U marks the thread unread and S opens the snooze submenu', async ({ page }) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await openRowMenu(page, 'active thread B');
  await page.keyboard.press('u');
  await expect(row(page, 'active thread B').getByTestId('unread-dot')).toHaveCount(1);

  await openRowMenu(page, 'active thread A');
  await page.keyboard.press('s');
  await expect(page.getByTestId('thread-snooze-menu')).toBeVisible();
  await expect(row(page, 'active thread A')).toHaveCount(1);
});

test('keys with a modifier do not run menu items', async ({ page }) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await openRowMenu(page, 'active thread A');
  await page.keyboard.press('Control+a');
  await expect(row(page, 'active thread A')).toHaveCount(1);
  await expect(page.getByRole('menuitem').first()).toBeVisible();
});

test('keys do not fire when the menu is closed', async ({ page }) => {
  await page.goto(`/app?scenario=${SCENARIO}`);
  await page.keyboard.press('a');
  await expect(row(page, 'active thread A')).toHaveCount(1);
});
