import AxeBuilder from '@axe-core/playwright';
import type { ScheduleRecord } from '@cairn/shared';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, TASK } from './chief-home-mock.js';
import { evidencePanelShot, evidenceShot } from './evidence.js';
import { settleTransitions } from './helpers.js';

const NOW = Date.UTC(2026, 10, 4, 8);

function schedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: 'schedule-1', teamId: 't1', projectId: 'proj-1', todoId: 'todo-1', kind: 'daily',
    cron: '0 9 * * *', prompt: 'Run the login suite and report failures.', enabled: true,
    at: Date.UTC(2026, 10, 4, 1), tz: 'Asia/Shanghai', nextRunAt: NOW + 3_600_000,
    lastRunAt: NOW - 86_400_000, lastRunStatus: 'completed', pausedReason: null, createdBy: 'u1',
    todo: { seqNum: 9, title: TASK.title, phase: 'building', projectName: 'cairn', ownerId: 'u1' },
    ...overrides,
  };
}

async function setup(page: Page, options: { rows?: ScheduleRecord[]; failLoad?: boolean; rejectPatch?: boolean; rejectDelete?: boolean; delay?: Promise<void> } = {}) {
  await page.clock.install({ time: NOW });
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
  const state = { rows: options.rows ?? [schedule()], patched: [] as unknown[], deleted: [] as string[] };
  await mockLive(page, { threads: [], messages: [], todos: [TASK] }, (path, route, json) => {
    const method = route.request().method();
    if (path === '/api/todos/todo-1') return json(TASK);
    if (path === '/api/builds/build-1') return json({ id: 'build-1', todoId: 'todo-1', createdAt: NOW - 1000, triggerSource: 'user' });
    if (path === '/api/conversations/build-1/messages') return json({ messages: [], queuedMessages: [] });
    if (path === '/api/schedules' && method === 'GET') return (async () => {
      await options.delay;
      return options.failLoad ? json({ error: 'cannot load' }, 500) : json(state.rows);
    })();
    const id = /^\/api\/schedules\/([^/]+)$/.exec(path)?.[1];
    if (id === undefined) return undefined;
    if (method === 'PATCH') {
      const body = route.request().postDataJSON() as { enabled: boolean };
      state.patched.push({ id, ...body });
      if (options.rejectPatch) return json({ error: 'Cannot enable this schedule' }, 409);
      state.rows = state.rows.map((row) => row.id === id ? { ...row, enabled: body.enabled, nextRunAt: body.enabled ? NOW + 86_400_000 : null, pausedReason: null } : row);
      return json(state.rows.find((row) => row.id === id));
    }
    if (method === 'DELETE') {
      state.deleted.push(id);
      if (options.rejectDelete) return json({ error: 'Delete failed' }, 500);
      state.rows = state.rows.filter((row) => row.id !== id);
      return json({ ok: true });
    }
    return undefined;
  });
  return state;
}

const badge = (page: Page) => page.getByTestId('automation-badge');
const popover = (page: Page) => page.getByRole('dialog', { name: 'Automations', exact: true });

async function refreshSchedules(page: Page) {
  await page.waitForFunction(() =>
    window.__es.some((entry) => entry.url.includes('/api/teams/t1/stream')),
  );
  await page.evaluate(() => {
    const stream = window.__es.find((entry) => entry.url.includes('/api/teams/t1/stream'));
    if (stream === undefined) throw new Error('team stream did not connect');
    stream.emit({ type: 'todo', doc: { id: 'todo-1' } });
  });
}

async function automationEvidenceShot(page: Page, name: string) {
  await settleTransitions(page);
  const panel = await page.locator('.side-panel').boundingBox();
  const viewport = page.viewportSize();
  if (panel === null || viewport === null) throw new Error('automation capture has no panel or viewport');
  const popup = await page.getByTestId('automation-popover').count() === 0
    ? null : await page.getByTestId('automation-popover').boundingBox();
  const boxes = [panel, ...(popup === null ? [] : [popup])];
  const x = Math.max(0, Math.min(...boxes.map((box) => box.x)) - 12);
  const y = Math.max(0, Math.min(...boxes.map((box) => box.y)) - 12);
  const right = Math.min(viewport.width, Math.max(...boxes.map((box) => box.x + box.width)) + 12);
  const bottom = Math.min(viewport.height, Math.max(...boxes.map((box) => box.y + box.height)) + 12);
  await evidenceShot(page, name, { x, y, width: right - x, height: bottom - y });
}

test('a title chip opens the saved cadence, next run, prompt and enabled state', async ({ page }) => {
  await setup(page);
  await page.goto('/app?thread=todo-1');
  await expect(badge(page)).toHaveText('1');
  await badge(page).click();
  await expect(popover(page)).toContainText('Every day at 09:00');
  await expect(popover(page)).toContainText('Next run in 1 hour');
  await expect(popover(page)).toContainText('Run the login suite and report failures.');
  await expect(popover(page).getByRole('switch', { name: 'Enable automation' })).toBeChecked();
});

test('pause and resume use the PATCH response and recomputed next run', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/app?thread=todo-1');
  await badge(page).click();
  const enabled = popover(page).getByRole('switch', { name: 'Enable automation' });
  await enabled.click();
  await expect(enabled).not.toBeChecked();
  await expect(popover(page)).toContainText('Paused');
  await expect(popover(page)).not.toContainText('Next run in');
  await enabled.click();
  await expect(enabled).toBeChecked();
  await expect(popover(page)).toContainText('Next run in 1 day');
  expect(state.patched).toEqual([{ id: 'schedule-1', enabled: false }, { id: 'schedule-1', enabled: true }]);
});

test('an open popover refreshes its countdown when the page stays idle', async ({ page }) => {
  await setup(page);
  await page.goto('/app?thread=todo-1');
  await badge(page).click();
  await expect(popover(page)).toContainText('Next run in 1 hour');
  await page.clock.fastForward(61 * 60_000);
  await expect(popover(page)).toContainText('Next run is due');
});

test('a rejected enable leaves the schedule paused with a retryable error', async ({ page }) => {
  const options = { rows: [schedule({ enabled: false, nextRunAt: null })], rejectPatch: true };
  await setup(page, options);
  await page.goto('/app?thread=todo-1');
  await badge(page).click();
  const enabled = popover(page).getByRole('switch', { name: 'Enable automation' });
  await enabled.click();
  await expect(popover(page).getByRole('alert')).toContainText('Cannot enable this schedule');
  await expect(enabled).not.toBeChecked();
  options.rejectPatch = false;
  await enabled.click();
  await expect(enabled).toBeChecked();
});

test('delete removes only the matching automation after success', async ({ page }) => {
  const state = await setup(page, { rows: [schedule(), schedule({ id: 'other', todoId: 'todo-other' })] });
  await page.goto('/app?thread=todo-1');
  await expect(badge(page)).toHaveText('1');
  await badge(page).click();
  await popover(page).getByRole('button', { name: 'Delete automation' }).click();
  await expect(badge(page)).toHaveCount(0);
  expect(state.deleted).toEqual(['schedule-1']);
  expect(state.rows.map((row) => row.id)).toEqual(['other']);
});

test('a failed delete retains the chip and lets the user retry', async ({ page }) => {
  const options = { rejectDelete: true };
  await setup(page, options);
  await page.goto('/app?thread=todo-1');
  await badge(page).click();
  await popover(page).getByRole('button', { name: 'Delete automation' }).click();
  await expect(popover(page).getByRole('alert')).toContainText('Delete failed');
  await expect(badge(page)).toHaveText('1');
  options.rejectDelete = false;
  await popover(page).getByRole('button', { name: 'Delete automation' }).click();
  await expect(badge(page)).toHaveCount(0);
});

test('a retained completed once record shows the last run and no switch', async ({ page }) => {
  await setup(page, { rows: [schedule({ kind: 'once', enabled: false, nextRunAt: null })] });
  await page.goto('/app?thread=todo-1');
  await badge(page).click();
  await expect(popover(page)).toContainText('Last run');
  await expect(popover(page)).toContainText('No upcoming runs');
  await expect(popover(page).getByRole('switch')).toHaveCount(0);
});

test('no matching schedule has no badge, while load errors have a retry control', async ({ page }) => {
  const options = { rows: [] as ScheduleRecord[], failLoad: true };
  await setup(page, options);
  await page.goto('/app?thread=todo-1');
  await expect(page.getByTestId('automation-load-error')).toBeVisible();
  await expect(badge(page)).toHaveCount(0);
  options.failLoad = false;
  await page.getByTestId('automation-load-error').click();
  await expect(page.getByTestId('automation-load-error')).toHaveCount(0);
  await expect(badge(page)).toHaveCount(0);
});

test('a failed refresh of a cached empty list remains retryable instead of looking empty', async ({ page }) => {
  const options = { rows: [] as ScheduleRecord[], failLoad: false };
  const state = await setup(page, options);
  await page.goto('/app?thread=todo-1');
  await expect(page.getByTestId('side-chat')).toBeVisible();
  await expect(badge(page)).toHaveCount(0);
  await expect(page.getByTestId('automation-loading')).toHaveCount(0);
  options.failLoad = true;
  await refreshSchedules(page);
  await expect(page.getByTestId('automation-load-error')).toBeVisible();
  options.failLoad = false;
  state.rows = [schedule()];
  await page.getByTestId('automation-load-error').click();
  await expect(badge(page)).toHaveText('1');
  await expect(page.getByTestId('automation-load-error')).toHaveCount(0);
});

test('loading is not presented as an empty schedule list', async ({ page }) => {
  let release: () => void = () => {};
  const delay = new Promise<void>((resolve) => { release = resolve; });
  await setup(page, { delay });
  await page.goto('/app?thread=todo-1');
  await expect(page.getByTestId('automation-loading')).toBeVisible();
  await expect(badge(page)).toHaveCount(0);
  release();
  await expect(badge(page)).toHaveText('1');
});

test('Escape closes the automation popover before the underlying thread', async ({ page }) => {
  await setup(page);
  await page.goto('/app?thread=todo-1');
  await badge(page).click();
  await page.keyboard.press('Escape');
  await expect(popover(page)).toHaveCount(0);
  await expect(page.getByTestId('side-chat')).toBeVisible();
  await expect(badge(page)).toBeFocused();
});

test('switching threads closes the old automation and keeps its controls out of the next thread', async ({ page }) => {
  const state = await setup(page);
  const other = { ...TASK, id: 'todo-other', title: 'Other thread', seqNum: 10, latestBuildId: null };
  await page.route('**/api/search?*', (route) => route.fulfill({ json: { todos: [{ ...other, projectName: 'cairn' }], projects: [], agents: [] } }));
  await page.route('**/api/todos/todo-other', (route) => route.fulfill({ json: other }));
  await page.goto('/app?thread=todo-1');
  await badge(page).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k');
  const search = page.getByRole('dialog', { name: 'Search', exact: true });
  await search.getByRole('textbox').fill('Other');
  await search.locator('[data-row-kind="todo"]').click();
  await expect(page.getByTestId('side-chat')).toHaveAttribute('data-todo-id', 'todo-other');
  await expect(badge(page)).toHaveCount(0);
  await expect(popover(page)).toHaveCount(0);
  expect(state.patched).toEqual([]);
  expect(state.deleted).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) {
  test(`phone popover keeps the composer reachable and has no axe violations (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await setup(page);
    await page.goto('/app?thread=todo-1');
    await badge(page).click();
    await expect(popover(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    const violations = (await new AxeBuilder({ page }).include('[data-testid="automation-popover"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
    expect(violations.map((violation) => violation.id)).toEqual([]);
    await evidencePanelShot(page, `thread-automation-phone-${theme}.png`, page.locator('.side-panel'));
    await page.keyboard.press('Escape');
    await expect(page.locator('.side-panel .composer textarea')).toBeEditable();
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`automation states remain usable (${theme}, ${viewport.width}px)`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
      const options = { rejectPatch: false };
      const state = await setup(page, options);
      await page.goto('/app?thread=todo-1');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(badge(page)).toHaveText('1');
      const suffix = `${theme}-${viewport.width}`;
      await automationEvidenceShot(page, `automation-quiet-${suffix}.png`);
      await badge(page).click();
      await expect(popover(page)).toContainText('Next run in 1 hour');
      await automationEvidenceShot(page, `automation-active-${suffix}.png`);
      const enabled = popover(page).getByRole('switch', { name: 'Enable automation' });
      await enabled.click();
      await expect(enabled).not.toBeChecked();
      await expect(popover(page)).toContainText('Paused');
      await automationEvidenceShot(page, `automation-paused-${suffix}.png`);
      options.rejectPatch = true;
      await enabled.click();
      await expect(popover(page).getByRole('alert')).toContainText('Cannot enable this schedule');
      await automationEvidenceShot(page, `automation-error-${suffix}.png`);
      options.rejectPatch = false;
      await enabled.click();
      await expect(enabled).toBeChecked();
      state.rows = [schedule({ enabled: false, nextRunAt: null, pausedReason: 'Host was deleted' })];
      await refreshSchedules(page);
      await expect(popover(page)).toContainText('Auto-disabled');
      await expect(popover(page)).toContainText('Host was deleted');
      await automationEvidenceShot(page, `automation-disabled-${suffix}.png`);
      state.rows = [schedule({ kind: 'once', at: NOW - 86_400_000, enabled: true, nextRunAt: null })];
      await refreshSchedules(page);
      await expect(popover(page)).toContainText('No upcoming runs');
      await expect(popover(page).getByRole('switch')).toHaveCount(0);
      await automationEvidenceShot(page, `automation-retained-finished-${suffix}.png`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await page.keyboard.press('Escape');
      await expect(page.locator('.side-panel .composer textarea')).toBeEditable();
    });
  }
}
