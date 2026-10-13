import { expect, type Page, test } from '@playwright/test';

// 2026-10-13 回合跳转纵列（dsh TurnNavigator 对齐，用户 review 钉「3」）。
//
// 失败方式（先固化）：
//   T1 回合 ≥2 才出现；单回合对话不渲染（零噪声）。
//   T2 点击刻度 → 视口跳至对应回合（scrollTop 从底跳到顶附近）。
//   T3 悬停刻度 → 预览卡出现（prompt 文本露内）；pointer 离开 → 退场。
// 注：刻度钮 = position:absolute + 透明底 + ::before 横线 tick，Playwright
// 认为渲染面积为零不可交互 → 所有交互断言走 force:true。

// — live-stub harness (thinking-row-truncate.spec.ts 纪律) ——————————

const TEAM_ID = 'team-1';
const USER_ID = 'user-1';
const AGENT_ID = 'agent-1';
const CARD_ID = 'todo-turn-1';
const BUILD_ID = 'build-turn-1';
const PROJECT_ID = 'proj-turn-1';

const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: USER_ID, displayName: 'Xmon Dai', avatarUrl: null };
const PROJECT = { id: PROJECT_ID, name: 'pacman', teamId: TEAM_ID, repoKind: 'hosted', repoName: 'pacman', githubRepo: null, localPath: null };

const WIRE_CARD = {
  id: CARD_ID, teamId: TEAM_ID, projectId: PROJECT_ID,
  title: '六轮对话任务', spec: '',
  phase: 'building', phaseAt: 0, seqNum: 1, orderIndex: 0, tagIds: [],
  assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
  agent: { id: AGENT_ID, displayName: 'builder', avatarUrl: null },
  latestBuildId: BUILD_ID, lastRunAt: 0, hasChanges: false, hasPlan: false,
  buildHistory: [], sourceTodo: null, v: 1,
};

const WIRE_BUILD = {
  id: BUILD_ID, todoId: CARD_ID, withPlan: false, prevPhase: null,
  triggerSource: 'user', pinnedMachineId: null, planDocId: null,
  errorMessage: null, prUrl: null, prNumber: null, diffHash: null, createdAt: 0,
};

function makeMessages(rounds: number) {
  const msgs: { id: string; role: string; content: unknown; createdAt: number }[] = [];
  let t = 1000;
  for (let i = 1; i <= rounds; i++) {
    msgs.push({ id: `u-${i}`, role: 'user', content: `第 ${i} 轮：请帮我分析一下这个结构`, createdAt: t++ });
    msgs.push({ id: `r-${i}`, role: 'assistant', content: `回合 ${i} 回复\n${'填满行 。\n'.repeat(12)}`, createdAt: t++ });
  }
  return msgs;
}

const SIX = makeMessages(6);
const ONE = makeMessages(1);

async function stubWorld(page: Page, msgs: typeof SIX) {
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', (route, request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() !== 'GET') return route.fulfill(json({ error: 'e2e' }, 500));
    if (path === '/api/teams') return route.fulfill(json([TEAM]));
    if (path === '/api/user/me') return route.fulfill(json(USER));
    if (path === '/api/projects') return route.fulfill(json([PROJECT]));
    if (path === '/api/todos') return route.fulfill(json([WIRE_CARD]));
    if (path === `/api/todos/${CARD_ID}`) return route.fulfill(json(WIRE_CARD));
    if (path === `/api/teams/${TEAM_ID}/members`) {
      return route.fulfill(json([{
        id: 'member-user', teamId: TEAM_ID, actorId: USER_ID, memberType: 'user', actor: USER,
      }, {
        id: `member-${AGENT_ID}`, teamId: TEAM_ID, actorId: AGENT_ID, memberType: 'agent',
        actor: { id: AGENT_ID, displayName: 'builder', description: null, status: 'active', avatarUrl: null, provider: null, modelId: 'stub', thinkingLevel: null, tools: [], secrets: [], defaultSkill: null, skillsAllowlist: null, mcpServers: [] },
      }]));
    }
    if (path === `/api/teams/${TEAM_ID}/notifications`) return route.fulfill(json({ unreadThreadIds: [] }));
    if (path === `/api/builds/${BUILD_ID}`) return route.fulfill(json(WIRE_BUILD));
    if (path === `/api/builds/${BUILD_ID}/steps`) return route.fulfill(json([]));
    if (path === `/api/builds/${BUILD_ID}/plans`) return route.fulfill(json([]));
    if (path === `/api/builds/${BUILD_ID}/usage`) return route.fulfill(json([]));
    if (path === `/api/builds/${BUILD_ID}/changes`) return route.fulfill(json({ files: [] }));
    if (path === `/api/conversations/${BUILD_ID}/messages`) {
      return route.fulfill(json({ messages: msgs, chips: [], historyEpoch: 0, steerPending: [], activeRun: null, nextCursor: null }));
    }
    return route.fulfill(json({ error: 'e2e' }, 500));
  });
}

test('T1: 单回合不渲染（零噪声法）', async ({ page }) => {
  await stubWorld(page, ONE);
  await page.goto(`/app/todo/${CARD_ID}`);
  await expect(page.getByTestId('transcript-col')).toBeVisible();
  await expect(page.locator('.turn-rail-frame')).toHaveCount(0);
});

test('T2: 六轮对话有 rail；点刻度跳回合', async ({ page }) => {
  await stubWorld(page, SIX);
  await page.goto(`/app/todo/${CARD_ID}`);
  await expect(page.getByTestId('transcript-col')).toBeVisible();
  await expect(page.locator('.turn-rail-frame')).toBeVisible();
  const vp = page.getByTestId('transcript-col');
  // 先滚到末
  await vp.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(400);
  const wasAtBottom = await vp.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 10);
  expect(wasAtBottom).toBe(true);
  // 跳回第一刻
  await page.locator('.turn-rail-mark').nth(0).click({ force: true });
  await page.waitForTimeout(600);
  const topNow = await vp.evaluate((el) => el.scrollTop);
  expect(topNow).toBeLessThan(150);
});

test('T3: 悬停弹预览卡，离开退场', async ({ page }) => {
  await stubWorld(page, SIX);
  await page.goto(`/app/todo/${CARD_ID}`);
  await expect(page.getByTestId('transcript-col')).toBeVisible();
  await page.locator('.turn-rail-mark').nth(1).hover({ force: true });
  const preview = page.locator('.turn-rail-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('.turn-rail-preview-prompt')).toContainText('第 2 轮');
  // 离开 rail → 预览退：真实蛇移远离 rail 框
  await page.mouse.move(10, 10);
  await expect(preview).toHaveCount(0);
});
