import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, TASK, TEAM } from './chief-home-mock.js';
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

const detail = (page: Page) => page.getByRole('dialog', { name: 'Nightly release checks', exact: true });
async function scheduleShot(page: Page, name: string, theme: 'light' | 'dark' = 'light') {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await settleTransitions(page);
  await evidencePanelShot(page, name, detail(page));
}
async function expandEnded(page: Page) {
  await page.getByTestId('schedules-ended').getByRole('button', { name: /Ended/ }).click();
}
async function open(page: Page, ended = false) {
  await page.goto('/app/schedules');
  if (ended) await expandEnded(page);
  await page.getByRole('button', { name: 'Open schedule Nightly release checks', exact: true }).click();
  await expect(detail(page)).toBeVisible();
}

test('opens the approved detail dialog with cadence, nullable next run, saved prompt and thread link', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = detail(page);
  await expect(dialog).toContainText('Asia/Shanghai');
  await expect(dialog).toContainText('Last run');
  await expect(dialog.getByRole('textbox', { name: 'Saved prompt' })).toHaveValue(INITIAL.prompt);
  await scheduleShot(page, 'schedule-detail-desktop.png');
  await expect(dialog).toContainText('Runs on the hour may start a few minutes late.');
  await dialog.getByRole('link', { name: 'Open thread', exact: true }).click();
  await expect(page).toHaveURL(/thread=todo-1/);
});

test('pause and resume wait for API state, and Run now cannot fire while paused', async ({ page }) => {
  const probe = await setup(page);
  await open(page);
  const active = detail(page).getByRole('switch');
  await expect(active).toHaveAccessibleName('Active');
  await expect(active).toBeChecked();
  await active.click();
  await expect(active).not.toBeChecked();
  await expect(active).toHaveAccessibleName('Paused');
  await expect(detail(page).getByRole('button', { name: 'Run now', exact: true })).toBeDisabled();
  await scheduleShot(page, 'schedule-detail-paused.png');
  await active.click();
  await expect(active).toBeChecked();
  await expect(active).toHaveAccessibleName('Active');
  await expect(detail(page).getByRole('button', { name: 'Run now', exact: true })).toBeEnabled();
  expect(probe.calls.map((call) => call.body)).toEqual([{ enabled: false }, { enabled: true }]);
});

for (const enabled of [true, false]) {
  test(`a rejected ${enabled ? 'pause' : 'resume'} switch keeps its saved checked state and can be retried`, async ({ page }) => {
    const probe = await setup(page, { enabled, nextRunAt: enabled ? INITIAL.nextRunAt : null });
    await open(page);
    const active = detail(page).getByRole('switch');
    probe.rejectNext();
    await active.click();
    await expect(detail(page).getByRole('alert')).toContainText('Schedule update failed');
    await expect(active).toBeChecked({ checked: enabled });
    await active.click();
    await expect(active).toBeChecked({ checked: !enabled });
    expect(probe.calls.map((call) => call.body)).toEqual([{ enabled: !enabled }, { enabled: !enabled }]);
  });
}

test('a pending switch change disables competing actions and sends one mutation', async ({ page }) => {
  const probe = await setup(page);
  await open(page);
  probe.holdChanges();
  const active = detail(page).getByRole('switch');
  await active.click();
  await expect.poll(() => probe.calls.length).toBe(1);
  await expect(active).toBeDisabled();
  await expect(active).toBeChecked();
  await active.evaluate((element) => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  for (const name of ['Save', 'Run now', 'Delete']) await expect(detail(page).getByRole('button', { name, exact: true })).toBeDisabled();
  expect(probe.calls).toHaveLength(1);
  probe.releaseChanges();
  await expect(active).not.toBeChecked();
  await expect(active).toBeEnabled();
  expect(probe.calls).toHaveLength(1);
});

test('auto-disabled Re-enable preserves the reason on failure and clears it only after saved recovery', async ({ page }) => {
  const probe = await setup(page, { enabled: false, nextRunAt: null, pausedReason: 'Task archived' });
  await open(page);
  await expect(detail(page).getByRole('switch')).toHaveCount(0);
  const enable = detail(page).getByRole('button', { name: 'Re-enable', exact: true });
  probe.rejectNext();
  await enable.click();
  await expect(detail(page).getByRole('alert')).toContainText('Schedule update failed');
  await expect(detail(page)).toContainText('The task was archived, so the schedule stopped');
  probe.holdChanges();
  await enable.click();
  await expect(enable).toBeDisabled();
  await expect(detail(page)).toContainText('The task was archived, so the schedule stopped');
  await enable.evaluate((element) => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(probe.calls).toHaveLength(2);
  probe.releaseChanges();
  await expect(detail(page)).not.toContainText('The task was archived, so the schedule stopped');
  await expect(detail(page).getByRole('switch')).toBeChecked();
  await expect(enable).toHaveCount(0);
  expect(probe.calls.map((call) => call.body)).toEqual([{ enabled: true }, { enabled: true }]);
});

test('Run now schedules the actual run endpoint and reports queued status', async ({ page }) => {
  const probe = await setup(page);
  await open(page);
  await detail(page).getByRole('button', { name: 'Run now', exact: true }).click();
  await expect(detail(page)).toContainText('Run queued');
  await scheduleShot(page, 'schedule-detail-run-queued.png');
  expect(probe.calls).toContainEqual({ method: 'POST', path: '/api/schedules/schedule-1/run', body: {} });
});

test('the Tasks panel lists schedules in the Schedules tab only, and a row menu opens the schedules page', async ({ page }) => {
  await setup(page, { kind: 'once', nextRunAt: null });
  await page.goto('/app?pane=tasks');
  const panel = page.getByRole('complementary', { name: 'Tasks', exact: true });
  await expect(panel.locator('[data-slot="schedule-row"]')).toHaveCount(0);
  await panel.getByRole('tab', { name: 'Schedules' }).click();
  await expect(panel.locator('[data-slot="schedule-row"]')).toContainText('Nightly release checks');
  await expect(panel).not.toContainText('Manage schedules');
  const frame = panel.locator('[data-slot="schedule-row-frame"]').first();
  await frame.hover();
  await frame.getByTestId('schedule-row-menu-button').click();
  await page.getByRole('menuitem', { name: /Manage schedules/ }).click();
  await expect(page).toHaveURL(/\/app\/schedules$/);
});

test('the Schedules tab lists schedules while the tasks request has failed', async ({ page }) => {
  await setup(page, { kind: 'once', nextRunAt: null });
  await page.route('**/api/tasks?*', (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.goto('/app?pane=tasks');
  const panel = page.getByRole('complementary', { name: 'Tasks', exact: true });
  await expect(panel.getByTestId('query-error')).toBeVisible();
  await panel.getByRole('tab', { name: 'Schedules' }).click();
  await expect(panel.getByTestId('query-error')).toHaveCount(0);
  await expect(panel.locator('[data-slot="schedule-row"]')).toContainText('Nightly release checks');
});

const PROJECT_SCHEDULES = '/app?project=proj-1&chat=1&pane=tasks';
const projectSchedulesPanel = (page: Page) => page.getByRole('complementary', { name: 'Tasks', exact: true });
const projectScheduleRow = (page: Page) =>
  page.locator('[data-slot="schedule-row"]', { hasText: 'Nightly release checks' });

async function openProjectSchedules(page: Page) {
  await page.goto(PROJECT_SCHEDULES);
  await projectSchedulesPanel(page).getByRole('tab', { name: 'Schedules' }).click();
}

for (const surface of ['global', 'project'] as const) {
  const visit = (page: Page) => (surface === 'global' ? page.goto('/app/schedules') : openProjectSchedules(page));
  const summary = (page: Page) => surface === 'global'
    ? page.locator('.sched-card')
    : projectScheduleRow(page);
  test(`${surface} summary uses the saved timezone across midnight`, async ({ page }) => {
    const at = Date.UTC(2026, 10, 5, 6, 15);
    await setup(page, { at, nextRunAt: at, tz: 'America/New_York' });
    await page.clock.setFixedTime(Date.UTC(2026, 10, 5, 4, 30));
    await visit(page);
    await expect(summary(page)).toContainText('Daily at 01:15 · Next Nov 5 01:15');
    await expect(summary(page)).not.toContainText('Next today');
  });
  test(`${surface} summary preserves missing-next data through its actual consumer`, async ({ page }) => {
    await setup(page, { kind: 'once', nextRunAt: null });
    await visit(page);
    if (surface === 'global') await expandEnded(page);
    await expect(summary(page)).toContainText('No upcoming runs');
    await expect(summary(page)).not.toContainText('Jan 1');
  });
}

test('a rejected mutation preserves the dialog and saved input for retry', async ({ page }) => {
  const probe = await setup(page);
  await open(page);
  await detail(page).getByRole('textbox', { name: 'Saved prompt' }).fill('Keep this draft');
  probe.rejectNext();
  await detail(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(detail(page).getByRole('alert')).toContainText('Schedule update failed');
  await scheduleShot(page, 'schedule-detail-error.png');
  await expect(detail(page).getByRole('textbox', { name: 'Saved prompt' })).toHaveValue('Keep this draft');
  await detail(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(detail(page)).toBeHidden();
});

test('Weekdays and custom cron send the actual discriminated API body', async ({ page }) => {
  const probe = await setup(page);
  await open(page);
  await detail(page).getByRole('radio', { name: 'Weekdays', exact: true }).click();
  await scheduleShot(page, 'schedule-detail-weekdays.png');
  await detail(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(detail(page)).toBeHidden();
  expect(probe.calls.at(-1)?.body).toMatchObject({ kind: 'cron', cron: '0 9 * * 1-5', prompt: INITIAL.prompt, enabled: true });
  await page.getByRole('button', { name: 'Open schedule Nightly release checks', exact: true }).click();
  await detail(page).getByRole('radio', { name: 'Custom cron', exact: true }).click();
  const expression = detail(page).getByRole('textbox', { name: 'Cron expression' });
  await expression.fill('* *');
  await expect(detail(page).getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expression.fill('*/20 8-17 * * MON-FRI');
  await scheduleShot(page, 'schedule-detail-custom-cron.png');
  await detail(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(detail(page)).toBeHidden();
  expect(probe.calls.at(-1)?.body).toMatchObject({ kind: 'cron', cron: '*/20 8-17 * * MON-FRI' });
});

test('auto-disabled records do not invent an upcoming epoch time', async ({ page }) => {
  await setup(page, { enabled: false, nextRunAt: null, pausedReason: 'Host machine removed' });
  await open(page);
  await expect(detail(page)).toContainText('Auto-disabled');
  await expect(detail(page)).toContainText('Host machine removed');
  await scheduleShot(page, 'schedule-detail-auto-disabled.png');
  await expect(detail(page)).not.toContainText('1970');
  await detail(page).getByRole('button', { name: 'Delete', exact: true }).scrollIntoViewIfNeeded();
  await scheduleShot(page, 'schedule-detail-auto-disabled-actions.png');
});

test('a finished one-time schedule shows its last run and no pause control', async ({ page }) => {
  await setup(page, { kind: 'once', nextRunAt: null });
  await open(page, true);
  await expect(detail(page)).toContainText('Finished one-time schedule');
  await expect(detail(page)).toContainText('No upcoming runs');
  await scheduleShot(page, 'schedule-detail-finished-once.png');
  await expect(detail(page).getByRole('switch')).toBeDisabled();
  await expect(detail(page).getByRole('button', { name: 'Re-enable', exact: true })).toHaveCount(0);
  await detail(page).getByRole('switch').scrollIntoViewIfNeeded();
  await scheduleShot(page, 'schedule-detail-finished-once-actions.png');
});

test('the project schedule row opens details before opening its thread', async ({ page }) => {
  await setup(page);
  await openProjectSchedules(page);
  await projectScheduleRow(page).click();
  await expect(detail(page)).toBeVisible();
  await expect(page).not.toHaveURL(/thread=/);
});

test('Delete requires confirmation and a rejected deletion remains retryable', async ({ page }) => {
  const probe = await setup(page);
  await open(page);
  await detail(page).getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  expect(probe.calls).toHaveLength(0);
  probe.rejectNext();
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirm.getByRole('alert')).toContainText('Schedule update failed');
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(detail(page)).toBeHidden();
});

test('Escape returns keyboard focus to the schedule row', async ({ page }) => {
  await setup(page);
  await page.goto('/app/schedules');
  const trigger = page.getByRole('button', { name: 'Open schedule Nightly release checks', exact: true });
  await trigger.focus();
  await trigger.press('Enter');
  await expect(detail(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail(page)).toBeHidden();
  await expect(trigger).toBeFocused();
});

for (const theme of ['light', 'dark'] as const) {
 for (const width of [390, 1440]) {
  test(`detail is accessible at ${width}px (${theme})`, async ({ page }) => {
    await setup(page);
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 844 });
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await settleTransitions(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    const { violations } = await new AxeBuilder({ page }).include('[data-testid="schedule-detail-body"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
    await scheduleShot(page, `schedule-detail-${width}-${theme}.png`, theme);
  });
}
}


test('a completed once row with enabled false cannot be resumed', async ({ page }) => {
  const probe = await setup(page, { kind: 'once', nextRunAt: null, enabled: false, pausedReason: null });
  await open(page, true);
  await expect(detail(page)).toContainText('Finished one-time schedule');
  await expect(detail(page)).toContainText('No upcoming runs');
  const active = detail(page).getByRole('switch');
  await expect(active).toBeDisabled();
  await expect(active).toHaveAccessibleName('Finished one-time schedule');
  await expect(active).not.toBeChecked();
  await active.evaluate((element) => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await expect(detail(page).getByRole('button', { name: 'Re-enable', exact: true })).toHaveCount(0);
  expect(probe.calls).toHaveLength(0);
});

test('a saved seven-minute anchor stays visible and survives Save unchanged', async ({ page }) => {
  const at = Date.UTC(2026, 10, 4, 1, 7);
  const probe = await setup(page, { at, cron: '7 9 * * *' });
  await open(page);
  await expect(detail(page).getByRole('combobox', { name: 'Minute', exact: true }).locator('[data-slot="select-value"]')).toHaveText('07');
  await detail(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(detail(page)).toBeHidden();
  expect(probe.calls.at(-1)?.body).toMatchObject({ kind: 'daily', at });
});

test('an empty cached schedule list followed by network failure reports an error, not deletion', async ({ page }) => {
  const probe = await setup(page);
  await open(page);
  const invalidate = async (seq: number) => {
    await page.waitForFunction(() =>
      window.__es.some((entry) => entry.url.includes('/api/teams/t1/stream')),
    );
    await page.evaluate(({ todo, sequence }) => {
      const stream = window.__es.find((entry) => entry.url.includes('/api/teams/t1/stream'));
      if (stream === undefined) throw new Error('Team stream is not connected');
      stream.emit({ type: 'todo', seq: sequence, v: 1, doc: todo });
    }, { todo: { ...TASK, phase: 'done' }, sequence: seq });
  };
  probe.show(false);
  await invalidate(50);
  await expect(detail(page)).toContainText('This scheduled task is no longer available.');
  probe.rejectLoads(true);
  await invalidate(51);
  await expect(detail(page)).toContainText('The scheduled task could not be loaded.');
  await expect(detail(page)).not.toContainText('This scheduled task is no longer available.');
  probe.show(true);
  probe.rejectLoads(false);
  probe.holdLoads();
  const retry = detail(page).getByRole('button', { name: 'Retry', exact: true });
  await retry.click();
  await expect(retry).toBeDisabled();
  probe.releaseLoads();
  await expect(detail(page).getByRole('textbox', { name: 'Saved prompt' })).toHaveValue(INITIAL.prompt);
});

test('schedule loading and failed loads never masquerade as an empty list', async ({ page }) => {
  const probe = await setup(page);
  probe.holdLoads();
  await page.goto('/app/schedules');
  await expect(page.getByTestId('schedules-loading')).toContainText('Loading scheduled tasks…');
  await expect(page.getByText('No schedules yet', { exact: true })).toHaveCount(0);
  probe.rejectLoads(true);
  probe.releaseLoads();
  await expect(page.getByTestId('schedules-error')).toContainText('Scheduled tasks could not be loaded');
  await expect(page.getByText('No schedules yet', { exact: true })).toHaveCount(0);
  probe.rejectLoads(false);
  await page.getByTestId('schedules-error').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.sched-card')).toHaveCount(1);
});

test('new schedule retries teams before enabling dependent thread and project queries', async ({ page }) => {
  await setup(page);
  let rejectTeams = true;
  const dependencies: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/todos' || url.pathname === '/api/projects') dependencies.push(url.search);
  });
  await page.route('**/api/teams', (route) => route.fulfill({ status: rejectTeams ? 500 : 200, json: rejectTeams ? { error: 'Teams failed' } : [TEAM] }));
  await page.goto('/app/schedules');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New schedule', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('Schedule setup could not be loaded.');
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  expect(dependencies.some((search) => search.includes('undefined'))).toBe(false);
  expect(dependencies).toHaveLength(0);
  rejectTeams = false;
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  expect(dependencies.length).toBeGreaterThan(0);
  expect(dependencies.every((search) => search.includes('teamId=t1'))).toBe(true);
});

for (const resource of ['todos', 'projects'] as const) {
  test(`new schedule reports ${resource} setup failure and retries without losing a prompt`, async ({ page }) => {
    await setup(page);
    let reject = true;
    await page.route(`**/api/${resource}?*`, (route) => route.fulfill({ status: reject ? 500 : 200, json: reject ? { error: 'Setup failed' } : resource === 'todos' ? [{ ...TASK, phase: 'done' }] : [PROJECT] }));
    await page.goto('/app/schedules');
    await page.getByRole('button', { name: 'New', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New schedule', exact: true });
    await expect(dialog.getByRole('alert')).toContainText('Schedule setup could not be loaded.');
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Saved prompt' }).fill('Keep this setup draft');
    reject = false;
    await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('textbox', { name: 'Saved prompt' })).toHaveValue('Keep this setup draft');
  });
}

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
  await page.goto('/app/schedules');
  const ended = page.getByTestId('schedules-ended');
  const header = ended.getByRole('button', { name: /已结束/ });
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(header).toContainText('2');
  await expect(page.getByRole('button', { name: /Nightly release checks/ })).toBeVisible();
  await expect(page.getByText('Stop retry storms')).toHaveCount(0);
  await header.click();
  await expect(ended.getByText('任务已归档，定时随之停用 · cairn')).toBeVisible();
  const commit = ended.getByText('提交代码时被仓库检查拦下，这一轮没能完成 · cairn');
  await expect(commit).toBeVisible();
  await expect(commit).toHaveAttribute('title', /^git commit failed/);
  await expect(page.locator('.sched-card').first()).toContainText('Nightly release checks');
  await expect(page.getByText(/Task archived/)).toHaveCount(0);
});
