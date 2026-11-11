import { expect, type Page, test } from '@playwright/test';
import { evidencePanelShot } from './evidence';

test('CDS composer: 14px radius, shadow-composer ladder, 8px send, 384 max-h', async ({ page }) => {
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
    return {
      radius: cs.borderTopLeftRadius,
      border: cs.borderTopWidth,
      shadow: cs.boxShadow,
      composerShadow,
      radiusComposer: root.getPropertyValue('--radius-composer').trim(),
      composerMaxH: root.getPropertyValue('--composer-max-h').trim(),
      sendRadius: sendCs?.borderTopLeftRadius ?? '',
    };
  });

  expect(m.radiusComposer).toBe('14px');
  expect(m.radius).toBe('14px');
  expect(m.border).toBe('0px');
  expect(m.composerMaxH).toBe('384px');
  expect(m.shadow).not.toBe('none');
  expect(m.shadow).toContain('0px 0px 0px 1px');
  expect(m.composerShadow).toContain('0px 0px 0px 1px');
  expect(m.sendRadius).toBe('8px');
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

async function geometry(page: Page) {
  return page.evaluate(() => {
    const cardEl = document.querySelector('.side-panel [data-testid="composer-card"]')!;
    const ta = cardEl.querySelector('textarea')!.getBoundingClientRect();
    const send = cardEl.querySelector('.composer-send')!.getBoundingClientRect();
    const plus = cardEl.querySelector('[data-testid="composer-plus"]')!.getBoundingClientRect();
    return {
      cardHeight: cardEl.getBoundingClientRect().height,
      clearOfSend: ta.right <= send.left,
      clearOfPlus: ta.left >= plus.right,
      bottomsAligned: Math.abs(ta.bottom - send.bottom) <= 1,
    };
  });
}

test('CDS composer: one line at rest, like the main composer', async ({ page }) => {
  await stubLiveDetail(page);
  await page.goto(`/app/todo/${CARD_ID}`);
  const card = page.locator('.side-panel [data-testid="composer-card"]');
  await expect(card.locator('textarea')).toBeVisible();
  await expect(card.locator('textarea')).toHaveAttribute('placeholder', /回复这个任务|开始后才能回复/);
  const geom = await geometry(page);
  expect(Math.round(geom.cardHeight)).toBe(46);
  expect(geom).toMatchObject({ clearOfSend: true, clearOfPlus: true, bottomsAligned: true });
  await evidencePanelShot(page, 'one-line.png', card);
});

test('CDS composer: a multi-line draft grows the card and the text never runs under the controls', async ({
  page,
}) => {
  await stubLiveDetail(page);
  await page.goto(`/app/todo/${CARD_ID}`);
  const card = page.locator('.side-panel [data-testid="composer-card"]');
  const input = card.locator('textarea');
  await expect(input).toBeVisible();
  await input.fill('line one\nline two\nline three');
  await expect.poll(async () => (await geometry(page)).cardHeight).toBeGreaterThan(44);
  expect(await geometry(page)).toMatchObject({
    clearOfSend: true,
    clearOfPlus: true,
    bottomsAligned: true,
  });
  await evidencePanelShot(page, 'after.png', card);
});

test('CDS composer: a wrapped paragraph grows the card at a narrow width', async ({ page }) => {
  await stubLiveDetail(page);
  await page.goto(`/app/todo/${CARD_ID}`);
  const card = page.locator('.side-panel [data-testid="composer-card"]');
  const input = card.locator('textarea');
  await expect(input).toBeVisible();
  await input.fill('wrap '.repeat(80).trim());
  await expect.poll(async () => (await geometry(page)).cardHeight).toBeGreaterThan(44);
  await page.setViewportSize({ width: 360, height: 732 });
  await expect.poll(async () => (await geometry(page)).clearOfSend).toBe(true);
});
