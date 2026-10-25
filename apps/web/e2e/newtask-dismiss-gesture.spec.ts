import { expect, type Page, test } from '@playwright/test';

const ROUTE = '/app?scenario=newtask-projects';

async function openDialogWithPopover(page: Page) {
  await page.goto(ROUTE);

  await page.locator('.sidebar-new-task').click();
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('new-task-project-chip').click();
  const menu = page.getByRole('listbox', { name: '项目' });
  await expect(menu).toBeVisible();
  return { dialog, menu };
}

test('outside-press cycles: every gesture closes exactly the popover layer', async ({ page }) => {

  for (let cycle = 0; cycle < 12; cycle++) {
    const { dialog, menu } = await openDialogWithPopover(page);

    await page.mouse.click(20, 20);
    await expect(menu).toBeHidden();
    await expect(dialog).toBeVisible();
  }
});

test('escape cycles: every gesture closes exactly the popover layer', async ({ page }) => {
  for (let cycle = 0; cycle < 6; cycle++) {
    const { dialog, menu } = await openDialogWithPopover(page);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(dialog).toBeVisible();
  }
});

test('negative control: with no inner layer open, backdrop click still closes the dialog', async ({
  page,
}) => {
  await page.goto(ROUTE);
  await page.locator('.sidebar-new-task').click();
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  await expect(dialog).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(dialog).toBeHidden();
});

test('negative control: with no inner layer open, Escape still closes the dialog', async ({
  page,
}) => {
  await page.goto(ROUTE);
  await page.locator('.sidebar-new-task').click();
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('negative control: second escape after the popover closed takes the dialog down', async ({
  page,
}) => {
  const { dialog, menu } = await openDialogWithPopover(page);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
