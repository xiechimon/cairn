import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, TASK, TEAM } from './chief-home-mock.js';
import { evidenceShot } from './evidence.js';

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
  await mockLive(page, { threads: [], messages: [], todos: [{ ...TASK, phase: 'done' }], projects: [PROJECT] }, (path, route, json) => {
    if (!path.startsWith('/api/schedules')) return undefined;
    const request = route.request();
    if (request.method() === 'GET') return (async () => {
      if (loadGate !== null) await loadGate;
      return failLoads ? json({ error: 'Schedule load failed' }, 500) : json(visible ? [schedule] : []);
    })();
    calls.push({ method: request.method(), path, body: request.method() === 'DELETE' ? null : request.postDataJSON() });
    if (failNext) { failNext = false; return json({ error: 'Schedule update failed' }, 409); }
    if (request.method() === 'PATCH') schedule = { ...schedule, ...request.postDataJSON(), nextRunAt: request.postDataJSON().enabled ? NOW + 3_600_000 : null };
    else if (path.endsWith('/run')) schedule = { ...schedule, nextRunAt: NOW };
    else if (request.method() === 'POST') schedule = { ...schedule, ...request.postDataJSON(), id: 'schedule-2' };
    return json(schedule);
  });
  return {
    calls,
    rejectNext: () => { failNext = true; },
    show: (next: boolean) => { visible = next; },
    rejectLoads: (next: boolean) => { failLoads = next; },
    holdLoads: () => { loadGate = new Promise<void>((resolve) => { releaseLoad = resolve; }); },
    releaseLoads: () => { loadGate = null; releaseLoad?.(); releaseLoad = null; },
  };
}

const detail = (page: Page) => page.getByRole('dialog', { name: 'Nightly release checks', exact: true });
async function open(page: Page) {
  await page.goto('/app/schedules');
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
  await evidenceShot(page, 'schedule-detail-desktop.png');
  await expect(dialog).toContainText('Runs on the hour may start a few minutes late.');
  await dialog.getByRole('link', { name: 'Open thread', exact: true }).click();
  await expect(page).toHaveURL(/thread=todo-1/);
});

test('pause and resume wait for API state, and Run now cannot fire while paused', async ({ page }) => {
  const probe = await setup(page);
  await open(page);
  await detail(page).getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(detail(page).getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(detail(page).getByRole('button', { name: 'Run now', exact: true })).toBeDisabled();
  await evidenceShot(page, 'schedule-detail-paused.png');
  await detail(page).getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(detail(page).getByRole('button', { name: 'Run now', exact: true })).toBeEnabled();
  expect(probe.calls.map((call) => call.body)).toEqual([{ enabled: false }, { enabled: true }]);
});

test('Run now schedules the actual run endpoint and reports queued status', async ({ page }) => {
  const probe = await setup(page);
  await open(page);
  await detail(page).getByRole('button', { name: 'Run now', exact: true }).click();
  await expect(detail(page)).toContainText('Queued for the next scheduler tick');
  expect(probe.calls).toContainEqual({ method: 'POST', path: '/api/schedules/schedule-1/run', body: {} });
});

test('a rejected mutation preserves the dialog and saved input for retry', async ({ page }) => {
  const probe = await setup(page);
  await open(page);
  await detail(page).getByRole('textbox', { name: 'Saved prompt' }).fill('Keep this draft');
  probe.rejectNext();
  await detail(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(detail(page).getByRole('alert')).toContainText('Schedule update failed');
  await evidenceShot(page, 'schedule-detail-error.png');
  await expect(detail(page).getByRole('textbox', { name: 'Saved prompt' })).toHaveValue('Keep this draft');
  await detail(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(detail(page)).toBeHidden();
});

test('Weekdays and custom cron send the actual discriminated API body', async ({ page }) => {
  const probe = await setup(page);
  await open(page);
  await detail(page).getByRole('radio', { name: 'Weekdays', exact: true }).click();
  await detail(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(detail(page)).toBeHidden();
  expect(probe.calls.at(-1)?.body).toMatchObject({ kind: 'cron', cron: '0 9 * * 1-5', prompt: INITIAL.prompt, enabled: true });
  await page.getByRole('button', { name: 'Open schedule Nightly release checks', exact: true }).click();
  await detail(page).getByRole('radio', { name: 'Custom cron', exact: true }).click();
  const expression = detail(page).getByRole('textbox', { name: 'Cron expression' });
  await expression.fill('* *');
  await expect(detail(page).getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expression.fill('*/20 8-17 * * MON-FRI');
  await detail(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(detail(page)).toBeHidden();
  expect(probe.calls.at(-1)?.body).toMatchObject({ kind: 'cron', cron: '*/20 8-17 * * MON-FRI' });
});

test('auto-disabled records do not invent an upcoming epoch time', async ({ page }) => {
  await setup(page, { enabled: false, nextRunAt: null, pausedReason: 'Host machine removed' });
  await open(page);
  await expect(detail(page)).toContainText('Auto-disabled');
  await expect(detail(page)).toContainText('Host machine removed');
  await evidenceShot(page, 'schedule-detail-auto-disabled.png');
  await expect(detail(page)).not.toContainText('1970');
});

test('a finished one-time schedule shows its last run and no pause control', async ({ page }) => {
  await setup(page, { kind: 'once', nextRunAt: null });
  await open(page);
  await expect(detail(page)).toContainText('Finished one-time schedule');
  await expect(detail(page)).toContainText('No upcoming runs');
  await evidenceShot(page, 'schedule-detail-finished-once.png');
  await expect(detail(page).getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
});

test('the project scheduled-task row opens details before opening its thread', async ({ page }) => {
  await setup(page);
  await page.goto('/app?project=proj-1');
  await page.locator('[data-slot="scheduled-task-row"]', { hasText: 'Nightly release checks' }).click();
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    const { violations } = await new AxeBuilder({ page }).include('[data-testid="schedule-detail-body"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
    await evidenceShot(page, `schedule-detail-${width}-${theme}.png`);
  });
}
}


test('a completed once row with enabled false does not offer Resume', async ({ page }) => {
  await setup(page, { kind: 'once', nextRunAt: null, enabled: false, pausedReason: null });
  await open(page);
  await expect(detail(page)).toContainText('Finished one-time schedule');
  await expect(detail(page)).toContainText('No upcoming runs');
  await expect(detail(page).getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0);
});

test('a saved seven-minute anchor stays visible and survives Save unchanged', async ({ page }) => {
  const at = Date.UTC(2026, 10, 4, 1, 7);
  const probe = await setup(page, { at, cron: '7 9 * * *' });
  await open(page);
  await expect(detail(page).getByRole('combobox', { name: 'Minute', exact: true })).toHaveText('07');
  await detail(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(detail(page)).toBeHidden();
  expect(probe.calls.at(-1)?.body).toMatchObject({ kind: 'daily', at });
});

test('an empty cached schedule list followed by network failure reports an error, not deletion', async ({ page }) => {
  const probe = await setup(page);
  await open(page);
  const invalidate = (seq: number) => page.evaluate(({ todo, sequence }) => {
    const stream = window.__es.find((entry) => entry.url.includes('/api/teams/t1/stream'));
    if (stream === undefined) throw new Error('Team stream is not connected');
    stream.emit({ type: 'todo', seq: sequence, v: 1, doc: todo });
  }, { todo: { ...TASK, phase: 'done' }, sequence: seq });
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
  await expect(page.getByTestId('schedules-error')).toContainText('Scheduled tasks could not be loaded.');
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
