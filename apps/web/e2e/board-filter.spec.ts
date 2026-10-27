import { expect, type Page, test } from '@playwright/test';

const TAGS = '/app?scenario=board-tags&view=board';
const EMPTY = '/app?scenario=board-tags-empty&view=board';
const REPOS = '/app?scenario=board-repos&view=board';

const PRJ_CANON = 'ZAQczKCu0MOAzC1ZqcFlX';

const card = (page: Page, id: string) => page.locator(`[data-todo-id="${id}"]`);

const option = (page: Page, value: string) =>
  page.locator(`[data-project="${value}"], [data-tag="${value}"]`);
const repoOption = (page: Page, id?: string) =>
  page.locator(id == null ? '[data-project]' : `[data-project="${id}"]`);
const typeOption = (page: Page, name: string) => page.locator(`[data-tag="${name}"]`);
const dim = (page: Page, key: 'repo' | 'type') =>
  page.locator(`section[data-dimension="${key}"]`);

const dimAll = (page: Page, key: 'repo' | 'type') => dim(page, key).getByRole('checkbox');

const dimInvert = (page: Page, key: 'repo' | 'type') =>
  dim(page, key).getByRole('button', { name: '反选' });
const dimReadout = (page: Page, key: 'repo' | 'type') => dim(page, key).getByText(/已选 \d/);
const optionCount = (page: Page, value: string) =>
  option(page, value).getByTestId('option-count');

const optionOnly = (page: Page, value: string) =>
  option(page, value).locator('..').getByRole('button', { name: '仅此' });

const filterChip = (page: Page, key: 'repo' | 'type') =>
  page.locator(`header [data-dimension="${key}"]`);
const chipsBar = (page: Page) => page.locator('header [data-dimension]');
const chipsClear = (page: Page) =>
  page.locator('header').getByRole('button', { name: '清除全部' });

const typeBtn = (page: Page) => page.getByRole('button', { name: '筛选', exact: true });
const typePopover = (page: Page) => page.getByRole('dialog', { name: '筛选' });
const count = (page: Page, column: string) =>
  page.locator(`[data-column="${column}"]`).getByTestId('column-count');
const filterEmpty = (page: Page) => page.getByText('没有匹配筛选条件的任务');

const CHIP = '[style*="background-color"]';

async function openTypePopover(page: Page) {
  await typeBtn(page).click();
  await expect(typePopover(page)).toBeVisible();
}

test('legacy scenario (no projectNames) renders no repo section; top bar two buttons = bare filter button + new-task capsule', async ({
  page,
}) => {
  await page.goto('/app?scenario=01&view=board');

  await expect(chipsBar(page)).toHaveCount(0);
  const banner = page.getByRole('banner');
  await expect(banner.getByRole('button')).toHaveCount(1);
  await expect(typeBtn(page)).toBeVisible();
  await expect(page.getByTestId('board-new-task-bar')).toBeVisible();

  await expect(typeBtn(page)).toHaveAttribute('data-variant', 'ghost');
  const bg = await typeBtn(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(bg);
});

test('type button opens anchored popover: all 6 vocab words, aria-expanded flips', async ({ page }) => {
  await page.goto(TAGS);
  await expect(typeBtn(page)).toHaveAttribute('aria-expanded', 'false');
  await openTypePopover(page);
  await expect(typeBtn(page)).toHaveAttribute('aria-expanded', 'true');

  await expect(dimAll(page, 'type')).toBeVisible();
  await expect(dimAll(page, 'type')).toHaveAttribute('aria-checked', 'false');
  await expect(dimInvert(page, 'type')).toBeVisible();
  await expect(page.locator('[data-tag]')).toHaveCount(6);
  for (const name of ['bug', 'feature', 'improvement', 'refactor', 'docs', 'chore']) {
    await expect(typeOption(page, name)).toBeVisible();
    await expect(typeOption(page, name)).toHaveAttribute('aria-selected', 'false');
  }
});

test('type single-select narrows: hit cards visible, other tagged hidden, untagged always visible; URL carries insured scenario; column counts couple', async ({
  page,
}) => {
  await page.goto(TAGS);
  await openTypePopover(page);
  await typeOption(page, 'bug').click();
  await expect(page).toHaveURL(/[?&]tags=bug(&|$)/);
  expect(page.url()).toContain('scenario=board-tags');

  await expect(page.getByTestId('filter-count')).toHaveText('1');
  await expect(card(page, 'tagfilter-bug')).toBeVisible();
  await expect(card(page, 'tagfilter-docs')).toHaveCount(0);

  await expect(card(page, 'tagfilter-plain')).toBeVisible();
  await expect(count(page, 'todo')).toHaveText('1');
  await expect(count(page, 'building')).toHaveText('0');
  await expect(count(page, 'pending')).toHaveText('1');
});

test('type multi-select = OR union; URL order = vocab canonical order; picking keeps the popover open; selected chips visible', async ({
  page,
}) => {
  await page.goto(TAGS);
  await openTypePopover(page);

  await typeOption(page, 'docs').click();
  await typeOption(page, 'bug').click();
  await expect(page).toHaveURL(/[?&]tags=bug,docs(&|$)/);

  await expect(typePopover(page)).toBeVisible();
  await expect(page.getByTestId('filter-count')).toHaveText('2');

  await expect(typeOption(page, 'bug')).toHaveAttribute('aria-selected', 'true');
  await expect(typeOption(page, 'bug').locator(CHIP)).toBeVisible();
  await expect(typeOption(page, 'bug').locator(CHIP)).toHaveText('bug');
  await expect(typeOption(page, 'chore')).toHaveAttribute('aria-selected', 'false');
  await expect(typeOption(page, 'chore').locator(CHIP)).toHaveCount(0);

  await expect(card(page, 'tagfilter-bug')).toBeVisible();
  await expect(card(page, 'tagfilter-docs')).toBeVisible();
  await expect(card(page, 'tagfilter-plain')).toBeVisible();
});

test('re-clicking a selected word deselects it (toggle semantics)', async ({ page }) => {
  await page.goto(TAGS);
  await openTypePopover(page);
  await typeOption(page, 'bug').click();
  await typeOption(page, 'docs').click();
  await expect(page).toHaveURL(/[?&]tags=bug,docs(&|$)/);
  await typeOption(page, 'docs').click();
  await expect(page).toHaveURL(/[?&]tags=bug(&|$)/);
  await expect(typeOption(page, 'docs')).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByTestId('filter-count')).toHaveText('1');
  await expect(card(page, 'tagfilter-docs')).toHaveCount(0);
  await expect(card(page, 'tagfilter-bug')).toBeVisible();
});

test('popover family law: Escape / outside click / re-focus trigger button all close', async ({ page }) => {
  await page.goto(TAGS);
  // Escape
  await openTypePopover(page);
  await page.keyboard.press('Escape');
  await expect(typePopover(page)).not.toBeVisible();

  await openTypePopover(page);
  await page.mouse.click(600, 400);
  await expect(typePopover(page)).not.toBeVisible();

  await openTypePopover(page);
  await typeBtn(page).click({ force: true });
  await expect(typePopover(page)).not.toBeVisible();
});

test('type deep link with params = preselected (survives reload/share; selected state visible inside popover)', async ({ page }) => {
  await page.goto(`${TAGS}&tags=docs`);
  await expect(card(page, 'tagfilter-docs')).toBeVisible();
  await expect(card(page, 'tagfilter-bug')).toHaveCount(0);
  await expect(card(page, 'tagfilter-plain')).toBeVisible();
  await openTypePopover(page);
  await expect(typeOption(page, 'docs')).toHaveAttribute('aria-selected', 'true');
  await expect(typeOption(page, 'bug')).toHaveAttribute('aria-selected', 'false');
});

test('names outside the vocab in the URL are dropped: no selected state, full set visible', async ({ page }) => {
  await page.goto(`${TAGS}&tags=nope`);
  await expect(card(page, 'tagfilter-bug')).toBeVisible();
  await expect(card(page, 'tagfilter-docs')).toBeVisible();
  await expect(card(page, 'tagfilter-plain')).toBeVisible();
  await openTypePopover(page);
  for (const name of ['bug', 'docs']) {
    await expect(typeOption(page, name)).toHaveAttribute('aria-selected', 'false');
  }
});

test('repo section = project option set + counts + readout; default all active, URL no param, no active-filter bar', async ({
  page,
}) => {
  await page.goto(REPOS);

  await expect(chipsBar(page)).toHaveCount(0);
  await expect(page.getByTestId('filter-count')).toHaveCount(0);
  expect(page.url()).not.toContain('projects=');
  await openTypePopover(page);
  await expect(repoOption(page)).toHaveCount(3);
  for (const id of [PRJ_CANON, 'r2-inventory', 'r4-quiet']) {
    await expect(repoOption(page, id)).toHaveAttribute('aria-selected', 'false');
  }
  await expect(dimReadout(page, 'repo')).toHaveText('已选 0/3');

  await expect(optionCount(page, PRJ_CANON)).toHaveText('2');
  await expect(optionCount(page, 'r2-inventory')).toHaveText('1');
  await expect(optionCount(page, 'r4-quiet')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await expect(card(page, 'repofilter-a')).toBeVisible();
  await expect(card(page, 'repofilter-b')).toBeVisible();
  await expect(card(page, 'repofilter-c')).toBeVisible();
});

test('repo single-select narrows: matching project cards visible, other project cards hidden (no untagged exemption); URL carries param; column counts couple', async ({
  page,
}) => {
  await page.goto(REPOS);
  await openTypePopover(page);
  await repoOption(page, 'r2-inventory').click();
  await expect(page).toHaveURL(new RegExp(`[?&]projects=r2-inventory(&|$)`));
  expect(page.url()).toContain('scenario=board-repos');
  await expect(repoOption(page, 'r2-inventory')).toHaveAttribute('aria-selected', 'true');
  await expect(dimReadout(page, 'repo')).toHaveText('已选 1/3');

  await page.keyboard.press('Escape');
  await expect(typePopover(page)).not.toBeVisible();
  await expect(card(page, 'repofilter-b')).toBeVisible();

  await expect(card(page, 'repofilter-a')).toHaveCount(0);
  await expect(card(page, 'repofilter-c')).toHaveCount(0);
  await expect(count(page, 'todo')).toHaveText('0');
  await expect(count(page, 'building')).toHaveText('1');
  await expect(count(page, 'pending')).toHaveText('0');
});

test('repo multi-select = OR union; URL order = lexicographic canonical order (independent of click order); panel stays open', async ({
  page,
}) => {
  await page.goto(REPOS);
  await openTypePopover(page);

  await repoOption(page, 'r2-inventory').click();
  await repoOption(page, PRJ_CANON).click();
  await expect(page).toHaveURL(
    new RegExp(`[?&]projects=${PRJ_CANON},r2-inventory(&|$)`),
  );

  await expect(typePopover(page)).toBeVisible();
  await expect(dimReadout(page, 'repo')).toHaveText('已选 2/3');
  await page.keyboard.press('Escape');
  await expect(card(page, 'repofilter-a')).toBeVisible();
  await expect(card(page, 'repofilter-b')).toBeVisible();
  await expect(card(page, 'repofilter-c')).toBeVisible();
});

test('repo re-clicking a selected item deselects; clicking the all-selected row again clears this dimension (the clear path after the clear button was removed)', async ({
  page,
}) => {
  await page.goto(REPOS);
  await openTypePopover(page);
  await repoOption(page, PRJ_CANON).click();
  await repoOption(page, 'r2-inventory').click();
  await repoOption(page, 'r2-inventory').click();
  await expect(page).toHaveURL(new RegExp(`[?&]projects=${PRJ_CANON}(&|$)`));
  await expect(repoOption(page, 'r2-inventory')).toHaveAttribute('aria-selected', 'false');

  await expect(dimAll(page, 'repo')).toHaveAttribute('aria-checked', 'mixed');

  await dimAll(page, 'repo').click();
  await expect(dimAll(page, 'repo')).toHaveAttribute('aria-checked', 'true');
  await dimAll(page, 'repo').click();
  await expect(page).not.toHaveURL(/[?&]projects=/);
  await expect(dimReadout(page, 'repo')).toHaveText('已选 0/3');
  await expect(dimAll(page, 'repo')).toHaveAttribute('aria-checked', 'false');

  await expect(optionCount(page, PRJ_CANON)).toHaveText('2');
  await page.keyboard.press('Escape');
  await expect(card(page, 'repofilter-a')).toBeVisible();
  await expect(card(page, 'repofilter-b')).toBeVisible();
  await expect(card(page, 'repofilter-c')).toBeVisible();
});

test('repo section `全部选中` = writes the full project source (readout N/N); clearing = deletes the param', async ({ page }) => {
  await page.goto(REPOS);
  await openTypePopover(page);
  await dimAll(page, 'repo').click();
  await expect(page).toHaveURL(
    new RegExp(`[?&]projects=${PRJ_CANON},r2-inventory,r4-quiet(&|$)`),
  );

  await expect(dimReadout(page, 'repo')).toHaveText('已选 3/3');
  await page.keyboard.press('Escape');
  await expect(card(page, 'repofilter-a')).toBeVisible();
  await expect(card(page, 'repofilter-b')).toBeVisible();
  await expect(card(page, 'repofilter-c')).toBeVisible();
});

test('repo deep link with params = preselected; unknown project id mis-matches to nothing = board-level empty state', async ({ page }) => {
  await page.goto(`${REPOS}&projects=r2-inventory`);
  await openTypePopover(page);
  await expect(repoOption(page, 'r2-inventory')).toHaveAttribute('aria-selected', 'true');
  await expect(dimReadout(page, 'repo')).toHaveText('已选 1/3');
  await page.keyboard.press('Escape');
  await expect(card(page, 'repofilter-b')).toBeVisible();
  await expect(card(page, 'repofilter-a')).toHaveCount(0);

  await page.goto(`${REPOS}&projects=p-gone`);
  await expect(filterEmpty(page)).toBeVisible();
  await expect(page.locator('[data-column]')).toHaveCount(0);
});

test('selecting a zero-card project = explicit board-level empty state + summary; clearing returns to full set', async ({ page }) => {
  await page.goto(REPOS);
  await openTypePopover(page);
  await repoOption(page, 'r4-quiet').click();
  await page.keyboard.press('Escape');
  await expect(filterEmpty(page)).toBeVisible();

  await expect(page.getByText(/^筛选生效：/)).toBeVisible();
  await expect(page.locator('[data-column]')).toHaveCount(0);
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page).not.toHaveURL(/[?&]projects=/);
  await expect(page.locator('[data-column]')).toHaveCount(4);
  await expect(card(page, 'repofilter-a')).toBeVisible();
});

test('type axis empty-result state reuse: board-level explicit + clear (board-tags-empty)', async ({ page }) => {
  await page.goto(EMPTY);
  await expect(card(page, 'tagfilter-e-bug')).toBeVisible();
  await openTypePopover(page);
  await typeOption(page, 'chore').click();
  await expect(page).toHaveURL(/[?&]tags=chore(&|$)/);

  await page.keyboard.press('Escape');
  await expect(typePopover(page)).not.toBeVisible();
  await expect(filterEmpty(page)).toBeVisible();
  await expect(page.locator('[data-column]')).toHaveCount(0);
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page).not.toHaveURL(/[?&]tags=/);
  await expect(page.locator('[data-column]')).toHaveCount(4);
  await expect(card(page, 'tagfilter-e-bug')).toBeVisible();
  await expect(card(page, 'tagfilter-e-docs')).toBeVisible();
});

test('two-axis combination = AND narrowing; combination bottoming out = empty state; clear button clears both axes', async ({ page }) => {
  await page.goto(REPOS);

  await openTypePopover(page);

  await repoOption(page, PRJ_CANON).click();
  await typeOption(page, 'bug').click();
  await expect(page).toHaveURL(new RegExp(`[?&]projects=${PRJ_CANON}`));
  await expect(page).toHaveURL(/[?&]tags=bug(&|$)/);

  await expect(optionCount(page, PRJ_CANON)).toHaveText('2');
  await expect(optionCount(page, 'r2-inventory')).toHaveCount(0);
  await expect(optionCount(page, 'r4-quiet')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(typePopover(page)).not.toBeVisible();
  await expect(card(page, 'repofilter-a')).toBeVisible();
  await expect(card(page, 'repofilter-c')).toBeVisible();
  await expect(card(page, 'repofilter-b')).toHaveCount(0);

  await openTypePopover(page);
  await repoOption(page, PRJ_CANON).click();
  await repoOption(page, 'r2-inventory').click();
  await page.keyboard.press('Escape');
  await expect(filterEmpty(page)).toBeVisible();

  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page).not.toHaveURL(/[?&]projects=/);
  await expect(page).not.toHaveURL(/[?&]tags=/);
  await expect(page.locator('[data-column]')).toHaveCount(4);
  await expect(card(page, 'repofilter-a')).toBeVisible();
  await expect(card(page, 'repofilter-b')).toBeVisible();
  await expect(card(page, 'repofilter-c')).toBeVisible();
});

test('type section batch key: all selected = writes the full vocab (readout N/N, not 0/N); `仅此` collapses to a single value', async ({
  page,
}) => {
  await page.goto(TAGS);
  await openTypePopover(page);
  await expect(dimReadout(page, 'type')).toHaveText('已选 0/6');

  await expect(dim(page, 'type').getByRole('textbox')).toHaveCount(0);
  await dimAll(page, 'type').click();

  await expect(page).toHaveURL(/[?&]tags=bug,chore,docs,feature,improvement,refactor(&|$)/);
  await expect(dimReadout(page, 'type')).toHaveText('已选 6/6');
  await page.keyboard.press('Escape');
  await expect(card(page, 'tagfilter-bug')).toBeVisible();
  await expect(card(page, 'tagfilter-plain')).toBeVisible();

  await openTypePopover(page);
  await optionOnly(page, 'chore').hover();
  await optionOnly(page, 'chore').click();
  await expect(page).toHaveURL(/[?&]tags=chore(&|$)/);
  await expect(dimReadout(page, 'type')).toHaveText('已选 1/6');

  await dimInvert(page, 'type').click();
  await expect(page).toHaveURL(/[?&]tags=bug,docs,feature,improvement,refactor(&|$)/);
  await expect(dimReadout(page, 'type')).toHaveText('已选 5/6');
  await expect(dimAll(page, 'type')).toHaveAttribute('aria-checked', 'mixed');
});

test('active filter bar: lists only active dimensions, clicking a bar chip clears that dimension, both axes present a `清除全部`', async ({ page }) => {
  await page.goto(REPOS);
  await expect(chipsBar(page)).toHaveCount(0);
  await openTypePopover(page);
  await repoOption(page, PRJ_CANON).click();
  await page.keyboard.press('Escape');
  await expect(filterChip(page, 'repo')).toBeVisible();
  await expect(filterChip(page, 'repo')).toContainText('仓库');
  await expect(filterChip(page, 'type')).toHaveCount(0);
  await expect(page.getByTestId('filter-count')).toHaveText('1');

  await expect(chipsClear(page)).toHaveCount(0);
  await openTypePopover(page);
  await typeOption(page, 'bug').click();
  await page.keyboard.press('Escape');
  await expect(filterChip(page, 'type')).toBeVisible();
  await expect(chipsClear(page)).toBeVisible();
  await expect(page.getByTestId('filter-count')).toHaveText('2');

  await filterChip(page, 'repo').click();
  await expect(page).not.toHaveURL(/[?&]projects=/);
  await expect(page).toHaveURL(/[?&]tags=bug(&|$)/);
  await expect(filterChip(page, 'repo')).toHaveCount(0);

  await openTypePopover(page);
  await repoOption(page, PRJ_CANON).click();
  await page.keyboard.press('Escape');
  await chipsClear(page).click();
  await expect(page).not.toHaveURL(/[?&]tags=/);
  await expect(page).not.toHaveURL(/[?&]projects=/);
  await expect(chipsBar(page)).toHaveCount(0);
  await expect(page.getByTestId('filter-count')).toHaveCount(0);
});

test('task card tag = vocab-colored tag icon + name: no solid chip, no placeholder for untagged, card height unchanged', async ({
  page,
}) => {
  await page.goto(TAGS);

  const bugTag = card(page, 'tagfilter-bug').locator('[data-card-tag]');
  await expect(bugTag).toBeVisible();
  await expect(bugTag).toHaveText('bug');
  await expect(bugTag.locator('svg')).toHaveCSS('color', 'rgb(239, 68, 68)');
  await expect(card(page, 'tagfilter-bug').locator(CHIP)).toHaveCount(0);
  await expect(card(page, 'tagfilter-docs').locator('[data-card-tag]')).toHaveText('docs');

  await expect(card(page, 'tagfilter-plain').locator('[data-card-tag]')).toHaveCount(0);
  await expect(
    card(page, 'tagfilter-plain').getByText(/^(bug|feature|improvement|refactor|docs|chore)$/),
  ).toHaveCount(0);

  const metaH = (id: string) =>
    card(page, id)
      .locator('.todo-card-meta')
      .evaluate((el) => el.getBoundingClientRect().height);
  expect(await metaH('tagfilter-bug')).toBeCloseTo(20, 0);
  expect(await metaH('tagfilter-plain')).toBeCloseTo(20, 0);
});

test('two type picks in the same frame both land in the URL (no stale selection)', async ({
  page,
}) => {
  await page.goto(TAGS);
  await openTypePopover(page);
  await expect(typeOption(page, 'bug')).toBeVisible();
  await page.evaluate(() => {
    for (const name of ['bug', 'docs'])
      document.querySelector<HTMLElement>(`[data-tag="${name}"]`)?.click();
  });
  await expect(page).toHaveURL(/[?&]tags=bug,docs(&|$)/);
});
