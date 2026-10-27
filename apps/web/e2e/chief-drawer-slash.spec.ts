import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';

const TEAM_ID = 'team-1';
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };

const AGENTS = [{ id: 'agent-1', displayName: 'builder', description: 'Builds features' }];

const WIRE_CARD = {
  id: 'todo-1',
  teamId: TEAM_ID,
  projectId: 'proj-1',
  title: '抽屉斜杠探针',
  spec: '',
  phase: 'building',
  phaseAt: 0,
  seqNum: 9,
  orderIndex: 0,
  tagIds: [],
  assignment: null,
  agent: null,
  latestBuildId: 'build-1',
  lastRunAt: 0,
  hasChanges: false,
  hasPlan: true,
  buildHistory: [],
  sourceTodo: null,
  v: 1,
};

const PROJECT = {
  id: 'proj-1',
  name: 'cairn',
  teamId: TEAM_ID,
  repoKind: 'hosted',
  repoName: 'cairn',
  githubRepo: null,
  localPath: null,
};

async function openDrawer(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route(`**/api/teams/${TEAM_ID}/notifications`, (route) =>
    route.fulfill({ json: { unreadThreadIds: [] } }),
  );
  const members = [
    { id: 'member-user', teamId: TEAM_ID, actorId: USER.id, memberType: 'user', actor: USER },
    ...AGENTS.map((a, i) => ({
      id: `member-agent-${i}`,
      teamId: TEAM_ID,
      actorId: a.id,
      memberType: 'agent',
      actor: a,
    })),
  ];
  await page.route(`**/api/teams/${TEAM_ID}/members`, (route) => route.fulfill({ json: members }));
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [WIRE_CARD] }));
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route('**/api/skills?*', (route) =>
    route.fulfill({
      json: [{ id: 'skill-1', name: 'verify-cairn', description: 'Live stack' }],
    }),
  );
  await page.route(`**/api/teams/${TEAM_ID}/machines`, (route) =>
    route.fulfill({ json: [{ id: 'machine-1', name: 'xmonsMac' }] }),
  );
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ json: [] });
  });
  let posts = 0;
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    posts += 1;
    return route.fulfill({
      status: 201,
      json: {
        thread: { id: 'chief-aaa', teamId: TEAM_ID, title: '抽屉斜杠探针', createdAt: 0 },
        message: { id: 'msg-1', role: 'user', content: '抽屉斜杠探针', createdAt: 0 },
      },
    });
  });
  const membersLoaded = page.waitForResponse(
    (r) => r.url().includes(`/api/teams/${TEAM_ID}/members`) && r.status() === 200,
  );
  await page.goto('/app?view=board');
  await membersLoaded;

  await page.getByRole('button', { name: '总管', exact: true }).click();
  const drawer = page.locator('.chief-drawer');
  await expect(drawer).toBeVisible();
  const input = page.getByTestId('chief-composer-input');
  await expect(input).toBeVisible();
  await expect(input).toBeEditable();
  const menu = drawer.locator('.slash-menu');
  const rows = drawer.locator('.slash-menu-row');
  return { drawer, input, menu, rows, posts: () => posts };
}

test('trigger: `/` opens builtins plus skills, review/stop hidden (F2)', async ({ page }) => {
  const { input, menu, rows } = await openDrawer(page);

  await input.fill('/');
  await expect(menu).toBeVisible();
  // clear / attach / mention / help, then the one stubbed team skill —
  // review and stop have no drawer handles, so they are omitted (F2).
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText('/clear');
  await expect(rows.nth(1)).toContainText('/attach');
  await expect(rows.nth(2)).toContainText('/mention');
  await expect(rows.nth(3)).toContainText('/help');
  await expect(rows.nth(4)).toContainText('/verify-cairn');
  await expect(menu).not.toContainText('/review');
  await expect(menu).not.toContainText('/stop');

  await input.fill('/zzz');
  await expect(rows).toHaveCount(0);
  await expect(menu).toBeVisible();
  await evidenceShot(page, 'chief-slash-trigger.png');
});

test('`/clear` runs without sending and toasts confirmation (F1)', async ({ page }) => {
  const { input, menu, rows, posts } = await openDrawer(page);

  await input.fill('some draft');
  await input.fill('/clear');
  await expect(rows.first()).toContainText('/clear');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(menu).toBeHidden();
  await expect(input).toHaveValue('');
  // Visible feedback: the shared sonner source confirms the clear.
  const toast = page.locator('[data-sonner-toast]');
  await expect(toast).toContainText('已清空');
  await expect(toast.first()).toBeVisible();
  // Nothing went out to the chief wire.
  expect(posts()).toBe(0);
  await evidenceShot(page, 'chief-slash-clear-toast.png');
});

test('Tab completes without running; Enter without highlight sends (F4)', async ({ page }) => {
  const { input, menu, posts } = await openDrawer(page);

  await input.fill('/clear');
  await input.press('Tab');
  await expect(menu).toBeHidden();
  await expect(input).toHaveValue('/clear ');
  expect(posts()).toBe(0);

  // Plain Enter with no highlight keeps the chief send semantics.
  await input.fill('hello chief');
  await input.press('Enter');
  await expect.poll(posts).toBe(1);
});

test('mid-prompt accept inserts literal text, never runs (F3)', async ({ page }) => {
  const { input, menu, rows, posts } = await openDrawer(page);

  await input.fill('hi /clear');
  await expect(rows.first()).toContainText('/clear');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(menu).toBeHidden();
  await expect(input).toHaveValue('hi /clear ');
  expect(posts()).toBe(0);
});

test('/help opens the command panel with the drawer builtins', async ({ page }) => {
  const { input, rows } = await openDrawer(page);

  await input.fill('/');
  await expect(rows).toHaveCount(5);
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await input.press('Enter');
  const panel = page.locator('.slash-help');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.slash-help-row')).toHaveCount(4);
  await expect(panel).toContainText('/clear');
  await expect(panel).not.toContainText('/review');
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  await evidenceShot(page, 'chief-slash-help.png');
});

test('Esc closes the menu and the drawer survives (F5)', async ({ page }) => {
  const { drawer, input, menu } = await openDrawer(page);

  await input.fill('/');
  await expect(menu).toBeVisible();
  await input.press('Escape');
  await expect(menu).toBeHidden();
  await expect(drawer).toBeVisible();
});
