// #731 `/` slash completion on the detail composer. Acceptance is FEEL —
// every test drives a keyboard sequence and pins the observable result.
//
// Failure modes pinned (ticket "先列失败方式" numbering + D1 builtins):
//   F1  Enter-send regression: "highlighted Enter = insert/run" must not
//       break "list closed / no highlight = send";
//   F2  path false trigger (`/tmp/notes.md` second slash closes);
//   F3  matcher mixing (`/sl` must not subsequence-match `spell-check`);
//   F4  dual-open with the `@` face (`/@`, `@/`);
//   F5  mid-prompt execute must not run (inserts literal text instead);
//   F6  unavailable builtins never listed (review/stop absent here);
//   F7  empty state copy (rule 51 isomorph).
//
// Data face = live face stubbed (composer-inline-mention.spec discipline):
// no ?scenario= means the real API branch; the surfaces under test get
// their own stubs and every other GET falls through to a tolerated 500.

import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';

const TEAM_ID = 'team-1';
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };

const CARD_ID = 'todo-1';
const BUILD_ID = 'build-1';
const PROJECT_ID = 'proj-1';

const WIRE_CARD = {
  id: CARD_ID,
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: '斜杠补全探针',
  spec: '',
  phase: 'building',
  phaseAt: 0,
  seqNum: 9,
  orderIndex: 0,
  tagIds: [],
  assignment: null,
  agent: null,
  latestBuildId: BUILD_ID,
  lastRunAt: 0,
  hasChanges: false,
  hasPlan: true,
  buildHistory: [],
  sourceTodo: null,
  v: 1,
};

const PROJECT = {
  id: PROJECT_ID,
  name: 'cairn',
  teamId: TEAM_ID,
  repoKind: 'hosted',
  repoName: 'cairn',
  githubRepo: null,
  localPath: null,
};

const WIRE_BUILD = {
  id: BUILD_ID,
  todoId: CARD_ID,
  withPlan: true,
  prevPhase: null,
  triggerSource: 'user',
  planDocId: null,
  errorMessage: null,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: 0,
};

const EMPTY_CONVERSATION = {
  messages: [],
  chips: null,
  historyEpoch: 0,
  steerPending: [],
  activeRun: null,
  nextCursor: null,
};

const AGENTS = [{ id: 'agent-1', displayName: 'builder', description: 'Builds features' }];

const SKILLS = [
  { id: 'code-review', teamId: TEAM_ID, name: 'code-review', description: 'Reviews code' },
  { id: 'spell-check', teamId: TEAM_ID, name: 'spell-check', description: 'Checks spelling' },
];

async function stubBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route(`**/api/teams/${TEAM_ID}/notifications`, (route) =>
    route.fulfill({ json: { unreadThreadIds: [] } }),
  );
}

async function openDetail(page: Page) {
  await stubBoot(page);
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
  await page.route('**/api/skills*', (route) => route.fulfill({ json: SKILLS }));
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [WIRE_CARD] }));
  await page.route(`**/api/todos/${CARD_ID}`, (route) => route.fulfill({ json: WIRE_CARD }));
  await page.route('**/api/projects', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route(`**/api/builds/${BUILD_ID}`, (route) => route.fulfill({ json: WIRE_BUILD }));
  await page.route(`**/api/builds/${BUILD_ID}/steps`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/plans`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/usage`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/changes`, (route) =>
    route.fulfill({ json: { files: [] } }),
  );
  const sent: string[] = [];
  await page.route(`**/api/conversations/${BUILD_ID}/messages`, (route, request) => {
    if (request.method() !== 'POST') return route.fulfill({ json: EMPTY_CONVERSATION });
    sent.push(request.postData() ?? '');
    return route.fulfill({ status: 201, json: { message: { id: 'msg-1' } } });
  });
  const membersLoaded = page.waitForResponse(
    (r) => r.url().includes(`/api/teams/${TEAM_ID}/members`) && r.status() === 200,
  );
  const skillsLoaded = page.waitForResponse(
    (r) => r.url().includes('/api/skills') && r.status() === 200,
  );
  await page.goto(`/app/todo/${CARD_ID}`);
  await membersLoaded;
  await skillsLoaded;
  const input = page.locator('[data-testid="composer-card"] textarea');
  await expect(input).toBeVisible();
  await expect(input).toBeEditable();
  const menu = page.locator('.slash-menu');
  const rows = page.locator('.slash-menu-row');
  return { input, menu, rows, sent };
}

test('trigger: `/` opens builtins then skills, paths and mid-word stay literal (F2/F6)', async ({
  page,
}) => {
  const { input, menu, rows } = await openDetail(page);

  await input.fill('foo/');
  await expect(menu).toBeHidden();

  await input.fill('/tmp/notes.md');
  await expect(menu).toBeHidden();

  // Building phase: review/stop unavailable, so four builtins (F6),
  // then the two stubbed team skills in roster order.
  await input.fill('/');
  await expect(menu).toBeVisible();
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(0)).toContainText('/clear');
  await expect(rows.nth(3)).toContainText('/help');
  await expect(rows.nth(4)).toContainText('/code-review');
  await expect(rows.nth(5)).toContainText('/spell-check');

  await input.fill('好的。/');
  await expect(menu).toBeVisible();
  await evidenceShot(page, 'slash-trigger.png');
});

test('filter: word-prefix only, alias, empty state (F3/F7)', async ({ page }) => {
  const { input, menu, rows } = await openDetail(page);

  await input.fill('/cl');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('/clear');

  // Alias: `/new` highlights `/clear` (canon rule 48).
  await input.fill('/new');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('/clear');

  // Subsequence is not a match: `/sl` hits no word boundary (F3).
  await input.fill('/sl');
  await expect(rows).toHaveCount(0);
  await expect(menu).toBeVisible();
  await expect(page.locator('.slash-menu-empty')).toContainText('没有匹配"/sl"的命令');
  await evidenceShot(page, 'slash-empty.png');
});

test('no dual-open with the @ face (F4)', async ({ page }) => {
  const { input, menu } = await openDetail(page);
  const atList = page.locator('.mention-inline');

  await input.fill('/@foo');
  await expect(menu).toBeHidden();
  await expect(atList).toBeHidden();

  // `@/foo` is a genuine `@` token (`/` is a valid @ token char, rule 5):
  // the slash face stays closed and the @ face owns it.
  await input.fill('@/foo');
  await expect(menu).toBeHidden();
  await expect(atList).toBeVisible();
});

test('Enter on a highlighted execute row runs it without sending (F1)', async ({ page }) => {
  const { input, menu, rows, sent } = await openDetail(page);

  await input.fill('some draft');
  await input.fill('/clear');
  await expect(rows.first()).toContainText('/clear');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(menu).toBeHidden();
  await expect(input).toHaveValue('');
  expect(sent).toHaveLength(0);
});

test('Tab completes without running; Enter without highlight sends (F1)', async ({ page }) => {
  const { input, menu, sent } = await openDetail(page);

  await input.fill('/clear');
  await input.press('Tab');
  await expect(menu).toBeHidden();
  await expect(input).toHaveValue('/clear ');
  expect(sent).toHaveLength(0);

  // Plain Enter with no highlight keeps the send semantics.
  await input.fill('hello');
  await input.press('Enter');
  await expect.poll(() => sent.length).toBe(1);
});

test('mid-prompt accept inserts literal text, never runs (F5)', async ({ page }) => {
  const { input, menu, rows, sent } = await openDetail(page);

  await input.fill('hi /clear');
  await expect(rows.first()).toContainText('/clear');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(menu).toBeHidden();
  await expect(input).toHaveValue('hi /clear ');
  expect(sent).toHaveLength(0);
});

test('close set: Esc, space, backspace-past-slash, outside click', async ({ page }) => {
  const { input, menu } = await openDetail(page);

  await input.fill('/');
  await expect(menu).toBeVisible();
  await input.press('Escape');
  await expect(menu).toBeHidden();

  // The dismissing key must not instantly reopen the same token.
  await expect(menu).toBeHidden();

  // A fresh edit retires the Esc marker: clear and retype the trigger.
  await input.fill('');
  await input.pressSequentially('/');
  await expect(menu).toBeVisible();
  await input.pressSequentially(' ');
  await expect(menu).toBeHidden();
  await expect(input).toHaveValue('/ ');

  await input.fill('/cl');
  await expect(menu).toBeVisible();
  await input.press('Backspace');
  await input.press('Backspace');
  await input.press('Backspace');
  await expect(menu).toBeHidden();
  await expect(input).toHaveValue('');

  await input.fill('/');
  await expect(menu).toBeVisible();
  await page.getByTestId('composer-toolbar').click();
  await expect(menu).toBeHidden();
});

test('skill row inserts the wire token with trailing space', async ({ page }) => {
  const { input, rows, sent } = await openDetail(page);

  await input.fill('/code');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('/code-review');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveValue('[code-review](skill:code-review) ');
  expect(sent).toHaveLength(0);
  await evidenceShot(page, 'slash-skill-insert.png');
});

test('mixed: slash skill token plus @ mention coexist', async ({ page }) => {
  const { input } = await openDetail(page);

  await input.fill('/code');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveValue('[code-review](skill:code-review) ');

  await input.pressSequentially(' @bu');
  await expect(page.locator('.mention-inline')).toBeVisible();
  await input.press('ArrowDown');
  await input.press('Enter');
  const value = await input.inputValue();
  expect(value).toContain('[code-review](skill:code-review)');
  expect(value).toContain('[builder](agent:agent-1)');
});

test('/help opens the command panel', async ({ page }) => {
  const { input, rows } = await openDetail(page);

  await input.fill('/');
  await expect(rows).toHaveCount(6);
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await input.press('Enter');
  const panel = page.locator('.slash-help');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.slash-help-row')).toHaveCount(4);
  await expect(panel).toContainText('/clear');
  // Geometry: the panel must land inside the viewport (an unpositioned
  // panel renders below the fold and screenshots empty).
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 733) + (box?.height ?? 0)).toBeLessThanOrEqual(732);
  await evidenceShot(page, 'slash-help.png');
});
