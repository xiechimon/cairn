import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, TASK } from './chief-home-mock';
import { evidencePanelShot } from './evidence.js';
import { pressAndExpect, settleTransitions } from './helpers.js';

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

test('Enter commits a closed quoted filter after words and leaves an open quote in the field', async ({
  page,
}) => {
  await openPalette(page);
  await field(page).fill('fold project:"my project');
  await field(page).press('Enter');
  await expect(chips(page)).toHaveCount(0);
  await expect(field(page)).toHaveValue('fold project:"my project');
  await field(page).fill('fold project:"my project"');
  await field(page).press('Enter');
  await expect(chips(page)).toHaveText(['project:my project']);
  await expect(field(page)).toHaveValue('fold ');
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

test('View all advertises only the live hits Activity can display and retains archived search hits', async ({
  page,
}) => {
  const active = { ...TASK, title: 'Active match', phase: 'done', phaseAt: Date.now() };
  const archivedHit = { id: 'archived-match', seqNum: 10, title: 'Archived match', phase: 'done', phaseAt: Date.now(), projectName: 'cairn' };
  await mockLive(page, { threads: [], messages: [], todos: [active] }, (path, _route, json) => {
    if (path !== '/api/search') return undefined;
    return json({
      todos: [{ ...active, projectName: 'cairn' }, archivedHit],
      projects: [],
      agents: [],
    });
  });
  await openPalette(page, '/app');
  await field(page).fill('match');
  await expect(todoRows(page)).toHaveCount(2);
  await expect(todoRows(page).filter({ hasText: 'Archived match' })).toBeVisible();
  const viewAll = panel(page).locator('[data-row-kind="activity"]');
  await expect(viewAll).toContainText('View all 1 in Activity');
  await viewAll.click();
  await expect(page).toHaveURL(/\/app\/activity\?.*q=match/);
  await expect(page.locator('[data-slot="thread-row"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="thread-row"]')).toContainText('Active match');
  await expect(page.getByTestId('activity-summary')).toContainText('1 thread ·');
});

test('an archived-only live search remains openable without advertising an empty Activity list', async ({
  page,
}) => {
  await mockLive(page, { threads: [], messages: [], todos: [TASK] }, (path, _route, json) => {
    if (path !== '/api/search') return undefined;
    return json({
      todos: [{ id: 'archived-match', seqNum: 10, title: 'Archived match', phase: 'done', phaseAt: Date.now(), projectName: 'cairn' }],
      projects: [],
      agents: [],
    });
  });
  await openPalette(page, '/app');
  await field(page).fill('match');
  await expect(todoRows(page)).toHaveCount(1);
  await expect(todoRows(page)).toContainText('Archived match');
  await expect(panel(page).locator('[data-row-kind="activity"]')).toHaveCount(0);
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
  await evidencePanelShot(page, 'palette-phone.png', panel(page));
});

test('a long filter value remains removable inside a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPalette(page);
  const query = `project:${'a'.repeat(160)} `;
  await field(page).fill(query);
  const chip = chips(page);
  await expect(chip).toBeVisible();
  const box = await chip.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  const remove = chip.getByRole('button');
  const removeBox = await remove.boundingBox();
  expect((removeBox?.x ?? 0) + (removeBox?.width ?? 0)).toBeLessThanOrEqual(390);
  const problemOverflow = await panel(page).getByTestId('chip-problems').evaluate(
    (node) => node.scrollWidth - node.clientWidth,
  );
  expect(problemOverflow).toBe(0);
  await remove.click();
  await expect(chips(page)).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`filter errors and syntax help are accessible (${theme})`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openPalette(page);
    await field(page).fill('is:failed project:cairn cost:lots ');
    await panel(page).getByRole('button', { name: 'Syntax' }).click();
    const help = panel(page).getByRole('region', { name: 'Search filters' });
    await expect(help).toBeVisible();
    const closeHelp = help.getByRole('button', { name: 'Close', exact: true });
    await closeHelp.focus();
    await expect(closeHelp).toBeFocused();
    await settleTransitions(page);
    const { violations } = await new AxeBuilder({ page })
      .include('.search-panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))).toEqual([]);
    await evidencePanelShot(page, `palette-${theme}.png`, panel(page));
    await closeHelp.click();
    await expect(help).toBeHidden();
    await expect(panel(page)).toBeVisible();
  });
}
