import { expect, type Locator, type Page, test } from '@playwright/test';

// XMON-87: the new-task dialog's project chip was pure component state, so a
// reload dropped the pick back to rows[0] of the team set. The chip now
// remembers the pick in localStorage (key = NEW_TASK_PROJECT_STORAGE_KEY in
// overlay/new-task-dialog.tsx, mirrored below). Scope: the unanchored face
// (board / sidebar global dialog) only — the project page's own dialog keeps
// #305/#404, where the untouched default is the route project.
// Each test pins one failure mode:
// 1. pick a non-first row, reload → chip and check still on it
// 2. remembered id no longer in the project set → rows[0], board alive
// 3. nothing stored → rows[0] (the pre-fix default, unchanged)
// 4. the anchored project page ignores the memory while the board honors it
//
// #948 载体重钉（#910 裁定 1/2）：dialog = role+name；chip =
// data-testid "new-task-project-chip"（二级载体，与 machine-chip 对称）；
// 行 = getByRole('option')；chip 上的项目名 = chip scope getByText（一级
// text 载体，头像字母 span 不含全名故唯一命中）。断言语义逐字不动。

const STORAGE_KEY = 'cairn.newTaskProjectId'; // mirrored: new-task-dialog.tsx
const BOARD = '/app?scenario=newtask-projects';
const PROJECT = '/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=newtask-projects';

/** Seed the memory before any navigation (and keep it across reloads). */
function seedStoredProject(page: Page, projectId: string) {
  return page.addInitScript(
    ([key, id]) => window.localStorage.setItem(key, id),
    [STORAGE_KEY, projectId],
  );
}

// #389 opener on every route: the sidebar 新任务 row. On the project page it
// routes through the page's own dialog (anchored), elsewhere through the
// global one.
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
  // 不是白屏：看板本体照常渲染
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
