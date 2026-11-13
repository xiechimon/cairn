import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, TASK } from './chief-home-mock';
import { evidenceShot } from './evidence.js';

const ACTIVITY = '/app/activity?scenario=activity';

const groups = (page: Page) => page.getByTestId('activity-group');
const group = (page: Page, id: string) => page.locator(`[data-testid="activity-group"][data-group="${id}"]`);
const chips = (page: Page) => page.getByTestId('query-chip');
const rows = (page: Page) => page.locator('[data-slot="thread-row"]');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

test('threads are grouped by day with a count and the cost of each group', async ({ page }) => {
  await page.goto(ACTIVITY);
  await expect(groups(page)).toHaveCount(4);
  const totals = page.getByTestId('activity-group-total');
  await expect(totals).toHaveText([
    '3 threads · $2.23',
    '2 threads · $4.72',
    '1 thread · $2.47',
    '2 threads · —',
  ]);
  await expect(group(page, 'today').getByRole('heading')).toHaveText('Today');
  await expect(group(page, 'yesterday').getByRole('heading')).toHaveText('Yesterday');
  await expect(group(page, 'week').getByRole('heading')).toHaveText('Earlier this week');
  await expect(group(page, 'older').getByRole('heading')).toHaveText('Earlier');
  await expect(page.getByTestId('activity-summary')).toHaveText('8 threads · —');
});

test('a row shows its state, project, reason, cost and time; unpriced cost is a dash', async ({
  page,
}) => {
  await page.goto(ACTIVITY);
  const failed = rows(page).filter({ hasText: 'Fold finished turns in the transcript' });
  await expect(failed).toContainText('Failed');
  await expect(failed).toContainText('cairn');
  await expect(failed).toContainText('$1.84');
  await expect(failed).toContainText('30m ago');
  await expect(failed).toContainText('Failed. Open it to retry.');
  const unpriced = rows(page).filter({ hasText: 'Backfill usage rows' });
  await expect(unpriced.getByTestId('activity-row-cost')).toHaveText('—');
});

for (const scenario of [
  { name: 'all unknown', costs: [null, { total: 0, priced: false }], expected: '—', rowCosts: ['—', '—'] },
  { name: 'mixed known and partial positive wire cost', costs: [{ total: 2.5, priced: true }, { total: 1, priced: false }], expected: '—', rowCosts: ['$2.50', '—'] },
  { name: 'known free', costs: [{ total: 0, priced: true }, { total: 0, priced: true }], expected: '$0.00', rowCosts: ['$0.00', '$0.00'] },
  { name: 'all known', costs: [{ total: 2.5, priced: true }, { total: 1, priced: true }], expected: '$3.50', rowCosts: ['$2.50', '$1.00'] },
]) {
  test(`live cost totals preserve ${scenario.name} in both page and group`, async ({ page }) => {
    const now = Date.UTC(2026, 10, 4, 20);
    await page.clock.install({ time: now });
    await mockLive(page, {
      threads: [], messages: [],
      todos: scenario.costs.map((cost, i) => ({
        ...TASK, id: `cost-${i}`, phaseAt: now - i * 1000,
        ...(cost === null ? {} : { usageCost: { input: cost.total, output: 0, cacheRead: 0, cacheWrite: 0, ...cost } }),
      })),
    });
    await page.goto('/app/activity');
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByTestId('activity-summary')).toHaveText(`2 threads · ${scenario.expected}`);
    await expect(page.getByTestId('activity-group-total')).toHaveText(`2 threads · ${scenario.expected}`);
    await expect(page.getByTestId('activity-row-cost')).toHaveText(scenario.rowCosts);
  });
}

test('a quick filter adds its chip, narrows the list and toggles off again', async ({ page }) => {
  await page.goto(ACTIVITY);
  const failed = page.getByRole('button', { name: 'Failed', exact: true });
  await failed.click();
  await expect(failed).toHaveAttribute('aria-pressed', 'true');
  await expect(chips(page)).toHaveText(['is:failed']);
  await expect(rows(page)).toHaveCount(3);
  await expect(page).toHaveURL(/q=is%3Afailed/);
  await page.getByRole('button', { name: 'Over $1' }).click();
  await expect(chips(page)).toHaveText(['is:failed', 'cost:>1']);
  await expect(rows(page)).toHaveCount(2);
  await failed.click();
  await expect(failed).toHaveAttribute('aria-pressed', 'false');
  await expect(chips(page)).toHaveText(['cost:>1']);
  await expect(rows(page)).toHaveCount(3);
});

test('a link with q opens with the chips and results already applied', async ({ page }) => {
  await page.goto(`${ACTIVITY}&q=${encodeURIComponent('is:failed project:cairn ')}`);
  await expect(chips(page)).toHaveText(['is:failed', 'project:cairn']);
  await expect(rows(page)).toHaveCount(3);
});

test('Enter commits a closed quoted filter after words and leaves an open quote in the field', async ({
  page,
}) => {
  await page.goto(ACTIVITY);
  const field = page.getByRole('textbox', { name: 'Filter activity' });
  await field.fill('fold project:"my project');
  await field.press('Enter');
  await expect(chips(page)).toHaveCount(0);
  await expect(field).toHaveValue('fold project:"my project');
  await field.fill('fold project:"my project"');
  await field.press('Enter');
  await expect(chips(page)).toHaveText(['project:my project']);
  await expect(field).toHaveValue('fold ');
});

test('the palette can replace the filters while Activity is already open', async ({ page }) => {
  await page.goto(`${ACTIVITY}&q=is%3Afailed`);
  await expect(rows(page)).toHaveCount(3);
  await page.keyboard.press('Meta+k');
  const palette = page.getByRole('dialog', { name: 'Search' });
  await expect(palette).toBeVisible();
  await palette.getByRole('textbox', { name: 'Search' }).fill('is:running ');
  await palette.locator('[data-row-kind="activity"]').click();
  await expect(palette).toBeHidden();
  await expect(chips(page)).toHaveText(['is:running']);
  await expect(rows(page)).toHaveCount(1);
  await expect(page).toHaveURL(/q=is%3Arunning/);
});

test('an invalid filter is flagged and finds nothing, with a way out', async ({ page }) => {
  await page.goto(`${ACTIVITY}&q=${encodeURIComponent('cost:lots ')}`);
  await expect(page.locator('[data-testid="query-chip"][data-invalid]')).toHaveText(['cost:lots']);
  await expect(page.getByTestId('chip-problems')).toContainText('Use > or < with a number');
  const empty = page.getByTestId('activity-empty');
  await expect(empty).toContainText('No threads match all of these filters');
  await empty.getByRole('button', { name: 'Clear all filters' }).click();
  await expect(rows(page)).toHaveCount(8);
});

test('with no threads at all the page says so', async ({ page }) => {
  await page.goto('/app/activity?scenario=activity-empty');
  await expect(page.getByTestId('activity-empty')).toContainText('No activity yet');
  await evidenceShot(page, 'activity-empty.png');
});

test('Load more reveals the next page and then goes away', async ({ page }) => {
  await page.goto('/app/activity?scenario=activity-many');
  await expect(rows(page)).toHaveCount(25);
  await expect(page.getByTestId('activity-showing')).toHaveText('Showing 25 of 30');
  await page.getByTestId('activity-load-more').click();
  await expect(rows(page)).toHaveCount(30);
  await expect(page.getByTestId('activity-showing')).toHaveText('Showing 30 of 30');
  await expect(page.getByTestId('activity-load-more')).toHaveCount(0);
});

test('a row opens its thread and the sidebar Activity link opens the page', async ({ page }) => {
  await page.goto('/app?scenario=activity');
  await page.getByTestId('sidebar-activity').click();
  await expect(page).toHaveURL(/\/app\/activity/);
  await expect(groups(page).first()).toBeVisible();
  await rows(page).filter({ hasText: 'Trim the gallery frame' }).getByRole('button').click();
  await expect(page).toHaveURL(/thread=act-gallery/);
});

test('the footer keeps Activity and Settings next to the offline status', async ({ page }) => {
  await page.goto('/app?scenario=activity');
  const footer = page.getByTestId('sidebar-footer');
  await expect(footer.getByTestId('sidebar-settings')).toBeVisible();
  await expect(footer.getByTestId('sidebar-activity')).toBeVisible();
  await expect(page.getByTestId('sidebar-user-menu')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-attention')).toBeVisible();
});

test('the collapsed rail keeps Activity and Settings as direct links', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
  await page.goto('/app?scenario=activity');
  const activity = page.getByTestId('sidebar-activity');
  await activity.focus();
  await activity.press('Enter');
  await expect(page).toHaveURL(/\/app\/activity/);
  await page.getByTestId('sidebar-settings').click();
  await expect(page).toHaveURL(/\/app\/settings/);
});

test('the phone drawer Activity link opens the page and dismisses the sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app?scenario=activity');
  await page.getByTestId('narrow-menu').click();
  await page.getByTestId('sidebar-activity').click();
  await expect(page).toHaveURL(/\/app\/activity/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(groups(page).first()).toBeVisible();
});

test('a failed load shows an error with retry', async ({ page }) => {
  let failures = 2;
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path !== '/api/todos' || failures === 0) return undefined;
    failures -= 1;
    return json({ error: 'boom' }, 500);
  });
  await page.goto('/app/activity');
  const error = page.getByTestId('activity-error');
  await expect(error).toContainText('Activity did not load');
  await evidenceShot(page, 'activity-error.png');
  await error.getByRole('button', { name: 'Retry' }).click();
  await expect(groups(page).first()).toBeVisible();
});

test('live: a filtered query goes to the server and its rows are enriched with cost', async ({
  page,
}) => {
  const queries: string[] = [];
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path !== '/api/search') return undefined;
    queries.push(new URL(route.request().url()).searchParams.get('q') ?? '');
    return json({
      todos: [{ id: 'todo-1', seqNum: 9, title: 'x', phase: 'building', phaseAt: Date.now(), projectName: 'cairn' }],
      projects: [],
      agents: [],
      filters: [{ key: 'is', raw: 'is:running', value: 'running', negated: false, valid: true }],
    });
  });
  await page.goto('/app/activity?q=is%3Arunning%20');
  await expect(rows(page)).toHaveCount(1);
  expect(queries.at(-1)).toBe('is:running');
});

for (const theme of ['light', 'dark'] as const) {
  test(`the page has no axe violations (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(ACTIVITY);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(groups(page).first()).toBeVisible();
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
    await evidenceShot(page, `activity-${theme}.png`);
  });
}

test('at 390px nothing overflows sideways and rows stay readable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${ACTIVITY}&q=${encodeURIComponent('is:failed ')}`);
  await expect(rows(page).first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  const titleLeft = await page.getByRole('heading', { name: 'Activity', exact: true }).evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node.querySelector('span') ?? node);
    return range.getBoundingClientRect().left;
  });
  const menuBox = await page.locator('.app-menu-trigger').boundingBox();
  expect(titleLeft).toBeGreaterThanOrEqual((menuBox?.x ?? 0) + (menuBox?.width ?? 0));
  await expect(rows(page).first().getByTestId('activity-row-cost')).toBeVisible();
  await evidenceShot(page, 'activity-phone.png');
});

test.describe('viewer-local calendar groups', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('a prior local date is Yesterday even when UTC+8 considers it today', async ({ page }) => {
    await page.clock.install({ time: Date.UTC(2026, 10, 2, 8, 30) });
    await mockLive(page, {
      threads: [], messages: [],
      todos: [{ ...TASK, phase: 'done', phaseAt: Date.UTC(2026, 10, 2, 7, 30) }],
    });
    await page.goto('/app/activity');
    await expect(groups(page)).toHaveCount(1);
    await expect(group(page, 'yesterday')).toContainText(TASK.title);
    await expect(group(page, 'today')).toHaveCount(0);
  });

  test('Monday does not label the previous Saturday as earlier this week', async ({ page }) => {
    await page.clock.install({ time: Date.UTC(2026, 10, 9, 20) });
    await mockLive(page, {
      threads: [], messages: [],
      todos: [{ ...TASK, phase: 'done', phaseAt: Date.UTC(2026, 10, 7, 20) }],
    });
    await page.goto('/app/activity');
    await expect(groups(page)).toHaveCount(1);
    await expect(group(page, 'older')).toContainText(TASK.title);
    await expect(group(page, 'week')).toHaveCount(0);
  });
});


test.describe('Activity dependency readiness', () => {
  test('pending projects do not render incomplete rows or a success summary', async ({ page }) => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let requested = false;
    await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
      if (path !== '/api/projects') return undefined;
      requested = true;
      return pending.then(() => json([{ id: 'proj-1', name: 'Loaded project' }]));
    });
    await page.goto('/app/activity');
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByRole('status')).toContainText('Loading activity');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByTestId('activity-summary')).toHaveCount(0);
    release?.();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Loaded project');
  });

  for (const prerequisite of ['pending', 'failed', 'empty'] as const) {
    test(`teams ${prerequisite} recover before queries for the new team ID`, async ({ page }) => {
      let recovered = false;
      let release: (() => void) | undefined;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      const requests: string[] = [];
      await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
        requests.push(route.request().url());
        if (path === '/api/teams') {
          if (recovered) return json([{ id: 'recovered-team', name: 'Recovered' }]);
          if (prerequisite === 'pending') return pending.then(() => json([{ id: 'recovered-team', name: 'Recovered' }]));
          return prerequisite === 'failed' ? json({ error: 'teams down' }, 500) : json([]);
        }
        if (path === '/api/teams/recovered-team/chief') return json({
          chief: { id: 'recovered-chief', userId: 'u1', teamId: 'recovered-team', agent: null, charter: null, lastTurnAt: null, createdAt: 0, tz: null },
          agentActor: null, context: null, watches: [], wakes: [],
        });
        if (path === '/api/todos') return json([{ ...TASK, teamId: 'recovered-team' }]);
        if (path === '/api/search') return json({ todos: [{ id: TASK.id }], projects: [], agents: [], filters: [] });
        return undefined;
      });
      await page.goto('/app/activity?q=is%3Arunning');
      if (prerequisite === 'pending') {
        await expect(page.getByRole('status')).toContainText('Loading activity');
      } else {
        await expect(page.getByTestId('activity-error')).toBeVisible();
      }
      expect(requests.filter((url) => /\/api\/(todos|projects|search)\?/.test(url))).toEqual([]);
      recovered = true;
      if (prerequisite === 'pending') release?.();
      else await page.getByTestId('activity-error').getByRole('button', { name: 'Retry' }).click();
      await expect(rows(page)).toHaveCount(1);
      expect(requests.some((url) => url.includes('/api/todos?teamId=recovered-team'))).toBe(true);
      expect(requests.some((url) => url.includes('/api/projects?teamId=recovered-team'))).toBe(true);
      expect(requests.some((url) => url.includes('undefined'))).toBe(false);
    });
  }

  for (const dependency of ['projects', 'todos', 'search'] as const) {
    test(`${dependency} failure is truthful and Retry refetches active dependencies`, async ({ page }) => {
      let failing = true;
      const requests: string[] = [];
      await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
        requests.push(path);
        if (path === `/api/${dependency}` && failing) return json({ error: 'down' }, 500);
        if (path === '/api/search') return json({ todos: [{ id: TASK.id }], projects: [], agents: [], filters: [] });
        return undefined;
      });
      await page.goto('/app/activity?q=is%3Arunning');
      await expect(page.getByTestId('activity-error')).toBeVisible();
      await expect(page.getByTestId('activity-summary')).toHaveCount(0);
      await expect(rows(page)).toHaveCount(0);
      failing = false;
      const before = requests.filter((path) => path === `/api/${dependency}`).length;
      await page.getByTestId('activity-error').getByRole('button', { name: 'Retry' }).click();
      await expect(rows(page)).toHaveCount(1);
      expect(requests.filter((path) => path === `/api/${dependency}`).length).toBeGreaterThan(before);
    });
  }
});

test.describe('idle Activity calendar clock', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('ordinary renders before midnight use the current wall clock for row ages', async ({ page }) => {
    const now = Date.UTC(2026, 10, 4, 20);
    await page.clock.install({ time: now });
    await mockLive(page, {
      threads: [], messages: [], todos: [{ ...TASK, phaseAt: now - 5 * 60_000 }],
    });
    await page.goto('/app/activity');
    await expect(rows(page).first()).toContainText('5m ago');
    await page.clock.setSystemTime(now + 20 * 60_000);
    await page.getByRole('button', { name: 'Syntax', exact: true }).click();
    await expect(page.getByTestId('syntax-help')).toBeVisible();
    await expect(rows(page).first()).toContainText('25m ago');
    await expect(group(page, 'today')).toContainText(TASK.title);
  });

  test('an idle page crosses two midnights and Monday without unrelated mutations', async ({ page }) => {
    const now = Date.UTC(2026, 10, 9, 7, 59, 59);
    await page.clock.install({ time: now });
    await mockLive(page, { threads: [], messages: [], todos: [{ ...TASK, phaseAt: now - 1000 }] });
    await page.goto('/app/activity');
    await expect(group(page, 'today')).toContainText(TASK.title);
    await page.clock.runFor(1500);
    await expect(group(page, 'yesterday')).toContainText(TASK.title);
    await page.clock.fastForward(24 * 3_600_000);
    await expect(group(page, 'older')).toContainText(TASK.title);
    await expect(group(page, 'week')).toHaveCount(0);
  });

  test('visibility catches a suspended date and refreshes relative search once', async ({ page }) => {
    const now = Date.UTC(2026, 10, 4, 20);
    await page.clock.install({ time: now });
    let searches = 0;
    await mockLive(page, { threads: [], messages: [], todos: [{ ...TASK, phaseAt: now }] }, (path, _route, json) => {
      if (path !== '/api/search') return undefined;
      searches += 1;
      return json({ todos: searches === 1 ? [{ id: TASK.id }] : [], projects: [], agents: [], filters: [] });
    });
    await page.goto('/app/activity?q=after%3A7d');
    await expect(rows(page)).toHaveCount(1);
    const before = searches;
    await page.clock.setSystemTime(now + 2 * 24 * 3_600_000);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByTestId('activity-empty')).toBeVisible();
    expect(searches).toBe(before + 1);
  });

  test('a held cached-project retry disables repeat requests and restores labels without blank searches', async ({ page }) => {
    const now = Date.UTC(2026, 10, 4, 20);
    await page.clock.install({ time: now });
    let failing = false;
    let holding = false;
    let searches = 0;
    let projects = 0;
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const requests: string[] = [];
    await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
      requests.push(route.request().url());
      if (path === '/api/projects') projects += 1;
      if (path === '/api/search') { searches += 1; return json({ todos: [], projects: [], agents: [], filters: [] }); }
      if (path === '/api/projects' && failing) return json({ error: 'down' }, 500);
      if (path === '/api/projects' && holding) return held.then(() => json([{ id: 'proj-1', name: 'cairn' }]));
      return undefined;
    });
    await page.goto('/app/activity');
    await expect(rows(page)).toHaveCount(1);
    failing = true;
    await page.clock.setSystemTime(now + 24 * 3_600_000);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.runFor(1200);
    await expect(page.getByTestId('activity-error')).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
    failing = false;
    holding = true;
    const before = projects;
    const retry = page.getByTestId('activity-error').getByRole('button', { name: 'Retry' });
    await retry.evaluate((button) => { button.click(); button.click(); });
    await expect(retry).toBeDisabled();
    await retry.evaluate((button) => button.click());
    await expect.poll(() => projects).toBe(before + 1);
    release?.();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('cairn');
    expect(projects).toBe(before + 1);
    expect(searches).toBe(0);
    expect(requests.some((url) => url.includes('undefined'))).toBe(false);
  });

  test('fixture groups and timestamps stay static across midnight and visibility return', async ({ page }) => {
    await page.clock.install({ time: Date.UTC(2026, 10, 4, 20) });
    await page.goto(ACTIVITY);
    await expect(groups(page)).toHaveCount(4);
    const before = await page.getByTestId('activity-list').innerText();
    await page.clock.fastForward(2 * 24 * 3_600_000);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(await page.getByTestId('activity-list').innerText()).toBe(before);
  });
});
