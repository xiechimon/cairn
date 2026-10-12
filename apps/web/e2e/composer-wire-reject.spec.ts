import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';

// Composer wire single source (#625): both composer faces — the detail
// conversation composer and the chief drawer composer — run the same
// useComposerWire send contract. The contract's observable law is the
// async reject path (#75 detail steer, #631/#635 chief send): Enter sends,
// a successful send clears the draft, and a rejected send keeps every word
// in the box (the failure toast belongs to the mutation-owning surface).
//
// Failure modes pinned here (one test per mode, per face):
//  1. detail face: steer POST rejected (409, no active step) — the draft
//     must survive verbatim; a regression here is the pre-#75 lost-words
//     bug returning through the hook extraction;
//  2. detail face: steer POST accepted — the draft clears (the success
//     half of the contract must not be pinned only by its reject half);
//  3. chief face: send POST rejected (500) — the draft survives and the
//     surface toasts (#635); the drawer got this law in #631 with its own
//     copy of the send logic; this pin guards the shared implementation;
//  4. chief face: send POST accepted — the draft clears.
//
// Enter-to-send is pinned on both faces by construction: every test drives
// the send through the keyboard, not the button.
//
// Data face = live face stubbed (merge-reject / skills-readonly stubBoot
// discipline): no ?scenario= means the real API branch; the surfaces under
// test get their own stubs and every other GET falls through to a 500 the
// app already tolerates (data ?? [] family).

const TEAM_ID = 'team-1';
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };

// Evidence screenshots go through evidenceShot (no-op by default; to
// regenerate evidence for a PR, run with
// PACMAN_E2E_EVIDENCE=docs/verify/<ticket> — see e2e/evidence.ts).
// Historical evidence = the committed docs/verify/625/after/; regression
// runs must never rewrite it.

/** Boot face: teams / user me carry the teamId, every other GET 500s.
 *  page.route matches in reverse registration order — catch-all first. */
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

// —— detail face: building-phase card, the composer sends a steer ————

const CARD_ID = 'todo-1';
const BUILD_ID = 'build-1';
const PROJECT_ID = 'proj-1';

const WIRE_CARD = {
  id: CARD_ID,
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: '共享 wire 探针',
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
  name: 'pacman',
  teamId: TEAM_ID,
  repoKind: 'hosted',
  repoName: 'pacman',
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

async function stubDetailSurface(page: Page) {
  await page.route(`**/api/teams/${TEAM_ID}/members`, (route) =>
    route.fulfill({
      json: [{ id: 'member-user', teamId: TEAM_ID, actorId: USER.id, memberType: 'user', actor: USER }],
    }),
  );
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
  await page.route(`**/api/conversations/${BUILD_ID}/messages`, (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ json: EMPTY_CONVERSATION });
  });
}

const DETAIL_DRAFT = '在执行中补一句话';

test('detail face: a rejected steer (409) keeps the draft word for word', async ({ page }) => {
  await stubBoot(page);
  await stubDetailSurface(page);
  let posts = 0;
  await page.route(`**/api/conversations/${BUILD_ID}/messages`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    posts += 1;
    return route.fulfill({ status: 409, json: { error: 'no active step' } });
  });

  await page.goto(`/app/todo/${CARD_ID}`);
  // #945/#910 重钉：composer 输入面 = composer-card testid 域内的 textarea
  // 元素载体（.composer-input 类名别名残留 DOM 至终账票）。
  const input = page.locator('[data-testid="composer-card"] textarea');
  await expect(input).toBeVisible();
  await input.fill(DETAIL_DRAFT);
  await input.press('Enter');

  // Guard: the send really hit the wire, otherwise "draft survives" is
  // testing a no-op.
  await expect.poll(() => posts).toBe(1);
  await expect(input).toHaveValue(DETAIL_DRAFT);
  await evidenceShot(page, 'detail-reject-keeps-draft.png');
});

test('detail face: an accepted steer clears the draft', async ({ page }) => {
  await stubBoot(page);
  await stubDetailSurface(page);
  let posts = 0;
  await page.route(`**/api/conversations/${BUILD_ID}/messages`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    posts += 1;
    return route.fulfill({ status: 201, json: { message: { id: 'msg-1' } } });
  });

  await page.goto(`/app/todo/${CARD_ID}`);
  // #945/#910 重钉：composer 输入面 = composer-card testid 域内的 textarea
  // 元素载体（.composer-input 类名别名残留 DOM 至终账票）。
  const input = page.locator('[data-testid="composer-card"] textarea');
  await expect(input).toBeVisible();
  await input.fill(DETAIL_DRAFT);
  await input.press('Enter');

  await expect.poll(() => posts).toBe(1);
  await expect(input).toHaveValue('');
});

// —— chief face: drawer composer, the send opens/continues a thread ————

const CHIEF_DRAFT = '帮我看看这个项目的进展';

async function openChiefDrawer(page: Page) {
  await stubBoot(page);
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ json: [] });
  });
  await page.goto('/app');
  // #950 载体：.chief-fab → aria-label 总管钮；.chief-composer-input → testid。
  await page.getByRole('button', { name: '总管', exact: true }).click();
  const input = page.getByTestId('chief-composer-input');
  await expect(input).toBeVisible();
  await expect(input).toBeEditable();
  return input;
}

test('chief face: a rejected send (500) keeps the draft and toasts', async ({ page }) => {
  const input = await openChiefDrawer(page);
  let posts = 0;
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    posts += 1;
    return route.fulfill({ status: 500, json: { error: 'upstream refused' } });
  });

  await input.fill(CHIEF_DRAFT);
  await input.press('Enter');

  await expect.poll(() => posts).toBe(1);
  await expect(input).toHaveValue(CHIEF_DRAFT);
  // #635: the surface owns the failure feedback — the toast carries the
  // server reason verbatim.
  const toast = page.locator('[data-sonner-toast]');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('发送失败，请重试。');
  await expect(toast).toContainText('upstream refused');
  await evidenceShot(page, 'chief-reject-keeps-draft.png');
});

test('chief face: an accepted send clears the draft', async ({ page }) => {
  const input = await openChiefDrawer(page);
  let posts = 0;
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    posts += 1;
    return route.fulfill({
      status: 200,
      json: { thread: { id: 'chief-1', teamId: TEAM_ID, title: CHIEF_DRAFT, createdAt: 0 } },
    });
  });

  await input.fill(CHIEF_DRAFT);
  await input.press('Enter');

  await expect.poll(() => posts).toBe(1);
  await expect(input).toHaveValue('');
  await evidenceShot(page, 'chief-send-clears-draft.png');
});
