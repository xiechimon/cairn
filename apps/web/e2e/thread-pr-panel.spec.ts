import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, TASK } from './chief-home-mock.js';
import { evidencePanelShot } from './evidence.js';

const HEAD = 'a'.repeat(40);
const REVIEW_TASK = { ...TASK, phase: 'review', phaseAt: Date.now() };

function prRow(over: Record<string, unknown> = {}) {
  return {
    buildId: 'build-1',
    threadId: 'todo-1',
    repo: 'xiechimon/cairn',
    number: 42,
    title: 'web(3122): the thread-owned PR panel',
    url: 'https://github.com/xiechimon/cairn/pull/42',
    state: 'open',
    mergeState: 'clean',
    additions: 120,
    deletions: 14,
    checks: { passed: 9, failed: 0, running: 0, total: 9 },
    head: HEAD,
    verdict: { result: 'pass', judgedHead: HEAD },
    autoFix: true,
    mergeWhenReady: false,
    autoArchive: true,
    dismissed: false,
    blockedSince: null,
    wakeRounds: 0,
    updatedAt: Date.now(),
    ...over,
  };
}

interface Case {
  name: string;
  row: Record<string, unknown>;
  cardState: string;
  pill: string;
  ci: string | null;
}

const CASES: Case[] = [
  { name: 'draft', row: { state: 'draft', mergeState: 'blocked' }, cardState: 'draft', pill: 'Draft', ci: '9/9' },
  { name: 'ci-running', row: { checks: { passed: 6, failed: 0, running: 3, total: 9 } }, cardState: 'checks-running', pill: 'Checks running', ci: '6/9' },
  { name: 'ci-failed', row: { checks: { passed: 6, failed: 2, running: 1, total: 9 } }, cardState: 'checks-failed', pill: 'Checks failed', ci: '6/9' },
  { name: 'review-pending', row: { verdict: null }, cardState: 'review-pending', pill: 'Review pending', ci: '9/9' },
  { name: 'changes-requested', row: { verdict: { result: 'block', judgedHead: HEAD } }, cardState: 'review-block', pill: 'Review blocked', ci: '9/9' },
  { name: 'ready', row: {}, cardState: 'review-pass', pill: 'Ready to merge', ci: '9/9' },
  { name: 'merged', row: { state: 'merged' }, cardState: 'merged', pill: 'Merged', ci: '9/9' },
  { name: 'closed', row: { state: 'closed' }, cardState: 'closed', pill: 'Closed', ci: '9/9' },
  { name: 'conflicts', row: { mergeState: 'dirty' }, cardState: 'conflicts', pill: 'Conflicts', ci: '9/9' },
  { name: 'behind', row: { mergeState: 'behind' }, cardState: 'behind', pill: 'Behind main', ci: '9/9' },
  { name: 'stale-verdict', row: { verdict: { result: 'pass', judgedHead: 'b'.repeat(40) } }, cardState: 'review-pending', pill: 'Needs re-review', ci: '9/9' },
];

type PrsMode = { rows: unknown[] } | 'error';

async function setup(page: Page, prs: PrsMode, theme: 'light' | 'dark' = 'light') {
  await page.addInitScript((value) => {
    localStorage.setItem('cairn.locale', 'en');
    localStorage.setItem('cairn-theme', value);
  }, theme);
  await mockLive(page, { threads: [], messages: [], todos: [REVIEW_TASK] }, (path, _route, json) => {
    if (path === '/api/prs') return prs === 'error' ? json({ error: 'boom' }, 500) : json(prs.rows);
    if (path === '/api/todos/todo-1') return json(REVIEW_TASK);
    if (path === '/api/builds/build-1') return json({ id: 'build-1', todoId: 'todo-1', createdAt: 1, triggerSource: 'user' });
    if (path === '/api/builds/build-1/steps' || path === '/api/builds/build-1/changes') return json([]);
    return undefined;
  });
}

const panel = (page: Page) => page.getByTestId('thread-pr-panel');
const status = (page: Page) => page.getByTestId('side-chat-status');

for (const theme of ['light', 'dark'] as const) {
  for (const c of CASES) {
    test(`thread header and panel show ${c.name} (${theme})`, async ({ page }) => {
      await setup(page, { rows: [prRow(c.row)] }, theme);
      await page.goto('/app?thread=todo-1');
      const link = status(page).getByRole('link', { name: /PR #42/ });
      await expect(link).toHaveAttribute('href', 'https://github.com/xiechimon/cairn/pull/42');
      await expect(status(page).getByTestId('side-chat-pr-status')).toHaveText(c.pill);
      const card = panel(page).locator('[data-slot="pr-card"]');
      await expect(card).toHaveAttribute('data-state', c.cardState);
      await expect(card.locator('[data-slot="pr-card-state"]')).toHaveText(c.pill);
      await expect(card.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
      await evidencePanelShot(page, `thread-pr-${c.name}-${theme}.png`, page.locator('.side-panel'));
    });
  }
}

test('a read older than ten minutes says the data is late, a finished PR does not', async ({ page }) => {
  await setup(page, { rows: [prRow({ updatedAt: Date.now() - 47 * 60_000 })] });
  await page.goto('/app?thread=todo-1');
  await expect(panel(page).locator('[data-slot="pr-card-late"]')).toContainText('Last read 47 min ago');
  await evidencePanelShot(page, 'thread-pr-stale-light.png', page.locator('.side-panel'));
  await page.unroute('**/api/**');
  await setup(page, { rows: [prRow({ state: 'merged', updatedAt: Date.now() - 47 * 60_000 })] });
  await page.goto('/app?thread=todo-1');
  await expect(panel(page).locator('[data-slot="pr-card"]')).toHaveAttribute('data-state', 'merged');
  await expect(panel(page).locator('[data-slot="pr-card-late"]')).toHaveCount(0);
});

test('a thread without a PR shows no PR block and no placeholder', async ({ page }) => {
  await setup(page, { rows: [] });
  await page.goto('/app?thread=todo-1');
  await expect(page.getByTestId('side-chat')).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await expect(status(page).getByRole('link')).toHaveCount(0);
  await evidencePanelShot(page, 'thread-pr-none-light.png', page.locator('.side-panel'));
});

test('a failed PR request shows one plain line with a retry, not the raw error', async ({ page }) => {
  await setup(page, 'error');
  await page.goto('/app?thread=todo-1');
  const error = page.getByTestId('thread-pr-error');
  await expect(error).toContainText('Could not load the PR status');
  await expect(error).not.toContainText('boom');
  await expect(error.getByRole('button', { name: 'Retry' })).toBeVisible();
  await evidencePanelShot(page, 'thread-pr-error-light.png', page.locator('.side-panel'));
});

test('the PR list shows every thread-owned PR with counts, a row menu and Show more', async ({ page }) => {
  const rows = Array.from({ length: 7 }, (_, i) =>
    prRow({
      buildId: `build-${i}`,
      threadId: i === 0 ? 'todo-1' : `todo-x${i}`,
      number: 3060 - i,
      url: `https://github.com/xiechimon/cairn/pull/${3060 - i}`,
      title: `docs(${3000 + i}): keep live counts in sync`,
      state: i === 4 ? 'merged' : 'open',
      checks: { passed: 22 - i, failed: i === 2 ? 1 : 0, running: i === 1 ? 2 : 0, total: 23 },
      additions: 10 * (i + 1),
      deletions: 8,
    }),
  );
  await setup(page, { rows });
  await page.goto('/app?pane=tasks');
  const list = page.getByTestId('work-prs');
  await expect(list.locator('[data-slot="pr-list-row"]')).toHaveCount(5);
  await expect(list.locator('[data-slot="pr-list-row"]').first()).toContainText('cairn #3060');
  await expect(list.locator('[data-slot="pr-list-row"]').first()).toContainText('+10');
  await expect(list.locator('[data-slot="pr-checks"]').first()).toHaveText('22/23');
  await expect(list.locator('[data-slot="pr-list-row"][data-state="merged"]')).toHaveCount(1);
  await list.getByRole('button', { name: 'Menu for PR #3060' }).click();
  await expect(page.getByRole('menuitem', { name: 'Open on GitHub' })).toHaveAttribute('href', /pull\/3060$/);
  await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Show changes' })).toBeVisible();
  await expect(page.getByRole('menuitemcheckbox')).toHaveCount(0);
  await evidencePanelShot(page, 'pr-list-menu-light.png', page.locator('.side-panel'));
  await page.keyboard.press('Escape');
  await list.getByRole('button', { name: 'Show more' }).click();
  await expect(list.locator('[data-slot="pr-list-row"]')).toHaveCount(7);
  await evidencePanelShot(page, 'pr-list-light.png', page.locator('.side-panel'));
});

test('the PR list says what is missing when no thread has a PR', async ({ page }) => {
  await setup(page, { rows: [] });
  await page.goto('/app?pane=tasks');
  await expect(page.getByTestId('work-prs')).toContainText('PRs opened by threads are listed here.');
});

test('the same PR link reaches the needs-you card, the outputs panel and the finish dialog', async ({ page }) => {
  await setup(page, { rows: [prRow()] });
  await page.goto('/app');
  const card = page.locator('[data-slot="thread-card"]').first();
  await expect(card.getByRole('link', { name: /PR #42/ })).toHaveAttribute('href', /pull\/42$/);
  await page.goto('/app?pane=tasks');
  await expect(page.locator('[data-slot="thread-row"]').first().getByRole('link', { name: /PR #42/ })).toBeVisible();
  await page.goto('/app?thread=todo-1');
  await page.getByRole('button', { name: 'Finish…' }).click();
  await expect(page.getByTestId('accept-dialog-pr').getByRole('link', { name: /PR #42/ })).toHaveAttribute('href', /pull\/42$/);
});

test('at 375px the panel and header fit without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page, { rows: [prRow({ checks: { passed: 6, failed: 2, running: 1, total: 9 } })] });
  await page.goto('/app?thread=todo-1');
  await expect(panel(page)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await evidencePanelShot(page, 'thread-pr-mobile-375.png', page.locator('.side-panel'));
});

test('the panel passes axe in the failing state', async ({ page }) => {
  await setup(page, { rows: [prRow({ checks: { passed: 6, failed: 2, running: 1, total: 9 } })] }, 'dark');
  await page.goto('/app?thread=todo-1');
  await expect(panel(page)).toBeVisible();
  const results = await new AxeBuilder({ page }).include('.side-panel').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
});
