import { expect, type Locator, type Page, test } from '@playwright/test';

const MARK = 'data-scroll-probe-1032';

async function expectScrollerReachesBottom(page: Page, probe: Locator, last: Locator) {
  await probe.evaluate((el, mark) => {
    let node = el.parentElement;
    while (node != null && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if (
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        node.scrollHeight > node.clientHeight
      ) {
        node.setAttribute(mark, '');
        return;
      }
      node = node.parentElement;
    }
  }, MARK);

  const scroller = page.locator(`[${MARK}]`);
  await expect(scroller).toHaveCount(1);

  const box = await probe.boundingBox();
  if (box == null) throw new Error('probe element has no box (not rendered?)');
  // Aim near the probe's top: a tall probe (the 60-line charter) centers
  // below the viewport, in the 10px canvas gap under the sheet.
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 10));
  await page.mouse.wheel(0, 240);
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 3_000 })
    .toBeGreaterThan(0);

  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(() =>
      scroller.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1),
    )
    .toBe(true);
  await expect(last).toBeInViewport();

  const overflow = await page.evaluate(() => ({
    h: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    v: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
  expect(overflow.h).toBeLessThanOrEqual(0);
  expect(overflow.v).toBeLessThanOrEqual(0);
}

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const PROJECT = {
  id: 'proj-1',
  name: 'cairn',
  teamId: 'team-1',
  repoKind: 'hosted',
  repoName: 'cairn',
  githubRepo: null,
  localPath: null,
};

async function stubLiveBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
}

const AGENT_ACTOR = {
  id: 'agent-1',
  displayName: '记忆代理',
  description: null,
  status: 'active',
  avatarUrl: null,
  provider: null,
  modelId: null,
  thinkingLevel: null,
  tools: [],
  secrets: [],
  defaultSkill: null,
  skillsAllowlist: null,
  mcpServers: [],
};

const MEMORY_LINE = '这是一段足够长的记忆内容，用来把设置面的记忆列表撑出真实滚动。';

function wireChief(charter: string, watchCount: number) {
  return {
    chief: {
      id: 'chief-user-1-team-1',
      userId: 'user-1',
      teamId: 'team-1',
      agent: { agentId: 'agent-1' },
      charter,
      lastTurnAt: null,
      createdAt: 0,
      tz: 'Asia/Shanghai',
    },
    agentActor: AGENT_ACTOR,
    context: null,
    watches: Array.from({ length: watchCount }, (_, i) => ({
      todoId: `todo-w${i}`,
      projectId: 'proj-1',
      seqNum: i + 1,
      title: `关注条目 ${i}`,
      projectName: 'cairn',
      phase: 'building',
      reason: 'Dispatched by the chief: report back when it parks at a gate or settles.',
      createdAt: 0,
      threadId: `chief-thread-${i}`,
      threadTitle: '滚动探针线程',
    })),
    wakes: [],
  };
}

const MEMORIES = Array.from({ length: 40 }, (_, i) => ({
  id: `mem-${i}`,
  agentId: 'agent-1',
  teamId: 'team-1',
  title: `记忆条目 ${i}`,
  content: `第 ${i} 条沉淀：${MEMORY_LINE}`,
  projectId: null,
  sourceTodoId: null,
  sourceBuildId: null,
  createdAt: 0,
  updatedAt: 0,
}));

async function openChiefSettings(page: Page) {
  await page.goto('/app');
  await page.locator('button[aria-label="总管"]').click();
  const drawer = page.getByRole('dialog', { name: '总管' });
  await expect(drawer).toBeVisible();
  await drawer.locator('button[aria-label="总管设置"]').click();
  await expect(page.getByRole('heading', { name: '总管设置' })).toBeVisible();

  await expect(page.locator('.chief-drawer')).toBeAttached();
}

test('all three long-content tabs of chief settings scroll to the bottom (#1032)', async ({ page }) => {
  await stubLiveBoot(page);
  const longCharter = Array.from({ length: 60 }, (_, i) => `章程第 ${i} 行：${MEMORY_LINE}`).join(
    '\n',
  );
  await page.route('**/api/teams/team-1/chief', (route) =>
    route.fulfill({ json: wireChief(longCharter, 30) }),
  );
  await page.route('**/api/teams/team-1/agents/agent-1/memories', (route) =>
    route.fulfill({ json: MEMORIES }),
  );
  await openChiefSettings(page);

  await page.getByRole('tab', { name: '记忆' }).click();
  const quota = page.getByText('记忆 · 40 / 100');
  await expect(quota).toBeVisible();
  await expectScrollerReachesBottom(page, quota, page.getByText('记忆条目 39'));

  await page.getByRole('tab', { name: '关注与提醒' }).click();
  const firstWatch = page.getByText('关注条目 0', { exact: true });
  await expect(firstWatch).toBeVisible();
  await expectScrollerReachesBottom(page, firstWatch, page.getByText('关注条目 29', { exact: true }));

  await page.getByRole('tab', { name: '章程' }).click();
  const charterHead = page.getByText('章程第 0 行', { exact: false }).first();
  await expect(charterHead).toBeVisible();
  await expectScrollerReachesBottom(
    page,
    charterHead,
    page.getByRole('button', { name: '编辑' }),
  );
});

function wireTodo(i: number) {
  return {
    id: `todo-${i}`,
    teamId: 'team-1',
    projectId: 'proj-1',
    title: `滚动探针任务 ${i}`,
    spec: `滚动探针任务 ${i}`,
    phase: 'todo',
    phaseAt: 0,
    seqNum: i + 1,
    orderIndex: i,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: null,
    lastRunAt: 0,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [],
    sourceTodo: null,
    v: 1,
  };
}

test('project task list page scrolls to the bottom (#1032)', async ({ page }) => {
  await stubLiveBoot(page);
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route('**/api/todos?*', (route) =>
    route.fulfill({ json: Array.from({ length: 40 }, (_, i) => wireTodo(i)) }),
  );
  await page.goto('/app/project/proj-1?tab=tasks');
  const rows = page.getByTestId('task-row');
  await expect(rows).toHaveCount(40);
  const search = page.getByRole('textbox', { name: '搜索任务' });
  await expect(search).toBeVisible();
  await expectScrollerReachesBottom(page, search, rows.last());
});

function wireSchedule(i: number) {
  return {
    id: `sched-${i}`,
    teamId: 'team-1',
    projectId: 'proj-1',
    todoId: `todo-${i}`,
    kind: 'daily',
    at: 0,
    tz: 'Asia/Shanghai',
    machineId: null,
    nextRunAt: 0,
    createdBy: 'user-1',
    todo: {
      seqNum: i + 1,
      title: `滚动探针定时 ${i}`,
      phase: 'todo',
      projectName: 'cairn',
      ownerId: 'user-1',
    },
  };
}

test('schedules page scrolls to the bottom (#1032)', async ({ page }) => {
  await stubLiveBoot(page);
  await page.route('**/api/schedules*', (route) =>
    route.fulfill({ json: Array.from({ length: 30 }, (_, i) => wireSchedule(i)) }),
  );
  await page.goto('/app/schedules');
  const cards = page.locator('.sched-card');
  await expect(cards).toHaveCount(30);
  await expectScrollerReachesBottom(page, cards.first(), cards.last());
});

test('project settings page scrolls to the bottom (#1032)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 360 });
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c');
  const danger = page.getByText('危险操作');
  await expect(danger).toBeAttached();
  const firstPanel = page.locator('.prj-set-avatar');
  await expect(firstPanel).toBeVisible();
  await expectScrollerReachesBottom(
    page,
    firstPanel,
    page.getByRole('button', { name: '删除', exact: true }),
  );
});

test('new project page scrolls to the bottom (#1032)', async ({ page }) => {

  await page.setViewportSize({ width: 1440, height: 300 });
  await page.goto('/app/project/new?scenario=01');
  const heading = page.getByRole('button', { name: '创建项目' });
  await expect(heading).toBeAttached();

  const hint = page.getByText('可选。未设置时以首字母代替。');
  await expect(hint).toBeVisible();
  await expectScrollerReachesBottom(page, hint, heading);
});
