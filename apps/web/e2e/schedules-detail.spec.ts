import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, TASK } from './chief-home-mock.js';
import { evidencePanelShot } from './evidence.js';
import { settleTransitions } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

const NOW = Date.UTC(2026, 10, 4, 12);
const INITIAL = {
  id: 'schedule-1', teamId: 't1', projectId: 'proj-1', todoId: 'todo-1', kind: 'daily',
  cron: '0 9 * * *', prompt: 'Run the release checks and report failures.', enabled: true,
  at: Date.UTC(2026, 10, 4, 1), tz: 'Asia/Shanghai', nextRunAt: NOW + 86_400_000,
  lastRunAt: NOW - 86_400_000, lastRunStatus: 'completed', lastRunError: null, pausedReason: null,
  createdBy: 'u1', todo: { seqNum: 9, title: 'Nightly release checks', phase: 'done', projectName: 'cairn', ownerId: 'u1' },
};

type ProbeSchedule = Omit<typeof INITIAL, 'nextRunAt' | 'pausedReason'> & { nextRunAt: number | null; pausedReason: string | null };

async function setup(page: Page, patch: Partial<ProbeSchedule> = {}) {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
  let schedule = { ...INITIAL, ...patch };
  const calls: { method: string; path: string; body: unknown }[] = [];
  let failNext = false;
  let visible = true;
  let failLoads = false;
  let loadGate: Promise<void> | null = null;
  let releaseLoad: (() => void) | null = null;
  let changeGate: Promise<void> | null = null;
  let releaseChange: (() => void) | null = null;
  await mockLive(page, { threads: [], messages: [], todos: [{ ...TASK, phase: 'done' }], projects: [PROJECT] }, (path, route, json) => {
    if (!path.startsWith('/api/schedules')) return undefined;
    const request = route.request();
    if (request.method() === 'GET') return (async () => {
      if (loadGate !== null) await loadGate;
      return failLoads ? json({ error: 'Schedule load failed' }, 500) : json(visible ? [schedule] : []);
    })();
    calls.push({ method: request.method(), path, body: request.method() === 'DELETE' ? null : request.postDataJSON() });
    return (async () => {
    if (changeGate !== null) await changeGate;
    if (failNext) { failNext = false; return json({ error: 'Schedule update failed' }, 409); }
    if (request.method() === 'PATCH') schedule = { ...schedule, ...request.postDataJSON(), pausedReason: request.postDataJSON().enabled ? null : schedule.pausedReason, nextRunAt: request.postDataJSON().enabled ? NOW + 3_600_000 : null };
    else if (path.endsWith('/run')) schedule = { ...schedule, nextRunAt: NOW };
    else if (request.method() === 'POST') schedule = { ...schedule, ...request.postDataJSON(), id: 'schedule-2' };
    return json(schedule);
    })();
  });
  return {
    calls,
    rejectNext: () => { failNext = true; },
    show: (next: boolean) => { visible = next; },
    rejectLoads: (next: boolean) => { failLoads = next; },
    holdLoads: () => { loadGate = new Promise<void>((resolve) => { releaseLoad = resolve; }); },
    releaseLoads: () => { loadGate = null; releaseLoad?.(); releaseLoad = null; },
    holdChanges: () => { changeGate = new Promise<void>((resolve) => { releaseChange = resolve; }); },
    releaseChanges: () => { changeGate = null; releaseChange?.(); releaseChange = null; },
  };
}

const SCHEDULES = '/app?pane=tasks&tab=scheduled';
const editor = (page: Page) => page.getByTestId('schedule-popover');
const panel = (page: Page) => page.getByRole('complementary', { name: 'Tasks', exact: true });
const scheduleRow = (page: Page) =>
  page.locator('[data-slot="schedule-row"]', { hasText: 'Nightly release checks' });
const rowMenu = (page: Page) =>
  page
    .locator('[data-slot="schedule-row-frame"]', { hasText: 'Nightly release checks' })
    .getByTestId('schedule-row-menu-button');
async function scheduleShot(page: Page, name: string, theme: 'light' | 'dark' = 'light') {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await settleTransitions(page);
  await evidencePanelShot(page, name, editor(page));
}
async function expandEnded(page: Page) {
  await page.getByTestId('schedules-ended').getByRole('button', { name: /Ended/ }).click();
}
async function visit(page: Page, ended = false) {
  await page.goto(SCHEDULES);
  await expect(panel(page).getByRole('tab', { name: 'Schedules' })).toHaveAttribute('aria-selected', 'true');
  if (ended) await expandEnded(page);
  await expect(scheduleRow(page)).toBeVisible();
}
async function open(page: Page, ended = false) {
  await visit(page, ended);
  await scheduleRow(page).click();
  await expect(editor(page)).toContainText('Nightly release checks');
}
async function menu(page: Page) {
  await scheduleRow(page).hover();
  await rowMenu(page).click();
  return page.getByRole('menu');
}

test('a schedule row opens the editor with its runs, saved prompt and a link to the task', async ({ page }) => {
  await setup(page);
  await open(page);
  const popover = editor(page);
  await expect(popover.getByTestId('schedule-popover-runs')).toContainText('Next run');
  await expect(popover.getByTestId('schedule-popover-runs')).toContainText('Last run');
  await expect(popover.getByRole('textbox', { name: 'Saved prompt' })).toHaveValue(INITIAL.prompt);
  await expect(popover.getByRole('radio', { name: 'Daily', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(popover.getByTitle('Asia/Shanghai')).toHaveText('China Standard Time');
  await scheduleShot(page, 'schedule-editor-desktop.png');
  await expect(popover).toContainText('Runs on the hour may start a few minutes late.');
  await popover.getByRole('link', { name: 'Open task', exact: true }).click();
  await expect(page).toHaveURL(/thread=todo-1/);
});

test('pause and resume wait for API state, and Run now cannot fire while paused', async ({ page }) => {
  const probe = await setup(page);
  await visit(page);
  await (await menu(page)).getByRole('menuitem', { name: /Pause schedule/ }).click();
  await expect(page.getByText('Schedule paused.')).toBeVisible();
  await expect(scheduleRow(page)).toContainText('Paused');
  const paused = await menu(page);
  await expect(paused.getByRole('menuitem', { name: /Run now/ })).toBeDisabled();
  await paused.getByRole('menuitem', { name: /Resume schedule/ }).click();
  await expect(page.getByText('Schedule resumed.')).toBeVisible();
  await expect(scheduleRow(page)).not.toContainText('Paused');
  await expect((await menu(page)).getByRole('menuitem', { name: /Run now/ })).toBeEnabled();
  expect(probe.calls.map((call) => call.body)).toEqual([{ enabled: false }, { enabled: true }]);
});

for (const enabled of [true, false]) {
  test(`a rejected ${enabled ? 'pause' : 'resume'} keeps the saved state and can be retried`, async ({ page }) => {
    const probe = await setup(page, { enabled, nextRunAt: enabled ? INITIAL.nextRunAt : null });
    await visit(page);
    const toggle = enabled ? /Pause schedule/ : /Resume schedule/;
    probe.rejectNext();
    await (await menu(page)).getByRole('menuitem', { name: toggle }).click();
    await expect(page.getByText('Could not update the schedule. Try again.')).toBeVisible();
    if (enabled) await expect(scheduleRow(page)).not.toContainText('Paused');
    else await expect(scheduleRow(page)).toContainText('Paused');
    await page.keyboard.press('Escape');
    await (await menu(page)).getByRole('menuitem', { name: toggle }).click();
    if (enabled) await expect(scheduleRow(page)).toContainText('Paused');
    else await expect(scheduleRow(page)).not.toContainText('Paused');
    expect(probe.calls.map((call) => call.body)).toEqual([{ enabled: !enabled }, { enabled: !enabled }]);
  });
}

test('an auto-disabled schedule keeps its reason when resuming fails and clears it once resumed', async ({ page }) => {
  const probe = await setup(page, { enabled: false, nextRunAt: null, pausedReason: 'Task archived' });
  await visit(page);
  await expect(scheduleRow(page)).toContainText('The task was archived, so the schedule stopped');
  probe.rejectNext();
  await (await menu(page)).getByRole('menuitem', { name: /Resume schedule/ }).click();
  await expect(page.getByText('Could not update the schedule. Try again.')).toBeVisible();
  await expect(scheduleRow(page)).toContainText('The task was archived, so the schedule stopped');
  await page.keyboard.press('Escape');
  await (await menu(page)).getByRole('menuitem', { name: /Resume schedule/ }).click();
  await expect(scheduleRow(page)).not.toContainText('The task was archived, so the schedule stopped');
  expect(probe.calls.map((call) => call.body)).toEqual([{ enabled: true }, { enabled: true }]);
});

test('Run now calls the actual run endpoint and then reads as queued', async ({ page }) => {
  const probe = await setup(page);
  await visit(page);
  await (await menu(page)).getByRole('menuitem', { name: /Run now/ }).click();
  await expect(page.getByText('Run queued.')).toBeVisible();
  expect(probe.calls).toContainEqual({ method: 'POST', path: '/api/schedules/schedule-1/run', body: {} });
  await expect((await menu(page)).getByRole('menuitem', { name: /Run now/ })).toBeDisabled();
});

test('the Tasks panel lists schedules in the Schedules tab only, and the row menu edits in the small editor', async ({ page }) => {
  await setup(page);
  await page.goto('/app?pane=tasks');
  const panel = page.getByRole('complementary', { name: 'Tasks', exact: true });
  await expect(panel.locator('[data-slot="schedule-row"]')).toHaveCount(0);
  await panel.getByRole('tab', { name: 'Schedules' }).click();
  await expect(panel.locator('[data-slot="schedule-row"]')).toContainText('Nightly release checks');
  await expect(panel).not.toContainText('Manage schedules');
  const frame = panel.locator('[data-slot="schedule-row-frame"]').first();
  await frame.hover();
  await frame.getByTestId('schedule-row-menu-button').click();
  await page.getByRole('menuitem', { name: /Edit/ }).click();
  await expect(page.getByTestId('schedule-popover')).toContainText('Nightly release checks');
});

test('the Schedules tab lists schedules while the tasks request has failed', async ({ page }) => {
  await setup(page);
  await page.route('**/api/tasks?*', (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.goto('/app?pane=tasks');
  const panel = page.getByRole('complementary', { name: 'Tasks', exact: true });
  await expect(panel.getByTestId('query-error')).toBeVisible();
  await panel.getByRole('tab', { name: 'Schedules' }).click();
  await expect(panel.getByTestId('query-error')).toHaveCount(0);
  await expect(panel.locator('[data-slot="schedule-row"]')).toContainText('Nightly release checks');
});

const PROJECT_SCHEDULES = '/app?project=proj-1&chat=1&pane=tasks';

async function openProjectSchedules(page: Page) {
  await page.goto(PROJECT_SCHEDULES);
  await panel(page).getByRole('tab', { name: 'Schedules' }).click();
}

async function openGlobalSchedules(page: Page) {
  await page.goto('/app?pane=tasks');
  await panel(page).getByRole('tab', { name: 'Schedules' }).click();
}

for (const surface of ['global', 'project'] as const) {
  const reach = (page: Page) => (surface === 'global' ? openGlobalSchedules(page) : openProjectSchedules(page));
  test(`${surface} summary uses the saved timezone across midnight`, async ({ page }) => {
    const at = Date.UTC(2026, 10, 5, 6, 15);
    await setup(page, { at, nextRunAt: at, tz: 'America/New_York' });
    await page.clock.setFixedTime(Date.UTC(2026, 10, 5, 4, 30));
    await reach(page);
    await expect(scheduleRow(page)).toContainText('Daily at 01:15 · Next Nov 5 01:15');
    await expect(scheduleRow(page)).not.toContainText('Next today');
  });
  test(`${surface} summary preserves missing-next data through its actual consumer`, async ({ page }) => {
    await setup(page, { kind: 'once', nextRunAt: null });
    await reach(page);
    await expandEnded(page);
    await expect(scheduleRow(page)).toContainText('Ran');
    await expect(scheduleRow(page)).not.toContainText('Jan 1');
  });
}

test('a rejected save keeps the editor and its input for retry', async ({ page }) => {
  const probe = await setup(page);
  await open(page);
  await editor(page).getByRole('textbox', { name: 'Saved prompt' }).fill('Keep this draft');
  probe.rejectNext();
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor(page).getByRole('alert')).toContainText('Schedule update failed');
  await scheduleShot(page, 'schedule-editor-error.png');
  await expect(editor(page).getByRole('textbox', { name: 'Saved prompt' })).toHaveValue('Keep this draft');
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor(page)).toBeHidden();
  expect(probe.calls.at(-1)?.body).toMatchObject({ prompt: 'Keep this draft' });
});

test('Weekdays and custom cron send the actual discriminated API body', async ({ page }) => {
  const probe = await setup(page);
  await open(page);
  await editor(page).getByRole('radio', { name: 'Weekdays', exact: true }).click();
  await scheduleShot(page, 'schedule-editor-weekdays.png');
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor(page)).toBeHidden();
  expect(probe.calls.at(-1)?.body).toMatchObject({ kind: 'cron', cron: '0 9 * * 1-5', prompt: INITIAL.prompt, enabled: true });
  await scheduleRow(page).click();
  await editor(page).getByRole('radio', { name: 'Custom', exact: true }).click();
  const expression = editor(page).getByRole('textbox', { name: 'Cron expression' });
  await expression.fill('* *');
  await expect(expression).toHaveAttribute('aria-invalid', 'true');
  await expect(editor(page).getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(editor(page).getByText('Fix the cron expression', { exact: true })).toBeVisible();
  await expression.fill('*/20 8-17 * * MON-FRI');
  await expect(expression).toHaveAttribute('aria-invalid', 'false');
  await expect(editor(page).getByText('Fix the cron expression', { exact: true })).toHaveCount(0);
  await scheduleShot(page, 'schedule-editor-custom-cron.png');
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor(page)).toBeHidden();
  expect(probe.calls.at(-1)?.body).toMatchObject({ kind: 'cron', cron: '*/20 8-17 * * MON-FRI' });
});

test('auto-disabled records do not invent an upcoming epoch time', async ({ page }) => {
  await setup(page, { enabled: false, nextRunAt: null, pausedReason: 'Host machine removed' });
  await visit(page);
  await expect(scheduleRow(page)).toContainText('Host machine removed');
  await scheduleRow(page).click();
  await expect(editor(page).getByTestId('schedule-popover-runs')).toContainText('No upcoming run');
  await expect(editor(page)).toContainText('Host machine removed');
  await scheduleShot(page, 'schedule-editor-auto-disabled.png');
  await expect(editor(page)).not.toContainText('1970');
});

test('a finished one-time schedule shows its last run and offers no pause or resume', async ({ page }) => {
  await setup(page, { kind: 'once', nextRunAt: null });
  await open(page, true);
  await expect(editor(page).getByTestId('schedule-popover-runs')).toContainText('No upcoming run');
  await expect(editor(page).getByTestId('schedule-popover-runs')).toContainText('Succeeded');
  await scheduleShot(page, 'schedule-editor-finished-once.png');
  await page.keyboard.press('Escape');
  const items = (await menu(page)).getByRole('menuitem');
  await expect(items).toHaveText([/Run now/, /Edit/, /Delete/]);
});

test('the project schedule row opens the editor before opening its thread', async ({ page }) => {
  await setup(page);
  await openProjectSchedules(page);
  await scheduleRow(page).click();
  await expect(editor(page)).toBeVisible();
  await expect(page).not.toHaveURL(/thread=/);
});

test('Delete requires confirmation and a rejected deletion can be retried', async ({ page }) => {
  const probe = await setup(page);
  await visit(page);
  await (await menu(page)).getByRole('menuitem', { name: /Delete/ }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  expect(probe.calls).toHaveLength(0);
  probe.rejectNext();
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Could not delete the schedule. Try again.')).toBeVisible();
  await expect(scheduleRow(page)).toBeVisible();
  await (await menu(page)).getByRole('menuitem', { name: /Delete/ }).click();
  probe.show(false);
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(scheduleRow(page)).toHaveCount(0);
  expect(probe.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
    'DELETE /api/schedules/schedule-1',
    'DELETE /api/schedules/schedule-1',
  ]);
});

test('Escape returns keyboard focus to the schedule row', async ({ page }) => {
  await setup(page);
  await visit(page);
  const trigger = scheduleRow(page);
  await trigger.focus();
  await trigger.press('Enter');
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor(page)).toBeHidden();
  await expect(trigger).toBeFocused();
});

for (const theme of ['light', 'dark'] as const) {
 for (const width of [390, 1440]) {
  test(`the editor is accessible at ${width}px (${theme})`, async ({ page }) => {
    await setup(page);
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 844 });
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await settleTransitions(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    const { violations } = await new AxeBuilder({ page }).include('[data-testid="schedule-popover"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
    await scheduleShot(page, `schedule-editor-${width}-${theme}.png`, theme);
  });
}
}

test('a completed once row with enabled false cannot be resumed', async ({ page }) => {
  const probe = await setup(page, { kind: 'once', nextRunAt: null, enabled: false, pausedReason: null });
  await visit(page, true);
  const items = (await menu(page)).getByRole('menuitem');
  await expect(items).toHaveText([/Run now/, /Edit/, /Delete/]);
  await expect(items.filter({ hasText: /Run now/ })).toBeDisabled();
  expect(probe.calls).toHaveLength(0);
});

test('a saved seven-minute anchor stays visible and survives Save unchanged', async ({ page }) => {
  const at = Date.UTC(2026, 10, 4, 1, 7);
  const probe = await setup(page, { at, cron: '7 9 * * *' });
  await open(page);
  await expect(editor(page).getByRole('combobox', { name: 'Minute', exact: true }).locator('[data-slot="select-value"]')).toHaveText('07');
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor(page)).toBeHidden();
  expect(probe.calls.at(-1)?.body).toMatchObject({ kind: 'daily', at });
});

test('schedule loading and failed loads never masquerade as an empty list', async ({ page }) => {
  const probe = await setup(page);
  probe.holdLoads();
  await page.goto(SCHEDULES);
  await expect(panel(page).getByTestId('query-loading')).toContainText('Loading schedules');
  await expect(panel(page).getByTestId('tasks-schedules-empty')).toHaveCount(0);
  probe.rejectLoads(true);
  probe.releaseLoads();
  await expect(panel(page).getByTestId('query-error')).toContainText('Schedules could not be loaded');
  await expect(panel(page).getByTestId('tasks-schedules-empty')).toHaveCount(0);
  probe.rejectLoads(false);
  await panel(page).getByTestId('query-error').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(panel(page).locator('[data-slot="schedule-row"]')).toHaveCount(1);
});

test('ended one-time schedules fold into a collapsed 已结束 group with plain reasons', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'zh'));
  const once = { ...INITIAL, kind: 'once', cron: null, enabled: false, nextRunAt: null, lastRunStatus: 'failed' };
  const rows = [
    INITIAL,
    { ...once, id: 'archived', todoId: 'todo-2', pausedReason: 'Task archived', todo: { ...INITIAL.todo, title: 'Stop retry storms' } },
    { ...once, id: 'commit', todoId: 'todo-3', pausedReason: 'git commit failed (1): pnpm-lock.yaml is staged with external dependency changes.', todo: { ...INITIAL.todo, title: '审核登录变更' } },
  ];
  await mockLive(page, { threads: [], messages: [], todos: [{ ...TASK, phase: 'done' }], projects: [PROJECT] }, (path, route, json) =>
    path.startsWith('/api/schedules') && route.request().method() === 'GET' ? json(rows) : undefined,
  );
  await page.goto(SCHEDULES);
  const ended = page.getByTestId('schedules-ended');
  const header = ended.getByRole('button', { name: /已结束/ });
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(header).toContainText('2');
  await expect(scheduleRow(page)).toBeVisible();
  await expect(page.getByText('Stop retry storms')).toHaveCount(0);
  await header.click();
  await expect(ended.getByText('任务已归档，定时随之停用')).toBeVisible();
  const commit = ended.getByText('提交代码时被仓库检查拦下，这一轮没能完成');
  await expect(commit).toBeVisible();
  await expect(commit).toHaveAttribute('title', /^git commit failed/);
  await expect(page.locator('[data-slot="schedule-row"]').first()).toContainText('Nightly release checks');
  await expect(page.getByText(/Task archived/)).toHaveCount(0);
});

test.describe('on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the six frequency options stay inside their track above the next field and the title keeps its line', async ({ page }) => {
    await setup(page);
    await open(page);
    await editor(page).getByRole('radio', { name: 'Custom', exact: true }).click();
    const title = await editor(page).getByRole('heading', { name: 'Nightly release checks' }).boundingBox();
    expect(title?.height ?? 0).toBeGreaterThanOrEqual(16);
    const track = await editor(page).getByRole('radiogroup').boundingBox();
    const custom = await editor(page).getByRole('radio', { name: 'Custom', exact: true }).boundingBox();
    const label = await editor(page).getByText('Cron expression', { exact: true }).boundingBox();
    expect(track && custom && label).toBeTruthy();
    if (!track || !custom || !label) return;
    expect(custom.y + custom.height).toBeLessThanOrEqual(track.y + track.height + 0.5);
    expect(track.y + track.height).toBeLessThanOrEqual(label.y);
  });
});
