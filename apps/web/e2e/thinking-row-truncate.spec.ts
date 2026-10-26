import { expect, type Page, test } from '@playwright/test';

const TEAM_ID = 'team-1';
const USER_ID = 'user-1';
const AGENT_ID = 'agent-1';
const CARD_ID = 'todo-tr-1';
const BUILD_ID = 'build-tr-1';
const PROJECT_ID = 'proj-tr-1';

const TITLE = '凭证链路巡检';
const SPEC = ['# 任务目标', '', '巡检凭证链路并给出报告。'].join('\n');
const TASK_PROMPT = `${TITLE}\n\n${SPEC}`;

const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: USER_ID, displayName: 'Xmon Dai', avatarUrl: null };

const WIRE_CARD = {
  id: CARD_ID,
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: TITLE,
  spec: SPEC,
  phase: 'review',
  phaseAt: 0,
  seqNum: 9,
  orderIndex: 0,
  tagIds: [],
  assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
  agent: { id: AGENT_ID, displayName: 'live-builder', avatarUrl: null },
  latestBuildId: BUILD_ID,
  lastRunAt: 0,
  hasChanges: true,
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

const LONG_THINKING =
  '用户这句「你好」是纯招呼，没有任务实体：先不路由看板，也不建卡。接下来要做的事分三步——第一步核对会话历史里有没有未收口的执行步，第二步看定时器有没有到点要唤起的复盘，第三步再判断这句招呼背后是不是藏着一个新需求的开头；如果三步都空，就只回一句招呼，等用户把真实意图说出来再动手。另外留意中英混排时省略号的落点，别让截断把行尾标点吃掉半个，视觉上会显得字被切坏而不是被收纳。';

let msgSeq = 0;
function msg(role: 'system' | 'user' | 'assistant', content: unknown, at: number) {
  msgSeq += 1;
  return { id: `msg-${msgSeq}`, role, content, createdAt: at };
}

const MESSAGES = [
  msg('user', TASK_PROMPT, 1000),
  msg('assistant', [{ type: 'thinking', thinking: LONG_THINKING }], 1100),
];

async function stubWorld(page: Page) {
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/api/**', (route, request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === 'GET') {
      if (path === '/api/teams') return route.fulfill(json([TEAM]));
      if (path === '/api/user/me') return route.fulfill(json(USER));
      if (path === '/api/projects') return route.fulfill(json([PROJECT]));
      if (path === '/api/todos') return route.fulfill(json([WIRE_CARD]));
      if (path === `/api/todos/${CARD_ID}`) return route.fulfill(json(WIRE_CARD));
      if (path === `/api/teams/${TEAM_ID}/members`) {
        return route.fulfill(json([
          { id: 'member-user', teamId: TEAM_ID, actorId: USER_ID, memberType: 'user', actor: USER },
          {
            id: `member-${AGENT_ID}`,
            teamId: TEAM_ID,
            actorId: AGENT_ID,
            memberType: 'agent',
            actor: {
              id: AGENT_ID,
              displayName: 'live-builder',
              description: null,
              status: 'active',
              avatarUrl: null,
              provider: null,
              modelId: 'stub-model',
              thinkingLevel: null,
              tools: [],
              secrets: [],
              defaultSkill: null,
              skillsAllowlist: null,
              mcpServers: [],
            },
          },
        ]));
      }
      if (path === `/api/teams/${TEAM_ID}/notifications`) {
        return route.fulfill(json({ unreadThreadIds: [] }));
      }
      if (path === `/api/builds/${BUILD_ID}`) return route.fulfill(json(WIRE_BUILD));
      if (path === `/api/builds/${BUILD_ID}/steps`) return route.fulfill(json([]));
      if (path === `/api/builds/${BUILD_ID}/plans`) return route.fulfill(json([]));
      if (path === `/api/builds/${BUILD_ID}/usage`) return route.fulfill(json([]));
      if (path === `/api/builds/${BUILD_ID}/changes`) {
        return route.fulfill(json({ files: [] }));
      }
      if (path === `/api/conversations/${BUILD_ID}/messages`) {
        return route.fulfill(
          json({
            messages: MESSAGES,
            chips: [],
            historyEpoch: 0,
            steerPending: [],
            activeRun: null,
            nextCursor: null,
          }),
        );
      }
      return route.fulfill(json({ error: 'e2e stub: not the surface under test' }, 500));
    }
    return route.fulfill(json({ error: 'e2e stub: not the surface under test' }, 500));
  });
  await page.goto(`/app/todo/${CARD_ID}`);
  await expect(page.getByTestId('transcript-col')).toBeVisible();
}

function thinkingRow(page: Page) {
  return page.getByTestId('work-think');
}

test('T1: thinking shares a work block with a compact row and no avatar overlap', async ({ page }) => {
  await stubWorld(page);
  const row = thinkingRow(page);
  await expect(row).toHaveCount(1);
  const height = await row.evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBeGreaterThanOrEqual(26);
  expect(height).toBeLessThanOrEqual(28);
  await expect(page.getByTestId('work-summary')).toContainText('思考 1 次');
});

test('T2: the work block stays inside the transcript width', async ({ page }) => {
  await stubWorld(page);
  const bounds = await page.getByTestId('work-block').evaluate((el) => {
    const col = el.closest('[data-testid="transcript-col"]')!;
    return { right: el.getBoundingClientRect().right, columnRight: col.getBoundingClientRect().right };
  });
  expect(bounds.right).toBeLessThanOrEqual(bounds.columnRight);
});

test('T3: the long preview stays on one line and hides while full thinking is open', async ({ page }) => {
  await stubWorld(page);
  const row = thinkingRow(page);
  await expect(page.getByTestId('thinking-body')).toHaveCount(0);
  const collapsedHeight = await row.evaluate((el) => el.getBoundingClientRect().height);
  expect(collapsedHeight).toBeLessThanOrEqual(28);
  await row.click();
  await expect(page.getByTestId('thinking-body')).toHaveText(LONG_THINKING);
  await expect(row.locator('.work-preview')).toBeHidden();
  await row.click();
  await expect(page.getByTestId('thinking-body')).toHaveCount(0);
});

test('T4: full thinking preserves whitespace without horizontal page overflow', async ({ page }) => {
  await stubWorld(page);
  await thinkingRow(page).click();
  await expect(page.getByTestId('thinking-body')).toHaveText(LONG_THINKING);
  expect(await page.getByTestId('thinking-body').evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre-wrap');
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(0);
});
