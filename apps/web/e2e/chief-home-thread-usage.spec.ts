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
  context?: { tokens: number; contextWindow: number } | null;
}

async function setup(page: Page, options: SetupOptions = {}) {
  const requested: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('cairn.locale', 'en');
    if (localStorage.getItem('cairn-theme') === null) localStorage.setItem('cairn-theme', 'dark');
  });
  const sent = options.context === undefined ? {} : { context: options.context };
  await mockLive(page, {
    threads: [], messages: [], todos: [{ ...TASK_WITH_HISTORY, ...sent }],
    machines: [{ id: 'machine-1', name: 'omarchy', online: true }, { id: 'machine-2', name: 'Mac', online: true }],
  }, (path, _route, json) => {
    if (path === '/api/teams' && options.teams === 'error') return json({ error: 'teams failed' }, 500);
    if (path === '/api/teams' && options.teams === 'empty') return json([]);
    if (path.endsWith('/machines') && options.machinesError) return json({ error: 'machines failed' }, 500);
    if (path === '/api/todos/todo-1') return (async () => {
      await options.todoDelay;
      return json({
      ...TASK_WITH_HISTORY,
      ...(options.context === undefined ? {} : { context: options.context }),
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

const ring = (page: Page) => page.getByTestId('thread-usage-ring');
const usage = (page: Page) => page.getByTestId('thread-usage');
const stat = (page: Page, index: number) => usage(page).getByTestId('thread-usage-stats').locator('dd').nth(index);
const cost = (page: Page) => stat(page, 0);
const tokens = (page: Page) => stat(page, 1);
const ringFace = (page: Page) =>
  ring(page).evaluate((button) => ({
    label: (button as HTMLElement).innerText.trim(),
    arcs: button.querySelectorAll('svg path').length,
    tracks: button.querySelectorAll('svg circle').length,
    percent: button.getAttribute('data-percent'),
  }));
const openUsage = async (page: Page) => {
  await expect(page.getByTestId('side-chat')).toBeVisible();
  await ring(page).click();
  await expect(usage(page)).toBeVisible();
};

for (const theme of ['light', 'dark'] as const) {
test(`usage opens from the ring in the composer tool row (${theme})`, async ({ page }) => {
  await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
  const requested = await setup(page);
  await page.goto('/app?thread=todo-1');
  await expect(page.getByTestId('side-chat')).toBeVisible();
  await expect(usage(page)).toHaveCount(0);
  await page.getByTestId('side-chat').getByRole('button', { name: 'More actions…' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Usage/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(ring(page)).toHaveAccessibleName('Thread usage');
  await expect(ring(page)).toHaveAttribute('data-state', 'ready');
  expect(await ringFace(page)).toEqual({ label: '', arcs: 0, tracks: 1, percent: null });
  await ring(page).hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('$4.00 · Tokens: 2.5k');
  await page.mouse.move(0, 0);
  const row = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const card = box('.side-panel [data-testid="composer-card"]');
    const plus = box('.side-panel [data-testid="composer-plus"]');
    const meter = box('[data-testid="thread-usage-ring"]');
    return {
      below: Math.round(meter.top - card.bottom),
      sameBand: Math.abs(meter.top + meter.height / 2 - (plus.top + plus.height / 2)) < 1,
      rightInset: Math.round(card.right - meter.right),
      leftInset: Math.round(plus.left - card.left),
      inField: document.querySelector('[data-testid="composer-card"] [data-testid="thread-usage-ring"]') !== null,
    };
  });
  expect(row).toEqual({ below: 6, sameBand: true, rightInset: 6, leftInset: 6, inField: false });
  await openUsage(page);
  await expect(cost(page)).toHaveText('$4.00');
  await expect(tokens(page)).toHaveText('2.5k');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(ring(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(usage(page)).toContainText('90%');
  await expect(usage(page).locator('dt')).toHaveText(['Cost', 'Tokens', 'Cache hit', 'Models', 'Machines']);
  await expect(usage(page)).toContainText('provider/model-a');
  await expect(usage(page)).toContainText('provider/model-b');
  await expect(usage(page)).toContainText('omarchy');
  await expect(usage(page)).toContainText('Mac');
  await expect(usage(page).locator('dd').filter({ hasText: /^—$/ })).toHaveCount(0);
  await expect(usage(page)).not.toContainText('Total duration—');
  expect(new Set(requested).size).toBe(2);
  await expect(usage(page)).toContainText('Total duration is unavailable.');
  await evidencePanelShot(page, `thread-usage-expanded-${theme}.png`, usage(page));
  await page.keyboard.press('Escape');
  await expect(usage(page)).toHaveCount(0);
  await expect(page.getByTestId('side-chat')).toBeVisible();
  await ring(page).focus();
  await ring(page).press('Enter');
  await expect(usage(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(usage(page)).toHaveCount(0);
  await expect(ring(page)).toBeFocused();
  await expect(page.getByTestId('side-chat')).toBeVisible();
});

}

for (const theme of ['light', 'dark'] as const) {
  test(`the ring reads the thread's context window like the main composer's ring, and usage stays in its popover (${theme})`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await setup(page, { context: { tokens: 62_000, contextWindow: 200_000 } });
    await page.goto('/app?thread=todo-1');
    await expect(page.getByTestId('side-chat')).toBeVisible();
    await expect(ring(page)).toHaveAttribute('data-state', 'ready');
    await expect(ring(page)).toHaveAccessibleName('Context 31%');
    await expect(ring(page)).toHaveAccessibleDescription('Thread usage');
    expect(await ringFace(page)).toEqual({ label: '31%', arcs: 1, tracks: 1, percent: '31' });
    const type = await ring(page).evaluate((button) => {
      const cs = getComputedStyle(button);
      const glyph = button.querySelector('svg')!.getBoundingClientRect();
      return { size: cs.fontSize, height: Math.round(button.getBoundingClientRect().height), glyph: Math.round(glyph.width) };
    });
    expect(type).toEqual({ size: '12px', height: 28, glyph: 14 });
    await ring(page).hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('Context 31% · $4.00 · Tokens: 2.5k');
    await openUsage(page);
    await expect(usage(page).locator('dt')).toHaveText(['Context', 'Cost', 'Tokens', 'Cache hit', 'Models', 'Machines']);
    await expect(stat(page, 0)).toHaveText('31% · 62k / 200k');
    await expect(stat(page, 1)).toHaveText('$4.00');
    await expect(stat(page, 2)).toHaveText('2.5k');
    await expect(ring(page)).not.toContainText('2.5k');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await evidencePanelShot(page, `thread-usage-context-${theme}.png`, usage(page));
  });
}

test('a context reading the server sends as null or without a window draws the bare ring, never a number', async ({ page }) => {
  await setup(page, { context: null });
  await page.goto('/app?thread=todo-1');
  await expect(ring(page)).toHaveAttribute('data-state', 'ready');
  await expect(ring(page)).toHaveAccessibleName('Thread usage');
  expect(await ringFace(page)).toEqual({ label: '', arcs: 0, tracks: 1, percent: null });
  await openUsage(page);
  await expect(usage(page).locator('dt').first()).toHaveText('Cost');
});

test('a thread that has not started has no usage ring or usage request', async ({ page }) => {
  const requested = await setup(page);
  await page.route('**/api/todos/todo-1', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...TASK, latestBuildId: null, buildHistory: [] }) }));
  await page.goto('/app?thread=todo-1');
  await expect(page.getByTestId('side-chat')).toBeVisible();
  await page.getByTestId('side-chat').getByRole('button', { name: 'More actions…' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Usage/ })).toHaveCount(0);
  await expect(ring(page)).toHaveCount(0);
  await expect(usage(page)).toHaveCount(0);
  expect(requested).toEqual([]);
});

test('an unpriced thread shows an unknown cost and never a free price', async ({ page }) => {
  await setup(page, { unpriced: true });
  await page.goto('/app?thread=todo-1');
  await openUsage(page);
  await expect(tokens(page)).toHaveText('2.5k');
  await expect(usage(page)).not.toContainText('$0.00');
  await expect(cost(page)).toHaveText('—');
});

for (const missing of ['unpriced row', 'empty run'] as const) {
  test(`a priced aggregate stays unknown with an ${missing}`, async ({ page }) => {
    await setup(page, { mixedPricing: missing === 'unpriced row', emptyRun: missing === 'empty run' });
    await page.goto('/app?thread=todo-1');
    await openUsage(page);
    await expect(usage(page)).toHaveAttribute('data-state', 'ready');
      await expect(cost(page)).toHaveText('—');
    await expect(usage(page)).not.toContainText('$4.00');
    await expect(usage(page)).not.toContainText('$0.00');
    if (missing === 'empty run') await expect(tokens(page)).toHaveText('—');
    else await expect(tokens(page)).toHaveText('2.5k');
  });
}

test('a pending run never appears as a partial thread total', async ({ page }) => {
  let release: () => void = () => {};
  const delay = new Promise<void>((resolve) => { release = resolve; });
  await setup(page, { delay });
  await page.goto('/app?thread=todo-1');
  await openUsage(page);
  await expect(usage(page)).toHaveAttribute('data-state', 'loading');
  await expect(ring(page)).toHaveText('');
  await expect(usage(page)).not.toContainText('1.3k');
  await expect(cost(page)).toHaveText('—');
  release();
  await expect(usage(page)).toHaveAttribute('data-state', 'ready');
  await expect(tokens(page)).toHaveText('2.5k');
});

for (const theme of ['light', 'dark'] as const) {
test(`usage errors offer retry without claiming an unvalidated cost (${theme})`, async ({ page }) => {
  await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
  const options = { error: true };
  await setup(page, options);
  await page.goto('/app?thread=todo-1');
  await openUsage(page);
  await expect(usage(page)).toHaveAttribute('data-state', 'error');
  await expect(usage(page).getByTestId('thread-usage-retry')).toBeVisible();
  await expect(cost(page)).toHaveText('—');
  await expect(usage(page)).not.toContainText('$4.00');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await evidencePanelShot(page, `thread-usage-error-${theme}.png`, usage(page));
  options.error = false;
  await expect(usage(page).getByTestId('thread-usage-retry')).toBeVisible();
  await usage(page).getByTestId('thread-usage-retry').click();
  await expect(usage(page)).toHaveAttribute('data-state', 'ready');
  await expect(tokens(page)).toHaveText('2.5k');
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
    await expect(usage(page)).toHaveAttribute('data-state', 'error');
      await expect(usage(page)).toContainText('$4.00');
    expect(requests.filter((path) => path.endsWith('/machines'))).toEqual([]);

    delete options.teams;
    options.machinesError = true;
    await usage(page).getByTestId('thread-usage-retry').click();
    await expect.poll(() => requests.filter((path) => path === '/api/teams/t1/machines').length).toBe(2);
    await expect(usage(page)).toHaveAttribute('data-state', 'error');
    const teamRequestsAfterRecovery = requests.filter((path) => path === '/api/teams').length;

    options.machinesError = false;
    await usage(page).getByTestId('thread-usage-retry').click();
    await expect(usage(page)).toHaveAttribute('data-state', 'ready');
    await expect(usage(page)).toContainText('omarchy');
    await expect(usage(page)).toContainText('Mac');
    expect(requests.filter((path) => path === '/api/teams')).toHaveLength(teamRequestsAfterRecovery);
    expect(requests.filter((path) => path.endsWith('/machines')).every((path) => path === '/api/teams/t1/machines')).toBe(true);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`usage sits in the plus menu on a phone, accessible and inside the screen (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await setup(page);
    await page.goto('/app?thread=todo-1');
    await expect(page.getByTestId('side-chat')).toBeVisible();
    await expect(ring(page)).toHaveCount(0);
    await page.locator('.side-panel [data-testid="composer-plus"]').click();
    await expect(usage(page)).toHaveAttribute('data-state', 'ready');
    await expect(cost(page)).toHaveText('$4.00');
    await expect(tokens(page)).toHaveText('2.5k');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const violations = (await new AxeBuilder({ page }).include('[data-testid="thread-usage"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
    expect(violations.map((violation) => violation.id)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    const box = await usage(page).boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    await evidencePanelShot(page, `thread-usage-phone-${theme}.png`, page.getByRole('menu'));
  });
}


test('finishing a step refreshes whole-thread cost and current-run tokens without reloading', async ({ page }) => {
  const options: SetupOptions = { multiplier: 1, threadTotal: 4, currentCost: 2 };
  const requested = await setup(page, options);
  await page.goto('/app?thread=todo-1');
  await openUsage(page);
  await expect(tokens(page)).toHaveText('2.5k');
  await expect(cost(page)).toHaveText('$4.00');
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
  await expect(usage(page)).toHaveAttribute('data-state', 'loading');
  await expect(cost(page)).toHaveText('—');
  release();
  await expect(usage(page)).toHaveAttribute('data-state', 'ready');
  await expect(tokens(page)).toHaveText('2.6k');
  await expect(ring(page)).toHaveText('');
  await expect(cost(page)).toHaveText('$7.00');
  expect(requested.filter((path) => path.includes('build-old'))).toHaveLength(1);
  expect(requested.filter((path) => path.includes('build-1'))).toHaveLength(2);
});


test('fresh usage determines cost while the todo aggregate refresh is held', async ({ page }) => {
  const options: SetupOptions = { currentCost: 2 };
  await setup(page, options);
  await page.goto('/app?thread=todo-1');
  await openUsage(page);
  await expect(cost(page)).toHaveText('$4.00');
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
  await expect(cost(page)).toHaveText('$7.00');
  release();
  await expect(cost(page)).toHaveText('$7.00');
});

test('complete priced-zero rows show a known-free total', async ({ page }) => {
  await setup(page, { free: true, threadTotal: 9 });
  await page.goto('/app?thread=todo-1');
  await openUsage(page);
  await expect(cost(page)).toHaveText('$0.00');
  await expect(tokens(page)).toHaveText('2.5k');
});

test('switching threads closes the usage popover and never retains the previous totals', async ({ page }) => {
  await setup(page);
  const other = { ...TASK, id: 'todo-other', title: 'Another thread', seqNum: 10, latestBuildId: 'build-other', buildHistory: [{ buildId: 'build-other', createdAt: NOW }] };
  await page.route('**/api/search?*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ todos: [{ ...other, projectName: 'cairn' }], projects: [], agents: [] }) }));
  await page.route('**/api/todos/todo-other', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(other) }));
  await page.route('**/api/builds/build-other/usage', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([usageRow('build-other', 'provider/another-model', 0.5)]) }));
  await page.route('**/api/builds/build-other', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'build-other', createdAt: NOW, triggerSource: 'user' }) }));
  await page.route('**/api/conversations/build-other/messages', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ messages: [], queuedMessages: [] }) }));
  await page.goto('/app?thread=todo-1');
  await openUsage(page);
  await expect(cost(page)).toHaveText('$4.00');
  await page.keyboard.press('Escape');
  await expect(usage(page)).toHaveCount(0);
  await page.keyboard.press('Meta+k');
  const search = page.getByRole('dialog', { name: 'Search' });
  await search.getByRole('textbox').fill('Another');
  await search.locator('[data-row-kind="todo"]').click();
  await expect(page.getByTestId('side-chat')).toHaveAttribute('data-todo-id', 'todo-other');
  await expect(usage(page)).toHaveCount(0);
  await openUsage(page);
  await expect(cost(page)).toHaveText('$0.50');
  await expect(usage(page)).not.toContainText('$4.00');
});
