import { expect, type Locator, type Page, test } from '@playwright/test';
import { pressAndExpect } from './helpers.js';

const BOARD = '/app?scenario=01';
/** Matches the fixture probe pair r3-legacy-1 / r3-legacy-2 (title
 *  includes()), fixture order — nothing else on scenario 01. */
const PROBE = 'r3 lifecycle probe';

const panel = (page: Page) => page.getByRole('dialog', { name: '搜索' });
const todoRows = (page: Page) => panel(page).locator('[data-row-kind="todo"]');
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** Background of the row element itself — an unlit row is transparent. */
const rowBg = (locator: Locator) =>
  locator.evaluate((el) => getComputedStyle(el).backgroundColor);

const isLit = (locator: Locator) =>
  locator.evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--menu-hover)';
    document.documentElement.append(probe);
    const lit = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(el).backgroundColor === lit;
  });

async function openPanel(page: Page) {
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressAndExpect(page, 'Meta+k', panel(page));
}

/** Panel open + the probe query typed into the auto-focused input. */
async function searchProbe(page: Page) {
  await openPanel(page);
  await page.keyboard.type(PROBE);
  await expect(todoRows(page).first()).toContainText(PROBE);
}

test('clicking a result row → panel closes + jumps to the todo detail', async ({ page }) => {
  await page.goto(BOARD);
  await searchProbe(page);

  await todoRows(page).first().click();
  await expect(page).toHaveURL('/app?scenario=01&thread=r3-legacy-1');
  await expect(panel(page)).toBeHidden();
  // the detail route really rendered the clicked todo
  await expect(page.getByTestId('side-chat')).toHaveAttribute('data-todo-id', 'r3-legacy-1');
});

test('clicking a go-to row → panel closes + jumps to the matching route', async ({ page }) => {
  await page.goto(BOARD);
  await openPanel(page);

  await panel(page).getByRole('button', { name: '定时' }).click();
  await expect(page).toHaveURL('/app?scenario=01&pane=tasks&tab=scheduled');
  await expect(panel(page)).toBeHidden();
  await expect(
    page.getByRole('complementary', { name: '任务' }).getByRole('tab', { name: '定时' }),
  ).toHaveAttribute('aria-selected', 'true');
});

test('idle: hovering a row lights exactly that one row; typed results default-select row 0', async ({
  page,
}) => {
  await page.goto(BOARD);
  await openPanel(page);
  await expect(panel(page).locator('[data-selected]')).toHaveCount(0);

  await page.keyboard.type(PROBE);
  await expect(todoRows(page).first()).toContainText(PROBE);
  const first = todoRows(page).first();
  const second = todoRows(page).nth(1);
  await expect(first).toHaveAttribute('data-selected', '');

  await second.hover();
  await expect(panel(page).locator('[data-selected]')).toHaveCount(0);
  await expect.poll(() => isLit(second)).toBe(true);
  await expect.poll(() => rowBg(first)).toBe(TRANSPARENT);

  await first.hover();
  await expect.poll(() => isLit(first)).toBe(true);
  await expect.poll(() => rowBg(second)).toBe(TRANSPARENT);
});

test('Enter immediately opens row 0; ArrowDown moves to row 1 and Enter jumps there', async ({
  page,
}) => {
  await page.goto(BOARD);
  await searchProbe(page);
  const first = todoRows(page).first();
  const second = todoRows(page).nth(1);
  await expect(first).toHaveAttribute('data-selected', '');
  await expect(panel(page).getByText('打开', { exact: true })).toBeVisible();
  await expect.poll(() => isLit(first)).toBe(true);

  await page.keyboard.press('ArrowDown');
  await expect(second).toHaveAttribute('data-selected', '');
  await expect(first).not.toHaveAttribute('data-selected');

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/app?scenario=01&thread=r3-legacy-2');
  await expect(panel(page)).toBeHidden();
});

test('mouse movement yields: keyboard cursor hands back to hover', async ({ page }) => {
  await page.goto(BOARD);
  await searchProbe(page);

  await page.keyboard.press('ArrowDown');
  const first = todoRows(page).first();
  const second = todoRows(page).nth(1);
  await expect(second).toHaveAttribute('data-selected', '');

  await first.hover();
  await expect(panel(page).locator('[data-selected]')).toHaveCount(0);
  await expect.poll(() => isLit(first)).toBe(true);
  await expect.poll(() => rowBg(second)).toBe(TRANSPARENT);
});
