import { expect, type Page, test } from '@playwright/test';

const TASKS = '/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=prj-tasks';
const LAYOUT_KEY = 'cairn.projectTasksLayout';

const REVIEW_TITLE = '在 README.md 末尾追加一行「r3 lifecycle probe」';
const DONE_TITLE = '在 README.md 末尾追加一行「r3 lifecycle probe2」';

async function pickOption(page: Page, label: string) {
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitemradio', { name: label }).click();
  await expect(menu).not.toBeVisible();
}

test('view toggle swaps rows for grid cards and persists', async ({ page }) => {
  await page.goto(TASKS);
  const gridBtn = page.getByRole('tab', { name: '网格视图' });
  const listBtn = page.getByRole('tab', { name: '列表视图' });
  await expect(page.getByTestId('task-row')).toHaveCount(2);
  await expect(listBtn).toHaveAttribute('aria-selected', 'true');

  await gridBtn.click();
  await expect(page.getByTestId('task-row')).toHaveCount(0);
  await expect(page.getByTestId('task-card')).toHaveCount(2);
  await expect(gridBtn).toHaveAttribute('aria-selected', 'true');
  await expect(listBtn).toHaveAttribute('aria-selected', 'false');
  expect(await page.evaluate((k) => localStorage.getItem(k), LAYOUT_KEY)).toBe('grid');

  // the choice survives a reload (cairn.projectTasksLayout)
  await page.reload();
  await expect(page.getByTestId('task-card')).toHaveCount(2);
  await expect(page.getByTestId('task-row')).toHaveCount(0);

  // and the tablist is the way back — no trap in the grid layout
  await listBtn.click();
  await expect(page.getByTestId('task-row')).toHaveCount(2);
  expect(await page.evaluate((k) => localStorage.getItem(k), LAYOUT_KEY)).toBe('list');
});

test('a seeded grid key boots the grid without a gesture', async ({ page }) => {
  await page.addInitScript((k) => localStorage.setItem(k, 'grid'), LAYOUT_KEY);
  await page.goto(TASKS);
  await expect(page.getByTestId('task-card')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: '网格视图' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('filter menu options cut the list and close on select', async ({ page }) => {
  await page.goto(TASKS);
  const filterBtn = page.getByRole('button', { name: '筛选' });
  const titles = page.getByTestId('task-row').getByRole('link');

  await filterBtn.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemradio')).toHaveCount(3);

  await expect(menu.getByRole('menuitemradio').first()).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitemradio', { name: '全部' }).click();
  await expect(menu).not.toBeVisible();
  await expect(titles).toHaveCount(2);

  await filterBtn.click();
  await pickOption(page, '已完成');
  await expect(titles).toHaveCount(1);
  await expect(titles).toHaveText(DONE_TITLE);

  await filterBtn.click();
  await pickOption(page, '进行中');
  await expect(titles).toHaveCount(1);
  await expect(titles).toHaveText(REVIEW_TITLE);

  await filterBtn.click();
  await pickOption(page, '全部');
  await expect(titles).toHaveCount(2);
});

test('family law: Escape, outside click and re-click all close the menu', async ({ page }) => {
  await page.goto(TASKS);
  const filterBtn = page.getByRole('button', { name: '筛选' });
  const menu = page.getByRole('menu');

  await filterBtn.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();

  // transparent catcher: a page click outside the menu closes it
  await filterBtn.click();
  await expect(menu).toBeVisible();
  await page.mouse.click(600, 400);
  await expect(menu).not.toBeVisible();

  // re-clicking the trigger lands on the family click-catcher at the same
  // point — the user-visible effect is the toggle closing
  await filterBtn.click();
  await expect(menu).toBeVisible();
  await filterBtn.click({ force: true });
  await expect(menu).not.toBeVisible();
});

test('sort orders: `默认` source order, `最近更新` newest first, `标题` ascending', async ({ page }) => {
  await page.goto(TASKS);
  const titles = page.getByTestId('task-row').getByRole('link');
  const sortBtn = page.getByRole('button', { name: '排序' });

  await expect(titles.nth(0)).toHaveText(REVIEW_TITLE);
  await expect(titles.nth(1)).toHaveText(DONE_TITLE);

  await sortBtn.click();
  await pickOption(page, '最近更新');
  await expect(titles.nth(0)).toHaveText(DONE_TITLE);
  await expect(titles.nth(1)).toHaveText(REVIEW_TITLE);

  await sortBtn.click();
  await pickOption(page, '标题');
  await expect(titles.nth(0)).toHaveText(REVIEW_TITLE);
  await expect(titles.nth(1)).toHaveText(DONE_TITLE);

  await sortBtn.click();
  await pickOption(page, '默认');
  await expect(titles.nth(0)).toHaveText(REVIEW_TITLE);
});

test('search filters by title; no-match shows the match line, not `暂无内容`', async ({ page }) => {
  await page.goto(TASKS);
  const search = page.getByRole('textbox', { name: '搜索任务' });
  const titles = page.getByTestId('task-row').getByRole('link');

  await search.fill('probe2');
  await expect(titles).toHaveCount(1);
  await expect(titles).toHaveText(DONE_TITLE);

  // no match = the toolbar-empty line, never the create-first-task state
  await search.fill('zzz');
  await expect(titles).toHaveCount(0);
  await expect(page.getByText('没有匹配的任务')).toBeVisible();
  await expect(page.getByText('暂无内容')).toHaveCount(0);

  // clearing restores the full list
  await search.fill('');
  await expect(titles).toHaveCount(2);

  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=r2-24b');
  await expect(page.getByText('暂无内容')).toBeVisible();
  await expect(page.getByText('没有匹配的任务')).toHaveCount(0);
});

test('filter and search compose', async ({ page }) => {
  await page.goto(TASKS);
  await page.getByRole('textbox', { name: '搜索任务' }).fill('probe');
  await expect(page.getByTestId('task-row')).toHaveCount(2);

  await page.getByRole('button', { name: '筛选' }).click();
  await pickOption(page, '进行中');
  await expect(page.getByTestId('task-row').getByRole('link')).toHaveText(REVIEW_TITLE);

  await page.getByRole('textbox', { name: '搜索任务' }).fill('probe2');
  await expect(page.getByTestId('task-row')).toHaveCount(0);
  await expect(page.getByText('没有匹配的任务')).toBeVisible();
});
