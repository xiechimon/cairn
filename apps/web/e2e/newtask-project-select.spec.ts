import { expect, type Page, test } from '@playwright/test';

const PICKER = '/app?scenario=newtask-projects';
const DEFAULT = '/app?scenario=01';

async function openDialog(page: Page, route: string) {
  await page.goto(route);

  await page.locator('.sidebar-new-task').click();
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openPopover(page: Page, route: string) {
  const dialog = await openDialog(page, route);
  await dialog.getByTestId('new-task-project-chip').click();
  const menu = page.getByRole('listbox', { name: '项目' });
  await expect(menu).toBeVisible();
  return { dialog, menu };
}

test('the project chip opens the project listbox with the scenario rows', async ({ page }) => {
  const { menu } = await openPopover(page, PICKER);
  await expect(menu.getByRole('option')).toHaveCount(2);
  await expect(menu.getByRole('option').first()).toContainText('r3-lifecycle');
  await expect(menu.getByRole('option').nth(1)).toContainText('r2-inventory');
});

test('row click selects and backfills the chip; the check moves on reopen', async ({ page }) => {
  const { dialog, menu } = await openPopover(page, PICKER);
  await menu.getByRole('option', { name: /r2-inventory/ }).click();
  await expect(page.getByRole('listbox', { name: '项目' })).toBeHidden();
  const chip = dialog.getByTestId('new-task-project-chip');
  await expect(chip.getByText('r2-inventory')).toHaveText('r2-inventory');

  // reopening shows the selection state: the r2-inventory row carries
  // aria-selected, the canon default row does not
  await chip.click();
  const reopened = page.getByRole('listbox', { name: '项目' });
  await expect(reopened).toBeVisible();
  await expect(reopened.getByRole('option', { name: /r2-inventory/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(reopened.getByRole('option').first()).toHaveAttribute('aria-selected', 'false');
});

test('a scenario without projectNames falls back to the canon default row', async ({ page }) => {
  const { menu } = await openPopover(page, DEFAULT);
  const rows = menu.getByRole('option');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('r3-lifecycle');
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
});

test('Escape closes the popover layer first, then the dialog', async ({ page }) => {
  const { menu } = await openPopover(page, PICKER);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.getByRole('dialog', { name: '新建任务' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '新建任务' })).toBeHidden();
});

test('outside click closes the popover layer only', async ({ page }) => {
  const { menu } = await openPopover(page, PICKER);
  await page.mouse.click(20, 20);
  await expect(menu).toBeHidden();
  await expect(page.getByRole('dialog', { name: '新建任务' })).toBeVisible();
});
