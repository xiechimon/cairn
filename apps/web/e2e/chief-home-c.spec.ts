import { expect, type Page, test } from '@playwright/test';

const PROJECT_ID = 'ZAQczKCu0MOAzC1ZqcFlX';
const home = (scenario: string, query = '') => `/app?scenario=${scenario}${query}`;
const needsYou = (page: Page) => page.getByTestId('needs-you');
const pill = (page: Page) => page.getByTestId('in-progress-pill');
const composer = (page: Page) => page.getByTestId('home-c').getByTestId('chief-composer-input');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

test('the home is one Coordinator conversation: serif greeting, a pinned decision, the conversation, the in-progress pill and the composer', async ({
  page,
}) => {
  await page.goto(home('home-c'));
  const greeting = page.getByTestId('home-c').getByRole('heading', { level: 2 }).first();
  await expect(greeting).toHaveCSS('font-family', /sourceSerif4/);
  await expect(page.getByTestId('home-c-since')).toContainText('4 waiting on you · 3 in progress');
  await expect(needsYou(page).locator('[data-slot="needs-you-item"]')).toHaveCount(1);
  await expect(needsYou(page)).toContainText('relay-186 cannot run glm-5.3-flash');
  await expect(page.getByTestId('chief-stream')).toContainText('Run the orb canary until it passes');
  await expect(pill(page)).toHaveText(/3 in progress/);
  await expect(composer(page)).toBeVisible();
});

test('the removed surfaces are gone: thread switcher, task panel, digest and per-thread sidebar lists', async ({
  page,
}) => {
  await page.goto(home('home-c'));
  await expect(page.getByTestId('home-c')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Topic' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New topic' })).toHaveCount(0);
  await expect(page.locator('[data-slot="side-panel"]')).toHaveCount(0);
  await expect(page.getByTestId('task-panel-toggle')).toHaveCount(0);
  await expect(page.getByTestId('home-sections')).toHaveCount(0);
  await expect(page.getByTestId('chief-brief')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-thread-row')).toHaveCount(0);
  await expect(page.getByTestId('group-archived')).toHaveCount(0);
  await expect(page.locator('.chief-fab')).toHaveCount(0);
});

test('"N more" opens the rest of the decisions, grouped by who acts next, a failed thread in its own tone', async ({
  page,
}) => {
  await page.goto(home('home-c'));
  await needsYou(page).getByRole('button', { name: '3 more' }).click();
  const items = needsYou(page).locator('[data-slot="needs-you-item"]');
  await expect(items).toHaveCount(4);
  const cards = needsYou(page).locator('[data-slot="thread-card"]');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('Connect a Claude subscription token');
  await expect(cards.nth(0)).toHaveAttribute('data-tone', 'waiting');
  await expect(cards.nth(1)).toContainText('Rerun the relay probe');
  await expect(items.nth(2)).toHaveAttribute('data-status', 'failed');
  await expect(cards.nth(1)).toHaveAttribute('data-tone', 'failed');
  await expect(cards.nth(2)).toContainText('Fold finished turns');
  await expect(cards.nth(2)).toHaveAttribute('data-tone', 'review');
  await needsYou(page).getByRole('button', { name: 'Show less' }).click();
  await expect(items).toHaveCount(1);
});

test('the in-progress pill expands the running threads and a row opens its thread', async ({
  page,
}) => {
  await page.goto(home('home-c'));
  await pill(page).click();
  const rows = page.getByTestId('in-progress-list').locator('[data-slot="thread-row"]');
  await expect(rows).toHaveCount(3);
  await rows.filter({ hasText: 'Push for finished threads' }).getByRole('button').first().click();
  await expect(page).toHaveURL(/\/app\/todo\/home-c-working-a/);
});

test('the sidebar lists project names only, and choosing one filters the decisions, the pill and the conversation', async ({
  page,
}) => {
  await page.goto(home('home-c'));
  const rows = page.locator('[data-slot="sidebar-project-row"]');
  await expect(rows).toHaveCount(2);
  await rows.filter({ hasText: 'cairn' }).click();
  await expect(page).toHaveURL(new RegExp(`project=${PROJECT_ID}`));
  await expect(page.getByTestId('home-c-since')).toContainText('2 waiting on you · 2 in progress');
  await expect(needsYou(page)).toContainText('Connect a Claude subscription token');
  await expect(page.getByTestId('chief-stream')).not.toContainText('Run the orb canary until it passes');
  await expect(page.getByTestId('chief-stream')).toContainText('Fold finished turns before review');
  await expect(composer(page)).toHaveAttribute('placeholder', /in cairn/);
});

test('a project link lands on the home filtered to that project', async ({ page }) => {
  await page.goto(`/app/project/${PROJECT_ID}?scenario=home-c`);
  await expect(page).toHaveURL(new RegExp(`/app\\?.*project=${PROJECT_ID}`));
  await expect(page.getByTestId('home-c')).toBeVisible();
});

test('a first run greets and offers starters, with nothing pinned', async ({ page }) => {
  await page.goto(home('home-c-empty'));
  await expect(page.getByTestId('home-c-hero').getByRole('heading', { level: 2 })).toBeVisible();
  await expect(needsYou(page)).toHaveCount(0);
  await expect(pill(page)).toHaveCount(0);
  await expect(page.getByTestId('home-c-since')).not.toContainText('waiting on you');
  await expect(page.getByTestId('home-c-since')).not.toContainText('in progress');
  await page.getByTestId('home-c-starters').getByRole('button', { name: 'Make a plan' }).click();
  await expect(composer(page)).toHaveValue('Make a plan');
});

test('at phone width the home stays one column', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(home('home-c'));
  const box = await page.getByTestId('home-c').boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(390);
  await expect(composer(page)).toBeVisible();
});

test('a failed conversation load shows Retry instead of the greeting, with no composer, and Retry recovers', async ({
  page,
}) => {
  const TEAM_ID = 'team-1';
  const USER = { id: 'user-1', displayName: 'ian', avatarUrl: null };
  const THREAD = {
    id: 'chief-global',
    chiefId: 'chief-user-1-team-1',
    userId: USER.id,
    teamId: TEAM_ID,
    title: 'Coordinator',
    createdAt: 1,
    updatedAt: 1,
    lastTurnAt: null,
    session: { runtime: 'pi', id: 's1', openedAt: 1 },
    pendingSessionResumeAt: null,
    toolDefHashes: {},
    toolResultHashes: {},
    activeRun: null,
  };
  let messagesFail = true;
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({ json: [{ id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }] }),
  );
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route(`**/api/teams/${TEAM_ID}/notifications`, (route) =>
    route.fulfill({ json: { unreadThreadIds: [] } }),
  );
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/teams/${TEAM_ID}/chief`, (route) =>
    route.fulfill({
      json: {
        chief: {
          id: THREAD.chiefId,
          userId: USER.id,
          teamId: TEAM_ID,
          agent: { agentId: 'agent-1' },
          charter: null,
          lastTurnAt: null,
          createdAt: 0,
          tz: null,
        },
        agentActor: null,
        context: null,
        watches: [],
        wakes: [],
      },
    }),
  );
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route) => route.fulfill({ json: [THREAD] }));
  await page.route(`**/api/conversations/${THREAD.id}/messages*`, (route) =>
    messagesFail
      ? route.fulfill({ status: 500, json: { error: 'messages read failed' } })
      : route.fulfill({
          json: { messages: [{ id: 'm1', role: 'user', content: 'Make a plan', createdAt: 1 }] },
        }),
  );

  await page.goto('/app');
  const error = page.getByTestId('home-c-error');
  await expect(error).toBeVisible();
  await expect(page.getByTestId('home-c-hero')).toHaveCount(0);
  await expect(page.getByTestId('chief-composer-input')).toHaveCount(0);
  messagesFail = false;
  await error.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('chief-stream').getByText('Make a plan')).toBeVisible();
  await expect(composer(page)).toBeVisible();
});
