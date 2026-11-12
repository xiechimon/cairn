import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, TASK } from './chief-home-mock.js';
import { evidencePanelShot } from './evidence.js';

const HEAD = '4f8e2c1d9b0a63e57c1f08a2d4b6e9137a5c80de';
const REVIEW_TASK = { ...TASK, phase: 'review', phaseAt: Date.now() };

const REVIEW_ENTRY = {
  ...REVIEW_TASK,
  ownerId: null,
  createdBy: null,
  sourceBuildId: null,
  sourceKind: null,
  sourceRef: null,
  output: 'code',
  owner: 'owner',
  kind: 'todo',
  section: 'ready_for_review',
};

function prRow(over: Record<string, unknown> = {}) {
  return {
    buildId: 'build-1',
    threadId: 'todo-1',
    projectId: 'proj-1',
    repo: 'xiechimon/cairn',
    number: 42,
    title: 'web(3122): the thread-owned PR panel',
    url: 'https://github.com/xiechimon/cairn/pull/42',
    state: 'open',
    mergeState: 'clean',
    branch: 'cairn/web-3122-pr-panel',
    base: 'main',
    additions: 120,
    deletions: 14,
    checks: { passed: 9, failed: 0, running: 0, total: 9, failedNames: [] },
    head: HEAD,
    checksReadFor: HEAD,
    verdict: { result: 'pass', judgedHead: HEAD },
    autoFix: true,
    mergeWhenReady: false,
    autoArchive: true,
    dismissed: false,
    blockedSince: null,
    wakeRounds: 0,
    lastReadAt: Date.now(),
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
  { name: 'ci-running', row: { checks: { passed: 6, failed: 0, running: 3, total: 9, failedNames: [] } }, cardState: 'checks-running', pill: 'Checks running', ci: '6/9' },
  { name: 'ci-failed', row: { checks: { passed: 6, failed: 2, running: 1, total: 9, failedNames: ['lint', 'e2e (1)'] } }, cardState: 'checks-failed', pill: 'Checks failed', ci: '6/9' },
  { name: 'review-pending', row: { verdict: null }, cardState: 'review-pending', pill: 'Review pending', ci: '9/9' },
  { name: 'changes-requested', row: { verdict: { result: 'block', judgedHead: HEAD } }, cardState: 'review-block', pill: 'Review blocked', ci: '9/9' },
  { name: 'ready', row: {}, cardState: 'review-pass', pill: 'Ready to merge', ci: '9/9' },
  { name: 'merged', row: { state: 'merged' }, cardState: 'merged', pill: 'Merged', ci: '9/9' },
  { name: 'closed', row: { state: 'closed' }, cardState: 'closed', pill: 'Closed', ci: '9/9' },
  { name: 'conflicts', row: { mergeState: 'dirty' }, cardState: 'conflicts', pill: 'Conflicts', ci: '9/9' },
  { name: 'behind', row: { mergeState: 'behind' }, cardState: 'behind', pill: 'Behind main', ci: '9/9' },
  { name: 'stale-verdict', row: { verdict: { result: 'pass', judgedHead: '9d03b7a1e6c24f58b0a3d7e19c5f2468ab13c0de' } }, cardState: 'review-pending', pill: 'Needs re-review', ci: '9/9' },
];

type PrsMode = { rows: unknown[] } | 'error';

async function setup(
  page: Page,
  prs: PrsMode,
  theme: 'light' | 'dark' = 'light',
  more: { todos?: unknown[]; projects?: unknown[]; tasks?: unknown[] } = {},
) {
  await page.addInitScript((value) => {
    localStorage.setItem('cairn.locale', 'en');
    localStorage.setItem('cairn-theme', value);
  }, theme);
  await mockLive(
    page,
    {
      threads: [],
      messages: [],
      todos: [REVIEW_TASK, ...(more.todos ?? [])],
      ...(more.projects !== undefined ? { projects: more.projects } : {}),
      ...(more.tasks !== undefined ? { tasks: more.tasks } : {}),
    }, (path, _route, json) => {
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
      await expect(status(page).getByRole('link')).toHaveCount(0);
      await expect(status(page)).not.toContainText(c.pill);
      const card = panel(page).locator('[data-slot="pr-card"]');
      const link = card.getByRole('link', { name: /PR #42/ });
      await expect(link).toHaveAttribute('href', 'https://github.com/xiechimon/cairn/pull/42');
      await expect(card.locator('[data-slot="pr-card-row"]')).toHaveCount(1);
      const rowHeight = await card.locator('[data-slot="pr-card-row"]').evaluate((el) => el.getBoundingClientRect().height);
      expect(rowHeight).toBeLessThanOrEqual(36);
      await expect(card).toHaveAttribute('data-state', c.cardState);
      await expect(card.locator('[data-slot="pr-card-state"]')).toHaveText(c.pill);
      await evidencePanelShot(page, `thread-pr-${c.name}-${theme}.png`, page.locator('.side-panel'));
      await card.getByRole('button', { name: 'Details' }).click();
      const chevron = await card.getByRole('button', { name: 'Details' }).evaluate((button) => {
        const svg = button.querySelector('svg');
        if (svg === null) throw new Error('details chevron missing');
        const box = svg.getBoundingClientRect();
        const outer = button.getBoundingClientRect();
        return {
          rotate: getComputedStyle(svg).rotate,
          transition: getComputedStyle(svg).transitionDuration,
          inside: box.left >= outer.left && box.right <= outer.right && box.top >= outer.top && box.bottom <= outer.bottom,
          square: Math.abs(box.width - box.height) < 0.5,
        };
      });
      expect(chevron.rotate).toBe('180deg');
      expect(chevron.transition).toBe('0s');
      expect(chevron.inside).toBe(true);
      expect(chevron.square).toBe(true);
      await expect(card.locator('[data-slot="pr-card-title"]')).toContainText('the thread-owned PR panel');
      if (c.name === 'ci-failed') {
        await expect(card.locator('[data-slot="pr-card-failures"]')).toHaveText('2 failed: lint, e2e (1)');
      }
      await evidencePanelShot(page, `thread-pr-${c.name}-${theme}-expanded.png`, page.locator('.side-panel'));
      await card.getByRole('button', { name: /Menu for PR/ }).click();
      await expect(page.getByRole('menuitem', { name: 'Resolve' })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: 'Open on GitHub' })).toHaveAttribute('href', /pull\/42$/);
      await page.keyboard.press('Escape');
    });
  }
}

test('a read older than ten minutes says the data is late, a finished PR does not', async ({ page }) => {
  await setup(page, { rows: [prRow({ lastReadAt: Date.now() - 47 * 60_000 })] });
  await page.goto('/app?thread=todo-1');
  await expect(panel(page).locator('[data-slot="pr-card-late"]')).toContainText('Last read 47 min ago');
  await evidencePanelShot(page, 'thread-pr-stale-light.png', page.locator('.side-panel'));
  await page.unroute('**/api/**');
  await setup(page, { rows: [prRow({ state: 'merged', lastReadAt: Date.now() - 47 * 60_000 })] });
  await page.goto('/app?thread=todo-1');
  await expect(panel(page).locator('[data-slot="pr-card"]')).toHaveAttribute('data-state', 'merged');
  await expect(panel(page).locator('[data-slot="pr-card-late"]')).toHaveCount(0);
});

test('the late-read warning appears on an idle thread once ten minutes have passed', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-06T12:00:00Z') });
  await setup(page, { rows: [prRow({ lastReadAt: new Date('2026-11-06T11:55:00Z').getTime() })] });
  await page.goto('/app?thread=todo-1');
  await expect(panel(page).locator('[data-slot="pr-card"]')).toBeVisible();
  await expect(panel(page).locator('[data-slot="pr-card-late"]')).toHaveCount(0);
  await page.clock.fastForward('07:00');
  await expect(panel(page).locator('[data-slot="pr-card-late"]')).toContainText('Last read 12 min ago');
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
      checks: { passed: 22 - i, failed: i === 2 ? 1 : 0, running: i === 1 ? 2 : 0, total: 23, failedNames: i === 2 ? ['lint'] : [] },
      additions: 10 * (i + 1),
      deletions: 8,
    }),
  );
  const extraTodos = rows
    .filter((r) => r.threadId !== 'todo-1')
    .map((r, i) => ({ ...TASK, id: r.threadId, title: `Thread ${i}`, phase: 'review', phaseAt: Date.now(), seqNum: 20 + i }));
  await setup(page, { rows }, 'light', { todos: extraTodos });
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

test('a project-filtered tasks pane lists only that project’s PRs, the unfiltered home lists all', async ({ page }) => {
  const other = { ...TASK, id: 'todo-2', projectId: 'proj-2', title: 'Other project thread', phase: 'review', phaseAt: Date.now(), seqNum: 10 };
  const rows = [
    prRow({ buildId: 'build-1', threadId: 'todo-1', number: 42, title: 'docs(1): project one change' }),
    prRow({ buildId: 'build-2', threadId: 'todo-2', projectId: 'proj-2', number: 77, title: 'docs(2): project two change' }),
  ];
  await setup(page, { rows }, 'light', {
    todos: [other],
    projects: [PROJECT, { ...PROJECT, id: 'proj-2', name: 'other' }],
  });
  await page.goto('/app?project=proj-2&pane=tasks&chat=1');
  const list = page.getByTestId('work-prs');
  await expect(list.locator('[data-slot="pr-list-row"]')).toHaveCount(1);
  await expect(list).toContainText('project two change');
  await expect(list).not.toContainText('project one change');
  await expect(list.getByRole('heading')).toContainText('1');
  await page.goto('/app?pane=tasks');
  await expect(page.getByTestId('work-prs').locator('[data-slot="pr-list-row"]')).toHaveCount(2);
});

test('an open PR of an archived thread stays in the home list and under its project, and the count stays', async ({ page }) => {
  const rows = [
    prRow({ buildId: 'build-1', threadId: 'todo-1', number: 42, title: 'docs(1): live thread change' }),
    prRow({ buildId: 'build-2', threadId: 'todo-2', projectId: 'proj-2', number: 77, title: 'docs(2): archived thread change' }),
  ];
  const more = { projects: [PROJECT, { ...PROJECT, id: 'proj-2', name: 'other' }] };
  await setup(page, { rows }, 'light', more);
  await page.goto('/app?pane=tasks');
  const list = page.getByTestId('work-prs');
  await expect(list.locator('[data-slot="pr-list-row"]')).toHaveCount(2);
  await expect(list).toContainText('archived thread change');
  await expect(list.getByRole('heading')).toContainText('2');
  await page.goto('/app?project=proj-2&pane=tasks&chat=1');
  await expect(page.getByTestId('work-prs').locator('[data-slot="pr-list-row"]')).toHaveCount(1);
  await expect(page.getByTestId('work-prs')).toContainText('archived thread change');
});

test('a project with no PRs shows the empty line even when other projects have some', async ({ page }) => {
  const other = { ...TASK, id: 'todo-2', projectId: 'proj-2', title: 'Other project thread', phase: 'review', phaseAt: Date.now(), seqNum: 10 };
  await setup(page, { rows: [prRow()] }, 'light', {
    todos: [other],
    projects: [PROJECT, { ...PROJECT, id: 'proj-2', name: 'other' }],
  });
  await page.goto('/app?project=proj-2&pane=tasks&chat=1');
  await expect(page.getByTestId('work-prs')).toContainText('PRs opened by threads are listed here.');
});

test('the PR list says what is missing when no thread has a PR', async ({ page }) => {
  await setup(page, { rows: [] });
  await page.goto('/app?pane=tasks');
  await expect(page.getByTestId('work-prs')).toContainText('PRs opened by threads are listed here.');
});

test('the same PR reaches the Tasks list and the finish dialog', async ({ page }) => {
  await setup(page, { rows: [prRow()] });
  await page.goto('/app?pane=tasks');
  await expect(page.getByTestId('work-prs').locator('[data-slot="pr-list-row"]')).toContainText('#42');
  await page.goto('/app?thread=todo-1');
  await page.getByTestId('side-chat').getByRole('button', { name: 'More actions…' }).click();
  await page.getByRole('menuitem', { name: 'Complete' }).click();
  await expect(page.getByTestId('accept-dialog-pr').getByRole('link', { name: /PR #42/ })).toHaveAttribute('href', /pull\/42$/);
});

test('a task row in the Tasks panel links its PR beside the row', async ({ page }) => {
  await setup(page, { rows: [prRow()] }, 'light', {
    tasks: [REVIEW_ENTRY],
  });
  await page.goto('/app?pane=tasks');
  const row = page.locator('[data-slot="task-row-frame"]').filter({ hasText: REVIEW_TASK.title });
  await expect(row.getByRole('link', { name: /PR #42/ })).toHaveAttribute('href', /pull\/42$/);
  await evidencePanelShot(page, 'tasks-row-pr-link-light.png', page.locator('.side-panel'));
  await row.locator('[data-slot="task-row"]').click();
  await expect(page).toHaveURL(/[?&]thread=todo-1/);
});

test('a finished task in Made links its newest PR', async ({ page }) => {
  const done = { ...TASK, id: 'todo-9', seqNum: 9, title: 'Finished with a PR', phase: 'done', phaseAt: Date.now() };
  await setup(page, { rows: [prRow({ threadId: 'todo-9', number: 77, url: 'https://github.com/xiechimon/cairn/pull/77', state: 'merged' }), prRow({ threadId: 'todo-9', number: 70, url: 'https://github.com/xiechimon/cairn/pull/70', state: 'closed' })] }, 'light', { todos: [done] });
  await page.goto('/app?pane=made');
  const row = page.getByRole('complementary', { name: 'Made' }).getByRole('link', { name: /PR #77/ });
  await expect(row).toHaveAttribute('href', /pull\/77$/);
  await expect(page.getByRole('complementary', { name: 'Made' }).getByRole('link', { name: /PR #70/ })).toHaveCount(0);
});

test('the changes view does not leak into the next thread after closing', async ({ page }) => {
  await setup(page, { rows: [prRow()] }, 'light', { tasks: [REVIEW_ENTRY] });
  await page.goto('/app?thread=todo-1&view=changes');
  await page.getByRole('button', { name: 'Close' }).first().click();
  await expect(page).not.toHaveURL(/view=changes/);
  await page.getByTestId('tasks-toggle').click();
  await page.locator('[data-slot="task-row"]').filter({ hasText: REVIEW_TASK.title }).click();
  await expect(page).toHaveURL(/thread=todo-1/);
  await expect(page).not.toHaveURL(/view=/);
  await expect(page.getByTestId('thread-pr-panel')).toBeVisible();
});

test('a closed PR with an old verdict reads Closed, not Needs re-review', async ({ page }) => {
  await setup(page, { rows: [prRow({ state: 'closed', verdict: { result: 'pass', judgedHead: '9d03b7a1e6c24f58b0a3d7e19c5f2468ab13c0de' } })] });
  await page.goto('/app?thread=todo-1');
  await expect(panel(page).locator('[data-slot="pr-card-state"]')).toHaveText('Closed');
  await expect(status(page)).not.toContainText('Closed');
  await expect(status(page).getByRole('link')).toHaveCount(0);
  await expect(panel(page).locator('[data-slot="pr-card"]')).not.toHaveAttribute('data-stale', '');
});

test('a row whose CI was never read says so instead of showing nothing', async ({ page }) => {
  await setup(page, { rows: [prRow({ checksReadFor: '', checks: { passed: 0, failed: 0, running: 0, total: 0, failedNames: [] } })] });
  await page.goto('/app?thread=todo-1');
  await expect(panel(page).locator('[data-slot="pr-checks"]')).toHaveText('CI not read');
  await expect(panel(page).locator('[data-slot="pr-card-state"]')).toHaveText('Open');
  await expect(panel(page).locator('[data-slot="pr-card-late"]')).toHaveCount(0);
  await evidencePanelShot(page, 'thread-pr-ci-unread-light.png', page.locator('.side-panel'));
});

for (const c of CASES) {
  test(`at 375px the ${c.name} status is one line and never ends on a separator`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setup(page, { rows: [prRow(c.row)] });
    await page.goto('/app?thread=todo-1');
    const row = panel(page).locator('[data-slot="pr-card-row"]');
    const text = (await row.innerText()).trim();
    expect(text).toContain('PR #42');
    expect(text).not.toMatch(/[·.…]$/);
    const box = await row.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      overflow: el.scrollWidth - el.clientWidth,
    }));
    expect(box.height).toBeLessThanOrEqual(36);
    expect(box.overflow).toBeLessThanOrEqual(0);
    await page.waitForTimeout(600);
    await evidencePanelShot(page, `thread-pr-${c.name}-375.png`, page.locator('.side-panel'));
  });
}

test('at 375px the panel and header fit without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page, { rows: [prRow({ checks: { passed: 6, failed: 2, running: 1, total: 9, failedNames: ['lint', 'e2e (1)'] } })] });
  await page.goto('/app?thread=todo-1');
  await expect(panel(page)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await evidencePanelShot(page, 'thread-pr-mobile-375.png', page.locator('.side-panel'));
});

test('the panel passes axe in the failing state', async ({ page }) => {
  await setup(page, { rows: [prRow({ checks: { passed: 6, failed: 2, running: 1, total: 9, failedNames: ['lint', 'e2e (1)'] } })] }, 'dark');
  await page.goto('/app?thread=todo-1');
  await expect(panel(page)).toBeVisible();
  const results = await new AxeBuilder({ page }).include('.side-panel').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
});
