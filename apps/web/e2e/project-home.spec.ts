import { expect, type Page, test } from '@playwright/test';

const PROJECT_ID = 'ZAQczKCu0MOAzC1ZqcFlX';
const home = (scenario: string) => `/app/project/${PROJECT_ID}?scenario=${scenario}`;
const card = (page: Page, title: string) =>
  page.locator('[data-slot="thread-card"]').filter({ hasText: title });

const composer = (page: Page) =>
  page.getByTestId('project-home').getByTestId('chief-composer-input');

async function openProjectMenu(page: Page) {
  await page.getByTestId('project-home-header').getByRole('button', { name: 'cairn' }).click();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('[role="menu"]') != null))
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

test('the header names the project and the Coordinator, and the goal leads the conversation', async ({
  page,
}) => {
  await page.goto(home('project-home'));
  const header = page.getByTestId('project-home-header');
  await expect(header.getByRole('button', { name: 'cairn' })).toBeVisible();
  await expect(header).toContainText('Coordinator');
  await expect(page.getByTestId('project-goal')).toContainText(
    'Ship an open-source, self-hostable agent team',
  );
  await expect(page.getByTestId('chief-composer-input')).toHaveCount(1);
  await expect(page.locator('.chief-fab')).toHaveCount(0);
});

test('threads the Coordinator started show as cards with the action each one needs', async ({
  page,
}) => {
  await page.goto(home('project-home'));
  const waiting = card(page, 'Connect a Claude subscription token');
  await expect(waiting).toHaveAttribute('data-tone', 'waiting');
  await expect(waiting.getByRole('button', { name: 'Review plan' })).toBeVisible();
  await expect(waiting).toContainText('Plan ready. Approve to start.');
  const review = card(page, 'Fold finished turns into purpose and duration');
  await expect(review).toHaveAttribute('data-tone', 'review');
  await expect(review.getByRole('button', { name: 'Review', exact: true })).toBeVisible();
  await expect(review).toContainText('Ready for your review');
  const working = card(page, 'Push for finished and failed threads');
  await expect(working).toHaveAttribute('data-tone', 'working');
  await expect(working.getByRole('button')).toHaveCount(1);
  await expect(working.getByRole('button', { name: 'View thread' })).toBeVisible();
});

test('View thread opens the thread', async ({ page }) => {
  await page.goto(home('project-home'));
  await card(page, 'Push for finished and failed threads')
    .getByRole('button', { name: 'View thread' })
    .click();
  await expect(page).toHaveURL(/\/app\/todo\/project-home-working/);
});

test('a new project greets with its goal and starter chips that fill the composer', async ({
  page,
}) => {
  await page.goto(home('project-home-empty'));
  await expect(page.getByRole("heading", { name: /New project: api-latency/ })).toBeVisible();
  await expect(page.getByTestId('project-goal')).toContainText('Bring p95 latency under 200 ms');
  const chips = page.getByTestId('project-starter-chips').getByRole('button');
  await expect(chips).toHaveText(['Make a plan', 'Add a repo', 'Pick up recent work', 'Use my tools']);
  await chips.filter({ hasText: 'Make a plan' }).click();
  await expect(composer(page)).toHaveValue('Make a plan');
  await expect(composer(page)).toBeFocused();
});

test('a failed send keeps the message and says why above the composer', async ({ page }) => {
  await page.goto(home('project-home-send-error'));
  const error = page.getByTestId('chief-composer-error');
  await expect(error).toContainText('Could not reach the Coordinator');
  await expect(composer(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(composer(page)).toHaveValue('Plan the next batch');
});

test('an archived project replaces the composer with an Unarchive banner', async ({ page }) => {
  await page.goto(home('project-home-archived'));
  const banner = page.getByTestId('project-archived-banner');
  await expect(banner).toContainText('This project is archived');
  await expect(banner.getByRole('button', { name: 'Unarchive' })).toBeVisible();
  await expect(composer(page)).toHaveCount(0);
});

test('the project menu lists its actions with single-key hints', async ({ page }) => {
  await page.goto(home('project-home'));
  await page.getByTestId('project-home-header').getByRole('button', { name: 'cairn' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText([
    /Rename\s*R/,
    /Settings/,
    /Copy link\s*L/,
    /Archive…\s*A/,
    /Delete…\s*D/,
  ]);
});

test('Archive asks first and says what happens to running threads', async ({ page }) => {
  await page.goto(home('project-home'));
  await openProjectMenu(page);
  await page.keyboard.press('a');
  const dialog = page.getByRole('alertdialog', { name: 'Archive cairn?' });
  await expect(dialog).toContainText('Threads become read-only');
  await expect(dialog).toContainText('1 running thread finishes its current turn first');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('project-archived-banner')).toHaveCount(0);
});

test('confirming Archive swaps the composer for the banner', async ({ page }) => {
  await page.goto(home('project-home'));
  await page.getByTestId('project-home-header').getByRole('button', { name: 'cairn' }).click();
  await page.getByRole('menuitem', { name: /Archive/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByTestId('project-archived-banner')).toBeVisible();
  await page.getByTestId('project-archived-banner').getByRole('button', { name: 'Unarchive' }).click();
  await expect(composer(page)).toBeVisible();
});

test('switching projects drops the starter text picked in the previous one', async ({ page }) => {
  await page.goto(home('project-home-empty'));
  await page.getByTestId('project-starter-chips').getByRole('button', { name: 'Make a plan' }).click();
  await expect(composer(page)).toHaveValue('Make a plan');
  await page.locator('[data-slot="sidebar-project-row"]', { hasText: 'cairn-site' }).click();
  await expect(page).toHaveURL(/\/app\/project\/project-home-other/);
  await expect(composer(page)).toHaveValue('');
});

test('a failed conversation load shows Retry instead of the first-run greeting, with no composer', async ({
  page,
}) => {
  const TEAM_ID = 'team-1';
  const USER = { id: 'user-1', displayName: 'ian', avatarUrl: null };
  const THREAD = {
    id: 'chief-proj-live',
    chiefId: 'chief-user-1-team-1',
    userId: USER.id,
    teamId: TEAM_ID,
    projectId: 'proj-live',
    title: 'Plan',
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
  await page.route('**/api/projects?*', (route) =>
    route.fulfill({
      json: [{ id: 'proj-live', name: 'api-latency', teamId: TEAM_ID, splitPolicy: 'human', archivedAt: null }],
    }),
  );
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
  await page.route('**/api/projects/proj-live/coordinator', (route) =>
    route.fulfill({ json: { thread: THREAD } }),
  );
  await page.route(`**/api/conversations/${THREAD.id}/messages*`, (route) =>
    messagesFail
      ? route.fulfill({ status: 500, json: { error: 'messages read failed' } })
      : route.fulfill({ json: { messages: [{ id: 'm1', role: 'user', content: 'Make a plan', createdAt: 1 }] } }),
  );

  await page.goto('/app/project/proj-live');
  const error = page.getByTestId('project-home-conversation-error');
  await expect(error).toBeVisible();
  await expect(page.getByTestId('project-home-hero')).toHaveCount(0);
  await expect(page.getByTestId('chief-composer-input')).toHaveCount(0);

  messagesFail = false;
  await error.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('chief-stream').getByText('Make a plan')).toBeVisible();
  await expect(composer(page)).toBeVisible();
});
