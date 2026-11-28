import type { ConversationStepEvent } from '@cairn/shared';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, TASK } from './chief-home-mock.js';

const NOW = Date.UTC(2026, 10, 4, 8);
const file = (path: string, additions: number, deletions: number) => ({
  path, status: 'modified', additions, deletions, hunks: [],
});

const TODO = {
  ...TASK, phase: 'review', phaseAt: NOW,
  buildHistory: [{ buildId: 'build-1', createdAt: NOW - 100_000 }],
  usageCost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.5, total: 4, priced: true },
};

async function setup(page: Page) {
  const state = { files: [file('src/chief/task-refs.ts', 12, 3), file('src/chief/rows.tsx', 20, 6)] };
  await mockLive(page, {
    threads: [], messages: [], machines: [{ id: 'machine-1', name: 'omarchy', online: true }],
    todos: [TODO],
  }, (path, _route, json) => {
    if (path === '/api/todos/todo-1') return json(TODO);
    if (path === '/api/builds/build-1') return json({ id: 'build-1', todoId: 'todo-1', createdAt: NOW - 100_000, triggerSource: 'user' });
    if (path === '/api/builds/build-1/changes') return json({ files: state.files });
    if (path === '/api/builds/build-1/steps')
      return json([{ id: 'step-1', buildId: 'build-1', machineId: 'machine-1', status: 'done', kind: 'build', createdAt: NOW - 100_000, checkpointCommit: null, skillInjection: null }]);
    if (path === '/api/builds/build-1/usage') return json([]);
    if (path === '/api/conversations/build-1/messages') return json({ messages: [], queuedMessages: [] });
    return undefined;
  });
  return state;
}

async function step(page: Page) {
  const event: ConversationStepEvent = {
    type: 'step',
    step: {
      id: 'step-1', buildId: 'build-1', machineId: 'machine-1', kind: 'build',
      status: 'running', createdAt: NOW - 100_000, checkpointCommit: null, skillInjection: null,
    },
  };
  await page.waitForFunction(() => window.__es.some((es) => es.url.includes('/api/conversations/build-1/stream')));
  await page.evaluate((ev) => {
    window.__es.find((es) => es.url.includes('/api/conversations/build-1/stream'))?.emit(ev);
  }, event);
}

test('a file changed during the run grows in as a row and the counts roll to their new totals', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/app?thread=todo-1&view=changes');
  const card = page.getByTestId('side-chat-changes');
  await expect(card).toBeVisible();
  const rows = card.getByTestId('side-chat-file');
  await expect(rows).toHaveCount(2);
  expect(await card.locator('[data-grow], .grow-digit').count()).toBe(0);
  expect(await card.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);

  state.files = [...state.files, file('e2e/task-ref-grow.spec.ts', 69, 0)];
  await step(page);
  await expect(rows).toHaveCount(3);
  await expect(card.locator('[data-grow]')).toHaveCount(1);
  await expect(card.locator('[data-grow]')).toContainText('task-ref-grow.spec.ts');
  await expect(page.getByTestId('side-chat-changes-toggle')).toContainText('+101');
  await expect(page.getByTestId('side-chat-changes-toggle').locator('.grow-digit')).toHaveCount(1);
  await expect(rows.nth(0).locator('.grow-digit')).toHaveCount(0);
});

test('reopening the thread shows the same changes still, with nothing growing', async ({ page }) => {
  await setup(page);
  await page.goto('/app?thread=todo-1&view=changes');
  const card = page.getByTestId('side-chat-changes');
  await expect(card.getByTestId('side-chat-file')).toHaveCount(2);
  await page.reload();
  await expect(card.getByTestId('side-chat-file')).toHaveCount(2);
  expect(await card.locator('[data-grow], .grow-digit').count()).toBe(0);
});
