import AxeBuilder from '@axe-core/playwright';
import type { ConversationStepEvent } from '@cairn/shared';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, TASK } from './chief-home-mock.js';
import { evidencePanelShot } from './evidence.js';

const NOW = Date.UTC(2026, 10, 4, 8);
const TASK_WITH_HISTORY = {
  ...TASK,
  phase: 'review',
  phaseAt: NOW,
  buildHistory: [
    { buildId: 'build-old', createdAt: NOW - 200_000 },
    { buildId: 'build-1', createdAt: NOW - 100_000 },
  ],
  usageCost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.5, total: 4, priced: true },
};
const usageRow = (buildId: string, model: string, costTotal: number | null) => ({
  buildId, model, input: 100, output: 200, cacheRead: 900, cacheWrite: 50,
  costInput: null, costOutput: null, costCacheRead: null, costCacheWrite: null, costTotal,
});

interface SetupOptions {
  error?: boolean;
  unpriced?: boolean;
  mixedPricing?: boolean;
  emptyRun?: boolean;
  delay?: Promise<void>;
  todoDelay?: Promise<void>;
  free?: boolean;
  multiplier?: number;
  threadTotal?: number;
  currentCost?: number;
  teams?: 'error' | 'empty';
  machinesError?: boolean;
}

async function setup(page: Page, options: SetupOptions = {}) {
  const requested: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('cairn.locale', 'en');
    if (localStorage.getItem('cairn-theme') === null) localStorage.setItem('cairn-theme', 'dark');
  });
  await mockLive(page, {
    threads: [], messages: [], todos: [TASK_WITH_HISTORY],
    machines: [{ id: 'machine-1', name: 'omarchy', online: true }, { id: 'machine-2', name: 'Mac', online: true }],
  }, (path, _route, json) => {
    if (path === '/api/teams' && options.teams === 'error') return json({ error: 'teams failed' }, 500);
    if (path === '/api/teams' && options.teams === 'empty') return json([]);
    if (path.endsWith('/machines') && options.machinesError) return json({ error: 'machines failed' }, 500);
    if (path === '/api/todos/todo-1') return (async () => {
      await options.todoDelay;
      return json({
      ...TASK_WITH_HISTORY,
      usageCost: {
        ...TASK_WITH_HISTORY.usageCost,
        output: 2 + ((options.threadTotal ?? 4) - 4),
        total: options.threadTotal ?? 4,
        priced: options.unpriced !== true,
      },
      });
    })();
    if (/^\/api\/builds\/(build-old|build-1)$/.test(path)) return json({ id: path.split('/').at(-1), todoId: 'todo-1', createdAt: NOW - 100_000, triggerSource: 'user' });
    if (/^\/api\/builds\/(build-old|build-1)\/usage$/.test(path)) {
      requested.push(path);
      return (async () => {
        await options.delay;
        if (options.error) return json({ error: 'usage failed' }, 500);
        const old = path.includes('build-old');
        if (old && options.emptyRun) return json([]);
        return json([{ ...usageRow(old ? 'build-old' : 'build-1', old ? 'provider/model-a' : 'provider/model-b', options.unpriced || (!old && options.mixedPricing) ? null : options.free ? 0 : old ? 2 : (options.currentCost ?? 2)), input: 100 * (options.multiplier ?? 1) }]);
      })();
    }
    if (/^\/api\/builds\/(build-old|build-1)\/steps$/.test(path)) {
      const old = path.includes('build-old');
      return json([{ id: old ? 'step-old' : 'step-1', buildId: old ? 'build-old' : 'build-1', machineId: old ? 'machine-1' : 'machine-2', status: 'done', kind: 'build', createdAt: NOW - 100_000, checkpointCommit: null, skillInjection: null }]);
    }
    if (path === '/api/conversations/build-1/messages') return json({ messages: [], queuedMessages: [] });
    return undefined;
  });
  return requested;
}

const footer = (page: Page) => page.getByTestId('thread-usage');
const toggle = (page: Page) => footer(page).getByRole('button', { name: 'Thread usage' });
const openUsage = async (page: Page) => {
  await page.getByTestId('side-chat').getByRole('button', { name: 'More actions…' }).click();
  await page.getByRole('menuitem', { name: /Usage/ }).click();
  await expect(page.getByRole('dialog', { name: 'Usage' })).toBeVisible();
};

for (const theme of ['light', 'dark'] as const) {
test(`usage opens from the thread menu as one dialog (${theme})`, async ({ page }) => {
  await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
  const requested = await setup(page);
  await page.goto('/app?thread=todo-1');
  await expect(page.getByTestId('side-chat')).toBeVisible();
  await expect(footer(page)).toHaveCount(0);
  await openUsage(page);
  await expect(toggle(page)).toContainText('$4.00');
  await expect(toggle(page)).toContainText('Tokens: 2.5k');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(footer(page)).toContainText('90%');
  await expect(footer(page)).toContainText('provider/model-a');
  await expect(footer(page)).toContainText('provider/model-b');
  await expect(footer(page)).toContainText('omarchy');
  await expect(footer(page)).toContainText('Mac');
  await expect(footer(page).getByTestId('thread-usage-stats').locator('dd').nth(2)).toHaveText('—');
  expect(new Set(requested).size).toBe(2);
  await expect(page.getByRole('dialog', { name: 'Usage' }).getByTestId('thread-usage')).toBeVisible();
  await expect(footer(page)).toContainText('Total duration is unavailable.');
  await evidencePanelShot(page, `thread-usage-expanded-${theme}.png`, page.getByRole('dialog', { name: 'Usage' }));
  await toggle(page).focus();
  await toggle(page).press('Enter');
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Usage' })).toHaveCount(0);
  await expect(page.getByTestId('side-chat')).toBeVisible();
});

}

test('a thread that has not started has no usage footer or usage request', async ({ page }) => {
  const requested = await setup(page);
  await page.route('**/api/todos/todo-1', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...TASK, latestBuildId: null, buildHistory: [] }) }));
  await page.goto('/app?thread=todo-1');
  await expect(page.getByTestId('side-chat')).toBeVisible();
  await page.getByTestId('side-chat').getByRole('button', { name: 'More actions…' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Usage/ })).toHaveCount(0);
  await expect(footer(page)).toHaveCount(0);
  expect(requested).toEqual([]);
});

test('an unpriced thread shows an unknown cost and never a free price', async ({ page }) => {
  await setup(page, { unpriced: true });
  await page.goto('/app?thread=todo-1');
  await openUsage(page);
  await expect(toggle(page)).toContainText('2.5k');
  await expect(toggle(page)).not.toContainText('$0.00');
  await expect(footer(page).getByTestId('thread-usage-stats').locator('dd').first()).toHaveText('—');
});

for (const missing of ['unpriced row', 'empty run'] as const) {
  test(`a priced aggregate stays unknown with an ${missing}`, async ({ page }) => {
    await setup(page, { mixedPricing: missing === 'unpriced row', emptyRun: missing === 'empty run' });
    await page.goto('/app?thread=todo-1');
    await openUsage(page);
    await expect(footer(page)).toHaveAttribute('data-state', 'ready');
      await expect(footer(page).getByTestId('thread-usage-stats').locator('dd').first()).toHaveText('—');
    await expect(footer(page)).not.toContainText('$4.00');
    await expect(footer(page)).not.toContainText('$0.00');
    if (missing === 'empty run') await expect(footer(page).getByTestId('thread-usage-stats').locator('dd').nth(1)).toHaveText('—');
    else await expect(footer(page)).toContainText('2.5k');
  });
}

test('a pending run never appears as a partial thread total', async ({ page }) => {
  let release: () => void = () => {};
  const delay = new Promise<void>((resolve) => { release = resolve; });
  await setup(page, { delay });
  await page.goto('/app?thread=todo-1');
  await openUsage(page);
  await expect(footer(page)).toHaveAttribute('data-state', 'loading');
  await expect(toggle(page)).not.toContainText('1.3k');
  await expect(footer(page).getByTestId('thread-usage-stats').locator('dd').first()).toHaveText('—');
  release();
  await expect(footer(page)).toHaveAttribute('data-state', 'ready');
  await expect(toggle(page)).toContainText('2.5k');
});

for (const theme of ['light', 'dark'] as const) {
test(`usage errors offer retry without claiming an unvalidated cost (${theme})`, async ({ page }) => {
  await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
  const options = { error: true };
  await setup(page, options);
  await page.goto('/app?thread=todo-1');
  await openUsage(page);
  await expect(footer(page)).toHaveAttribute('data-state', 'error');
  await expect(footer(page).getByTestId('thread-usage-retry')).toBeVisible();
  await expect(footer(page).getByTestId('thread-usage-stats').locator('dd').first()).toHaveText('—');
  await expect(footer(page)).not.toContainText('$4.00');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await evidencePanelShot(page, `thread-usage-error-${theme}.png`, page.getByRole('dialog', { name: 'Usage' }));
  options.error = false;
  await expect(footer(page).getByTestId('thread-usage-retry')).toBeVisible();
  await footer(page).getByTestId('thread-usage-retry').click();
  await expect(footer(page)).toHaveAttribute('data-state', 'ready');
  await expect(toggle(page)).toContainText('2.5k');
});

}

for (const teams of ['error', 'empty'] as const) {
  test(`an unavailable team (${teams}) retries its prerequisite before machines`, async ({ page }) => {
    const options: SetupOptions = { teams };
    const requests: string[] = [];
    page.on('request', (request) => requests.push(new URL(request.url()).pathname));
    await setup(page, options);
    await page.goto('/app?thread=todo-1');
    await openUsage(page);
    await expect(footer(page)).toHaveAttribute('data-state', 'error');
      await expect(footer(page)).toContainText('$4.00');
    expect(requests.filter((path) => path.endsWith('/machines'))).toEqual([]);

    delete options.teams;
    options.machinesError = true;
    await footer(page).getByTestId('thread-usage-retry').click();
    await expect.poll(() => requests.filter((path) => path === '/api/teams/t1/machines').length).toBe(2);
    await expect(footer(page)).toHaveAttribute('data-state', 'error');
    const teamRequestsAfterRecovery = requests.filter((path) => path === '/api/teams').length;

    options.machinesError = false;
    await footer(page).getByTestId('thread-usage-retry').click();
    await expect(footer(page)).toHaveAttribute('data-state', 'ready');
    await expect(footer(page)).toContainText('omarchy');
    await expect(footer(page)).toContainText('Mac');
    expect(requests.filter((path) => path === '/api/teams')).toHaveLength(teamRequestsAfterRecovery);
    expect(requests.filter((path) => path.endsWith('/machines')).every((path) => path === '/api/teams/t1/machines')).toBe(true);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`usage is accessible and fits a phone (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await setup(page);
    await page.goto('/app?thread=todo-1');
    await openUsage(page);
    await expect(footer(page)).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const violations = (await new AxeBuilder({ page }).include('[data-testid="thread-usage"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
    expect(violations.map((violation) => violation.id)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await evidencePanelShot(page, `thread-usage-phone-${theme}.png`, page.getByRole('dialog', { name: 'Usage' }));
  });
}


test('finishing a step refreshes whole-thread cost and current-run tokens without reloading', async ({ page }) => {
  const options: SetupOptions = { multiplier: 1, threadTotal: 4, currentCost: 2 };
  const requested = await setup(page, options);
  await page.goto('/app?thread=todo-1');
  await openUsage(page);
  await expect(toggle(page)).toContainText('2.5k');
  await expect(toggle(page)).toContainText('$4.00');
  options.multiplier = 2;
  options.threadTotal = 7;
  options.currentCost = 5;
  let release: () => void = () => {};
  options.delay = new Promise<void>((resolve) => { release = resolve; });
  const event: ConversationStepEvent = {
    type: 'step',
    step: {
      id: 'step-1', buildId: 'build-1', machineId: 'machine-2', kind: 'build',
      status: 'done', createdAt: NOW - 100_000, checkpointCommit: null, skillInjection: null,
    },
  };
  await page.evaluate((ev) => {
    const stream = window.__es.find((entry) => entry.url.includes('/api/conversations/build-1/stream'));
    if (stream === undefined) throw new Error('build stream did not connect');
    stream.emit(ev);
  }, event);
  await expect(footer(page)).toHaveAttribute('data-state', 'loading');
  await expect(footer(page).getByTestId('thread-usage-stats').locator('dd').first()).toHaveText('—');
  release();
  await expect(footer(page)).toHaveAttribute('data-state', 'ready');
  await expect(toggle(page)).toContainText('2.6k');
  await expect(toggle(page)).toContainText('$7.00');
  expect(requested.filter((path) => path.includes('build-old'))).toHaveLength(1);
  expect(requested.filter((path) => path.includes('build-1'))).toHaveLength(2);
});


test('fresh usage determines cost while the todo aggregate refresh is held', async ({ page }) => {
  const options: SetupOptions = { currentCost: 2 };
  await setup(page, options);
  await page.goto('/app?thread=todo-1');
  await openUsage(page);
  await expect(toggle(page)).toContainText('$4.00');
  options.currentCost = 5;
  let release: () => void = () => {};
  options.todoDelay = new Promise<void>((resolve) => { release = resolve; });
  const event: ConversationStepEvent = {
    type: 'step',
    step: {
      id: 'step-1', buildId: 'build-1', machineId: 'machine-2', kind: 'build',
      status: 'done', createdAt: NOW - 100_000, checkpointCommit: null, skillInjection: null,
    },
  };
  await page.evaluate((ev) => {
    const stream = window.__es.find((entry) => entry.url.includes('/api/conversations/build-1/stream'));
    if (stream === undefined) throw new Error('build stream did not connect');
    stream.emit(ev);
  }, event);
  await expect(toggle(page)).toContainText('$7.00');
  release();
  await expect(toggle(page)).toContainText('$7.00');
});

test('complete priced-zero rows show a known-free total', async ({ page }) => {
  await setup(page, { free: true, threadTotal: 9 });
  await page.goto('/app?thread=todo-1');
  await openUsage(page);
  await expect(toggle(page)).toContainText('$0.00');
  await expect(toggle(page)).toContainText('Tokens: 2.5k');
});

test('switching threads resets the disclosure and never retains the previous totals', async ({ page }) => {
  await setup(page);
  const other = { ...TASK, id: 'todo-other', title: 'Another thread', seqNum: 10, latestBuildId: 'build-other', buildHistory: [{ buildId: 'build-other', createdAt: NOW }] };
  await page.route('**/api/search?*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ todos: [{ ...other, projectName: 'cairn' }], projects: [], agents: [] }) }));
  await page.route('**/api/todos/todo-other', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(other) }));
  await page.route('**/api/builds/build-other/usage', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([usageRow('build-other', 'provider/another-model', 0.5)]) }));
  await page.route('**/api/builds/build-other', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'build-other', createdAt: NOW, triggerSource: 'user' }) }));
  await page.route('**/api/conversations/build-other/messages', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ messages: [], queuedMessages: [] }) }));
  await page.goto('/app?thread=todo-1');
  await openUsage(page);
  await expect(toggle(page)).toContainText('$4.00');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Usage' })).toHaveCount(0);
  await page.keyboard.press('Meta+k');
  const search = page.getByRole('dialog', { name: 'Search' });
  await search.getByRole('textbox').fill('Another');
  await search.locator('[data-row-kind="todo"]').click();
  await expect(page.getByTestId('side-chat')).toHaveAttribute('data-todo-id', 'todo-other');
  await expect(page.getByRole('dialog', { name: 'Usage' })).toHaveCount(0);
  await openUsage(page);
  await expect(toggle(page)).toContainText('$0.50');
  await expect(toggle(page)).not.toContainText('$4.00');
});
