import { appendPlanLocationNote, buildPlanFirstRoundInstruction } from '@cairn/shared';
import { expect, type Page, test } from '@playwright/test';

const TEAM_ID = 'team-1';
const USER_ID = 'user-1';
const AGENT_ID = 'agent-1';
const CARD_ID = 'todo-uw-1';
const BUILD_ID = 'build-uw-1';
const PROJECT_ID = 'proj-uw-1';

const TITLE = '登录按钮圆角与悬停过渡';
const SPEC = [
  '# 任务目标',
  '',
  '把圆角改成 **8px**，并且：',
  '',
  '- 悬停态加过渡',
].join('\n');

const TASK_PROMPT = appendPlanLocationNote(
  `${TITLE}\n\n${SPEC}\n\n${buildPlanFirstRoundInstruction()}`,
  '/home/u/.cairn/plans/conv-uw-1/plan.md',
);

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

const STEER_MD = '按这个改：\n\n```css\n.login-btn { border-radius: 10px; }\n```';

let msgSeq = 0;
function msg(role: 'system' | 'user' | 'assistant', content: unknown, at: number) {
  msgSeq += 1;
  return { id: `msg-${msgSeq}`, role, content, createdAt: at };
}

const MESSAGES = [
  msg('user', TASK_PROMPT, 1000),
  msg('system', JSON.stringify({ kind: 'machine_selected', machineId: 'm1', name: 'mbp' }), 1100),
  msg('assistant', [{ type: 'text', text: '好的，方案已就绪。' }], 1200),
  msg('user', '方案已确认。请按方案执行，完成改动。', 1300),
  msg('user', '发起了 AI 审核', 1400),
  msg('user', STEER_MD, 1500),
  msg('user', '收到，谢谢', 1600),
  msg('assistant', [{ type: 'text', text: '已完成修改。' }], 1700),
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

test('1. task text appears exactly once: the description area carries it, the bubble does not repeat it (nesting fix)', async ({ page }) => {
  await stubWorld(page);

  await expect(page.getByTestId('transcript-col').locator('section')).toContainText(
    '任务目标',
  );
  await expect(
    page.getByTestId('user-bubble').filter({ hasText: '任务目标' }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId('user-bubble').filter({ hasText: '把圆角改成' }),
  ).toHaveCount(0);

  await expect(
    page.getByTestId('user-bubble').filter({ hasText: '本步的交接物是' }),
  ).toHaveCount(0);
});

test('2. CONTINUE continuation prompts do not pose as user bubbles', async ({ page }) => {
  await stubWorld(page);
  await expect(
    page.getByTestId('user-bubble').filter({ hasText: '方案已确认' }),
  ).toHaveCount(0);
});

test('3. review announcement row = note family (same shape as `发起了合并`), not a bubble', async ({ page }) => {
  await stubWorld(page);
  await expect(
    page.getByTestId('user-bubble').filter({ hasText: '发起了 AI 审核' }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId('transcript-note').filter({ hasText: 'Xmon Dai 发起了 AI 审核' }),
  ).toBeVisible();
});

test('4. real steer utterances go through markdown: fences become code blocks, literal ``` does not leak', async ({ page }) => {
  await stubWorld(page);
  const bubbles = page.getByTestId('user-bubble');
  await expect(bubbles).toHaveCount(2);
  const md = bubbles.first();
  await expect(md).toHaveAttribute('data-md', 'true');
  await expect(md.getByTestId('md-code')).toContainText('border-radius: 10px');
  await expect(md).not.toContainText('```');
});

test('5. a one-line message keeps the 32px bubble height (no geometry drift)', async ({ page }) => {
  await stubWorld(page);
  const short = page.getByTestId('user-bubble').filter({ hasText: '收到，谢谢' });
  await expect(short).toBeVisible();
  const box = await short.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { h: Math.round(r.height), font: getComputedStyle(el).fontSize };
  });
  expect(box.h).toBe(32);
  expect(box.font).toBe('14px');
});

test('6. taskline does not mis-attach: after the task text row retires no #seq row residue remains', async ({ page }) => {
  await stubWorld(page);
  await expect(page.getByTestId('taskline')).toHaveCount(0);
});
