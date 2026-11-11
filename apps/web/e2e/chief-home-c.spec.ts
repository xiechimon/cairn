import { expect, type Page, test } from '@playwright/test';

const PROJECT_ID = 'ZAQczKCu0MOAzC1ZqcFlX';
const home = (scenario: string, query = '') => `/app?scenario=${scenario}${query}`;
const composer = (page: Page) => page.getByTestId('home-c').getByTestId('chief-composer-input');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

test('the home is one Coordinator conversation: no greeting once it has messages, the conversation with task cards, and the composer, with no in-progress pill', async ({
  page,
}) => {
  await page.goto(home('home-c'));
  await expect(page.getByTestId('chief-stream')).toBeVisible();
  await expect(page.getByTestId('home-c').locator('.voice-greeting')).toHaveCount(0);
  await expect(page.getByTestId('home-c-since')).toHaveCount(0);
  await expect(page.getByTestId('tasks-badge')).toHaveText('3');
  await expect(page.getByTestId('needs-you')).toHaveCount(0);
  await expect(page.getByTestId('chief-stream').locator('[data-slot="task-card"]')).toHaveCount(2);
  await expect(page.getByTestId('chief-question-entry')).toHaveCount(0);
  await expect(page.getByTestId('chief-stream').getByTestId('chief-question')).toBeVisible();
  await expect(page.getByTestId('chief-composer-block').getByTestId('chief-question')).toHaveCount(0);
  await expect(page.getByTestId('chief-stream')).toContainText('Run the orb canary until it passes');
  await expect(page.getByTestId('in-progress-pill')).toHaveCount(0);
  await expect(page.getByTestId('home-c').getByRole('heading', { level: 1 })).toHaveText('Coordinator');
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
  await expect(page.locator('[data-slot="sidebar-thread-row"]')).toHaveCount(0);
  await expect(page.getByTestId('group-archived')).toHaveCount(0);
  await expect(page.locator('.chief-fab')).toHaveCount(0);
});

test('the Tasks panel lists running threads and a running row opens its thread', async ({
  page,
}) => {
  await page.goto(home('home-c', '&pane=tasks'));
  const rows = page.locator('.side-panel [data-section="working"] [data-slot="task-row"]');
  await expect(rows).toHaveCount(4);
  await rows.filter({ hasText: 'Push for finished threads' }).click();
  await expect(page).toHaveURL(/\/app\?.*thread=home-c-working-a/);
  await expect(page.getByTestId('side-chat')).toContainText('Push for finished threads');
});

test('the sidebar lists project names only, and the project chat filters the task cards and the conversation', async ({
  page,
}) => {
  await page.goto(home('home-c'));
  const rows = page.locator('[data-slot="sidebar-project-row"]');
  await expect(rows).toHaveCount(2);
  await rows.filter({ hasText: 'cairn' }).click();
  await expect(page).toHaveURL(new RegExp(`project=${PROJECT_ID}`));
  await expect(page.getByTestId('project-home')).toBeVisible();
  await page.goto(home('home-c', `&project=${PROJECT_ID}&chat=1`));
  await expect(page.getByTestId('tasks-badge')).toHaveText('2');
  const cards = page.getByTestId('chief-stream').locator('[data-slot="task-card"]');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Fold finished turns into purpose and duration');
  await expect(page.getByTestId('chief-stream')).not.toContainText('Run the orb canary until it passes');
  await expect(page.getByTestId('chief-stream')).toContainText('Fold finished turns before review');
  await expect(composer(page)).toHaveAttribute('placeholder', /in cairn|Type your own answer/);
  await expect(page.getByTestId('home-c').getByRole('heading', { level: 1 })).toHaveText('cairn');
});

test('a project link lands on that project home', async ({ page }) => {
  await page.goto(`/app/project/${PROJECT_ID}?scenario=home-c`);
  await expect(page).toHaveURL(new RegExp(`/app\\?.*project=${PROJECT_ID}`));
  await expect(page.getByTestId('project-home')).toBeVisible();
});

test('a first run greets and offers starters, with nothing pinned', async ({ page }) => {
  await page.goto(home('home-c-empty'));
  await expect(page.getByTestId('home-c-hero').getByRole('heading', { level: 2 })).toBeVisible();
  await expect(page.getByTestId('needs-you')).toHaveCount(0);
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
  await page.getByTestId('home-c').getByRole('button', { name: 'Tasks' }).click();
  await expect(page.getByRole('complementary', { name: 'Tasks' })).toBeVisible();
  messagesFail = false;
  await error.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('chief-stream').getByText('Make a plan')).toBeVisible();
  await expect(composer(page)).toBeVisible();
});

test('a project chat links to that project home, tasks and settings', async ({ page }) => {
  await page.goto(home('home-c', `&project=${PROJECT_ID}&chat=1`));
  const links = page.getByTestId('home-c-project-links');
  await expect(links.getByRole('link', { name: 'Files' })).toHaveCount(0);
  await links.getByRole('link', { name: 'Tasks' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/project/${PROJECT_ID}/tasks`));
  await page.goBack();
  await links.getByRole('link', { name: 'Project settings' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/project/${PROJECT_ID}/settings`));
  await page.goBack();
  await links.getByRole('link', { name: 'Project home' }).click();
  await expect(page.getByTestId('project-home')).toBeVisible();
  await page.goto(home('home-c'));
  await expect(page.getByTestId('home-c-project-links')).toHaveCount(0);
});

test('the home lands at the newest message', async ({
  page,
}) => {
  await page.goto(home('home-c'));
  const rows = page.getByTestId('chief-stream').locator('[data-slot="message-scroller-item"]');
  await expect(rows.last()).toBeInViewport();
});

test('the tab title carries the Tasks count on every page and the sidebar carries no count', async ({
  page,
}) => {
  await page.goto(home('home-c'));
  await expect(page.getByTestId('tasks-badge')).toHaveText('3');
  await expect(page).toHaveTitle('(3) Cairn');
  await expect(page.getByRole('complementary').getByTestId('attention-badge')).toHaveCount(0);
  await page.goto('/app/schedules?scenario=home-c');
  await expect(page).toHaveTitle('(3) Cairn');
});

test('the earlier-messages divider shows only when the conversation reports earlier messages', async ({
  page,
}) => {
  await page.goto(home('home-c'));
  await expect(page.getByTestId('home-c-earlier')).toHaveText('Scroll up for earlier messages');
  await page.goto(home('home-c-empty'));
  await expect(page.getByTestId('home-c-earlier')).toHaveCount(0);
});
