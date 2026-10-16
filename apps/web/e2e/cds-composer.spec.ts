import { expect, type Page, test } from '@playwright/test';
import { evidencePanelShot } from './evidence';

test('CDS composer: 20px radius, shadow-composer ladder, 8px send, 384 max-h', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16');
  await page.waitForSelector('[data-testid="composer-card"]');

  const m = await page.locator('[data-testid="composer-card"]').evaluate((el) => {
    const cs = getComputedStyle(el);
    const probe = document.createElement('div');
    probe.style.boxShadow = 'var(--shadow-composer)';
    document.body.appendChild(probe);
    const composerShadow = getComputedStyle(probe).boxShadow;
    probe.remove();
    const root = getComputedStyle(document.documentElement);
    const send = el.querySelector('.composer-send');
    const sendCs = send ? getComputedStyle(send) : null;
    const bubble = document.querySelector('[data-testid="user-bubble"]');
    const bubbleCs = bubble ? getComputedStyle(bubble) : null;
    return {
      radius: cs.borderTopLeftRadius,
      border: cs.borderTopWidth,
      shadow: cs.boxShadow,
      composerShadow,
      radiusComposer: root.getPropertyValue('--radius-composer').trim(),
      composerMaxH: root.getPropertyValue('--composer-max-h').trim(),
      sendRadius: sendCs?.borderTopLeftRadius ?? '',
      bubbleAnim: bubbleCs?.animationName ?? '',
    };
  });

  expect(m.radiusComposer).toBe('20px');
  expect(m.radius).toBe('20px');
  expect(m.border).toBe('0px');
  expect(m.composerMaxH).toBe('384px');
  expect(m.shadow).not.toBe('none');
  expect(m.shadow).toContain('0px 0px 0px 1px');
  expect(m.composerShadow).toContain('0px 0px 0px 1px');
  expect(m.sendRadius).toBe('8px');
  expect(m.bubbleAnim).toContain('message-fade-up');
});

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
  title: '多行增长探针',
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

async function stubLiveDetail(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route(`**/api/teams/${TEAM_ID}/notifications`, (route) =>
    route.fulfill({ json: { unreadThreadIds: [] } }),
  );
  await page.route(`**/api/teams/${TEAM_ID}/members`, (route) =>
    route.fulfill({
      json: [
        { id: 'member-user', teamId: TEAM_ID, actorId: USER.id, memberType: 'user', actor: USER },
      ],
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

test('CDS composer: multi-line draft grows the card and text clears the toolbar', async ({
  page,
}) => {
  await stubLiveDetail(page);
  await page.goto(`/app/todo/${CARD_ID}`);
  const card = page.locator('[data-testid="composer-card"]');
  const input = card.locator('textarea');
  await expect(input).toBeVisible();

  const emptyHeight = await card.evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.round(emptyHeight)).toBe(84);

  await input.fill('line one\nline two\nline three');
  await expect(input).toHaveValue('line one\nline two\nline three');

  const geom = await page.evaluate(() => {
    const cardEl = document.querySelector('[data-testid="composer-card"]')!;
    const ta = cardEl.querySelector('textarea')!;
    const toolbar = cardEl.querySelector('[data-testid="composer-toolbar"]')!;
    const taRect = ta.getBoundingClientRect();
    const paddingBottom = Number.parseFloat(getComputedStyle(ta).paddingBottom);
    return {
      cardHeight: cardEl.getBoundingClientRect().height,
      contentBottom: taRect.bottom - paddingBottom,
      toolbarTop: toolbar.getBoundingClientRect().top,
    };
  });

  expect(geom.cardHeight).toBeGreaterThan(84);
  expect(geom.contentBottom).toBeLessThanOrEqual(geom.toolbarTop);
  await evidencePanelShot(page, 'after.png', card);
});

test('CDS composer: a wrapped single paragraph also clears the toolbar', async ({ page }) => {
  await stubLiveDetail(page);
  await page.goto(`/app/todo/${CARD_ID}`);
  const card = page.locator('[data-testid="composer-card"]');
  const input = card.locator('textarea');
  await expect(input).toBeVisible();

  await input.fill('wrap '.repeat(80).trim());

  const geom = await page.evaluate(() => {
    const cardEl = document.querySelector('[data-testid="composer-card"]')!;
    const ta = cardEl.querySelector('textarea')!;
    const toolbar = cardEl.querySelector('[data-testid="composer-toolbar"]')!;
    const taRect = ta.getBoundingClientRect();
    return {
      cardHeight: cardEl.getBoundingClientRect().height,
      contentBottom: taRect.bottom - Number.parseFloat(getComputedStyle(ta).paddingBottom),
      toolbarTop: toolbar.getBoundingClientRect().top,
    };
  });

  expect(geom.cardHeight).toBeGreaterThan(84);
  expect(geom.contentBottom).toBeLessThanOrEqual(geom.toolbarTop);
});
