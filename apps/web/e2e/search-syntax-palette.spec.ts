import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';
import { pressAndExpect } from './helpers.js';

const BOARD = '/app?scenario=activity';

const panel = (page: Page) => page.getByRole('dialog', { name: 'Search' });
const field = (page: Page) => panel(page).getByRole('textbox', { name: 'Search' });
const chips = (page: Page) => panel(page).getByTestId('query-chip');
const todoRows = (page: Page) => panel(page).locator('[data-row-kind="todo"]');

async function openPalette(page: Page, url = BOARD) {
  await page.goto(url);
  await pressAndExpect(page, 'Meta+k', panel(page));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

test('a typed filter becomes a removable chip and narrows the results', async ({ page }) => {
  await openPalette(page);
  await field(page).fill('is:failed ');
  await expect(chips(page)).toHaveText(['is:failed']);
  await expect(field(page)).toHaveValue('');
  await expect(todoRows(page)).toHaveCount(3);
  await expect(panel(page)).not.toContainText('Trim the gallery frame');

  await chips(page).getByRole('button', { name: 'Remove filter is:failed' }).click();
  await expect(chips(page)).toHaveCount(0);
  await expect(field(page)).toBeFocused();
});

test('chips and words combine, and Backspace on an empty field turns the last chip back into text', async ({
  page,
}) => {
  await openPalette(page);
  await field(page).fill('is:failed project:cairn ');
  await expect(chips(page)).toHaveText(['is:failed', 'project:cairn']);
  await expect(todoRows(page)).toHaveCount(3);
  await field(page).pressSequentially('fold');
  await expect(todoRows(page)).toHaveCount(1);
  await field(page).fill('');
  await field(page).press('Backspace');
  await expect(chips(page)).toHaveText(['is:failed']);
  await expect(field(page)).toHaveValue('project:cairn');
});

test('Enter commits a filter token that is still being typed', async ({ page }) => {
  await openPalette(page);
  await field(page).fill('is:review');
  await expect(chips(page)).toHaveCount(0);
  await field(page).press('Enter');
  await expect(chips(page)).toHaveText(['is:review']);
});

test('an invalid value is flagged on its chip with a readable reason', async ({ page }) => {
  await openPalette(page);
  await field(page).fill('is:failed cost:lots after:soon ');
  const bad = panel(page).locator('[data-testid="query-chip"][data-invalid]');
  await expect(bad).toHaveCount(2);
  const problems = panel(page).getByTestId('chip-problems');
  await expect(problems).toContainText('Use > or < with a number, like >5');
  await expect(problems).toContainText('Use a date like 2026-11-01, or a span like 7d');
  await expect(panel(page).locator('[data-testid="query-chip"]:not([data-invalid])')).toHaveText([
    'is:failed',
  ]);
  await expect(panel(page)).toContainText('No threads match all of these filters');
});

test('a project that does not exist is flagged', async ({ page }) => {
  await openPalette(page);
  await field(page).fill('project:nope ');
  await expect(panel(page).getByTestId('chip-problems')).toContainText('No project has that name');
});

test('the server flags a person it cannot find, and the chip shows its reason', async ({ page }) => {
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path !== '/api/search') return undefined;
    return json({
      todos: [],
      projects: [],
      agents: [],
      filters: [
        { key: 'by', raw: 'by:ghost', value: 'ghost', negated: false, valid: false, reason: 'unknown_person' },
      ],
    });
  });
  await openPalette(page, '/app');
  await field(page).fill('by:ghost ');
  await expect(panel(page).locator('[data-testid="query-chip"][data-invalid]')).toHaveText(['by:ghost']);
  await expect(panel(page).getByTestId('chip-problems')).toContainText(
    'No agent or person has that name',
  );
});

test('Tab completes a filter key and an is: state', async ({ page }) => {
  await openPalette(page);
  await field(page).fill('pro');
  await field(page).press('Tab');
  await expect(field(page)).toHaveValue('project:');
  await field(page).fill('is:fa');
  await field(page).press('Tab');
  await expect(field(page)).toHaveValue('is:failed');
  await field(page).fill('zzz');
  await field(page).press('Tab');
  await expect(field(page)).not.toBeFocused();
});

test('the Syntax button opens the filter list and closes it again', async ({ page }) => {
  await openPalette(page);
  const help = panel(page).getByTestId('syntax-help');
  await expect(help).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Syntax' }).click();
  await expect(help).toBeVisible();
  await expect(help.locator('dt')).toHaveText(['is:', 'project:', 'pr:', 'by:', 'after:', 'cost:']);
  await panel(page).getByRole('button', { name: 'Syntax' }).click();
  await expect(help).toHaveCount(0);
});

test('View all N in Activity carries the query, by click and by Cmd+Enter', async ({ page }) => {
  await openPalette(page);
  await field(page).fill('is:failed ');
  const viewAll = panel(page).locator('[data-row-kind="activity"]');
  await expect(viewAll).toContainText('View all 3 in Activity');
  await viewAll.click();
  await expect(page).toHaveURL(/\/app\/activity\?.*q=is%3Afailed/);
  await expect(page.locator('[data-testid="query-chip"]')).toHaveText(['is:failed']);

  await openPalette(page);
  await field(page).fill('project:cairn ');
  await field(page).press('Meta+Enter');
  await expect(page).toHaveURL(/\/app\/activity\?.*q=project%3Acairn/);
  await expect(page.getByTestId('activity-group').first()).toBeVisible();
});

test('the empty palette lists only places that land somewhere distinct', async ({ page }) => {
  await openPalette(page);
  const rows = panel(page).locator('[data-row-kind="nav"]');
  await expect(rows).toHaveText(['Coordinator', 'Schedules', 'Activity', 'Settings']);
  await rows.filter({ hasText: 'Settings' }).click();
  await expect(page).toHaveURL(/\/app\/settings/);
  await expect(page).not.toHaveURL(/\/app\/(team|account|api-keys)/);
});

test('at 390px the palette stays inside the viewport with chips and help open', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPalette(page);
  await field(page).fill('is:failed project:cairn cost:lots ');
  await panel(page).getByRole('button', { name: 'Syntax' }).click();
  const box = await panel(page).boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
