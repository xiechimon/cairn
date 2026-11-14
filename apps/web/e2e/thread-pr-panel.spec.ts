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

test('a task row lists its own PRs under it: open PRs with their state, merged ones folded into one count', async ({ page }) => {
  const rows = [
    prRow({ buildId: 'build-1', number: 42, checks: { passed: 6, failed: 2, running: 0, total: 8, failedNames: ['lint'] } }),
    ...[51, 52, 53].map((n) => prRow({ buildId: `build-m${n}`, number: n, state: 'merged', title: `docs(${n}): merged change` })),
    prRow({ buildId: 'build-x', threadId: 'todo-other', number: 99, title: 'docs(99): another thread' }),
  ];
  await setup(page, { rows }, 'light', { tasks: [REVIEW_ENTRY] });
  await page.goto('/app?pane=tasks');
  const row = page.locator('[data-slot="task-row-frame"]').filter({ hasText: REVIEW_TASK.title });
  const line = row.locator('[data-slot="task-pr-line"]');
  const open = line.locator('[data-slot="task-pr"][data-state="open"]');
  await expect(open).toHaveText('#42 — Checks failed');
  await expect(open).toHaveAttribute('data-tone', 'failed');
  await expect(open).toHaveAttribute('href', /pull\/42$/);
  await expect(open).toHaveRole('link');
  await expect(line.locator('[data-slot="task-pr-merged"]')).toHaveText('3 merged');
  await expect(line).not.toContainText('#99');
  await expect(page.getByTestId('work-prs')).toHaveCount(0);
  await evidencePanelShot(page, 'tasks-row-pr-line-light.png', page.locator('.side-panel'));
  await open.hover();
  const card = page.locator('[data-slot="popover-content"]').filter({ visible: true });
  await expect(card).toContainText('the thread-owned PR panel');
  const panelLeft = (await page.locator('.side-panel').boundingBox())?.x ?? 0;
  const cardBox = await card.boundingBox();
  expect((cardBox?.x ?? 0) + (cardBox?.width ?? 0)).toBeLessThanOrEqual(panelLeft);
  await page.mouse.move(5, 5);
  await line.locator('[data-slot="task-pr-merged"]').hover();
  await expect(page.locator('[data-slot="popover-content"]').filter({ visible: true }).getByRole('link')).toHaveCount(3);
});

test('a task row shows its age as a compact stamp', async ({ page }) => {
  await setup(page, { rows: [] }, 'light', { tasks: [{ ...REVIEW_ENTRY, phaseAt: Date.now() - 7 * 60_000 }] });
  await page.goto('/app?pane=tasks');
  const row = page.locator('[data-slot="task-row-frame"]').filter({ hasText: REVIEW_TASK.title });
  await expect(row.locator('[data-slot="task-row-stamp"]')).toHaveText('7m');
  await expect(row.locator('[data-slot="task-pr-line"]')).toHaveCount(0);
});

test('the same PR reaches the Tasks row and the finish dialog', async ({ page }) => {
  await setup(page, { rows: [prRow()] }, 'light', { tasks: [REVIEW_ENTRY] });
  await page.goto('/app?pane=tasks');
  await expect(page.locator('[data-slot="task-pr-line"]')).toContainText('#42');
  await page.goto('/app?thread=todo-1');
  await page.getByTestId('side-chat').getByRole('button', { name: 'More actions…' }).click();
  await page.getByRole('menuitem', { name: 'Complete' }).click();
  await expect(page.getByTestId('accept-dialog-pr').getByRole('link', { name: /PR #42/ })).toHaveAttribute('href', /pull\/42$/);
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
