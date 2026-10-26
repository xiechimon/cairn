import { expect, type Locator, type Page, test } from '@playwright/test';

const STORAGE_KEY = 'cairn.newTaskProjectId'; // mirrored: new-task-dialog.tsx
const BOARD = '/app?scenario=newtask-projects&view=board';
const PROJECT = '/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=newtask-projects';

/** Seed the memory before any navigation (and keep it across reloads). */
function seedStoredProject(page: Page, projectId: string) {
  return page.addInitScript(
    ([key, id]) => window.localStorage.setItem(key, id),
    [STORAGE_KEY, projectId],
  );
}

async function openDialog(page: Page) {
  await page.locator('.sidebar-new-task').click();
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  await expect(dialog).toBeVisible();
  return dialog;
}

function projectChip(dialog: Locator) {
  return dialog.getByTestId('new-task-project-chip');
}

async function pick(page: Page, dialog: Locator, name: string) {
  await projectChip(dialog).click();
  await page.getByRole('listbox', { name: '项目' }).getByRole('option', { name }).click();
  await expect(projectChip(dialog).getByText(name)).toHaveText(name);
}

test('the picked project survives a reload', async ({ page }) => {
  await page.goto(BOARD);
  let dialog = await openDialog(page);
  await pick(page, dialog, 'r2-inventory');

  await page.reload();
  dialog = await openDialog(page);
  await expect(projectChip(dialog).getByText('r2-inventory')).toHaveText('r2-inventory');
  await projectChip(dialog).click();
  await expect(
    page.getByRole('listbox', { name: '项目' }).getByRole('option', { name: 'r2-inventory' }),
  ).toHaveAttribute('aria-selected', 'true');
});

test('a remembered project that is gone falls back to the first row', async ({ page }) => {
  await seedStoredProject(page, 'ghost-project');
  await page.goto(BOARD);
  const dialog = await openDialog(page);
  await expect(projectChip(dialog).getByText('r3-lifecycle')).toHaveText('r3-lifecycle');
  await projectChip(dialog).click();
  await expect(
    page.getByRole('listbox', { name: '项目' }).getByRole('option').first(),
  ).toHaveAttribute('aria-selected', 'true');

  await expect(page.locator('.board-column').first()).toBeVisible();
});

test('with nothing stored the chip starts on the first row', async ({ page }) => {
  await page.goto(BOARD);
  const dialog = await openDialog(page);
  await expect(projectChip(dialog).getByText('r3-lifecycle')).toHaveText('r3-lifecycle');
});

test('the anchored project page keeps its route project while the board honors the memory', async ({
  page,
}) => {
  await seedStoredProject(page, 'r2-inventory');

  await page.goto(PROJECT);
  const anchored = await openDialog(page);
  await expect(projectChip(anchored).getByText('r3-lifecycle')).toHaveText('r3-lifecycle');

  await page.goto(BOARD);
  const board = await openDialog(page);
  await expect(projectChip(board).getByText('r2-inventory')).toHaveText('r2-inventory');
});
