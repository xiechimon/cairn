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

function call(id: string, name: string, args: Record<string, unknown>, result?: string, duration?: number) {
  return { kind: 'toolcall', call: { id, name, arguments: args, ...(result === undefined ? {} : { result }), ...(duration === undefined ? {} : { startedAt: 2000, endedAt: 2000 + duration }) } };
}

const MESSAGES = [
  msg('user', TASK_PROMPT, 1000),
  msg('assistant', [{ type: 'thinking', thinking: LONG_THINKING }], 1100),
  msg('assistant', call('read-1', 'Read', { file_path: '/home/user/.pacman-chief/workspaces/run-1/src/main.ts', offset: 10, limit: 20 }, 'export const ready = true;', 1250), 2400),
  msg('assistant', call('search-1', 'Bash', { command: 'rg ready src', description: 'Find readiness checks' }, 'src/main.ts:1:ready', 2300), 4700),
  msg('assistant', call('run-1', 'Bash', { command: 'pnpm test', description: 'Verify changes' }, Array.from({ length: 45 }, (_, i) => `output line ${i + 1}`).join('\n'), 12000), 16700),
  msg('assistant', { kind: 'toolcall', call: { id: 'edit-0', name: 'Edit', arguments: { file_path: 'src/other.ts', old_string: 'missing line', new_string: 'replacement' }, result: 'old_string not found in src/other.ts', isError: true, startedAt: 2000, endedAt: 2400 } }, 17000),
  msg('assistant', call('edit-1', 'Edit', { file_path: '/home/user/.pacman-chief/workspaces/run-1/src/main.ts', old_string: 'old line', new_string: 'new line\nsecond line' }, 'updated', 1500), 18200),
  msg('assistant', call('tool-1', 'mcp__docs__lookup', { query: 'ready' }, 'reference found', 1000), 19200),
  msg('assistant', [{ type: 'text', text: 'The checks passed.' }], 20000),
  msg('assistant', [{ type: 'thinking', thinking: 'Check the final output.' }], 21000),
  msg('assistant', call('running-1', 'Bash', { command: 'pnpm lint', description: 'Check formatting' }), 22000),
];

async function stubWorld(page: Page, stepStatus: 'claimed' | 'stopped' = 'claimed') {
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
      if (path === `/api/builds/${BUILD_ID}/steps`)
        return route.fulfill(
          json([
            {
              id: 'step-tr-1',
              buildId: BUILD_ID,
              kind: 'build',
              machineId: null,
              createdAt: 1000,
              status: stepStatus,
            },
          ]),
        );
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

test('work groups consecutive thinking and calls, with only the last block expanded', async ({ page }) => {
  await stubWorld(page);
  const summaries = page.getByTestId('work-summary');
  await expect(summaries).toHaveCount(2);
  await expect(summaries.first()).toContainText('思考 1 次');
  await expect(summaries.first()).toContainText('读了 1 个文件');
  await expect(summaries.first()).toContainText('搜索 1 次');
  await expect(summaries.first()).toContainText('跑了 1 条命令');
  await expect(summaries.first()).toContainText('改了 2 个文件');
  await expect(summaries.first()).toContainText('调用 1 个工具');
  await expect(summaries.first()).toHaveAttribute('aria-expanded', 'false');
  await expect(summaries.last()).toHaveAttribute('aria-expanded', 'true');
  await summaries.first().click();
  const block = page.getByTestId('work-block').first();
  const read = block.getByTestId('work-call').first();
  await expect(read).toContainText('读');
  await expect(read).toContainText('src/main.ts L10–29');
  await expect(read).toContainText('1.3s');
  await expect(read).not.toContainText('/home/user');
  await read.click();
  await expect(block.getByTestId('tool-output')).toContainText('export const ready = true;');
  await block.getByTestId('work-think').click();
  await expect(block.getByTestId('thinking-body')).toHaveText(LONG_THINKING);
  await expect(page.getByTestId('work-block').last().getByTestId('work-spinner')).toBeVisible();
});

test('call details preserve commands, cap output and show edit lines', async ({ page }) => {
  await stubWorld(page);
  await page.getByTestId('work-summary').first().click();
  const block = page.getByTestId('work-block').first();
  const run = block.getByTestId('work-call').filter({ hasText: 'Verify changes' });
  await expect(run).toContainText('pnpm test');
  await expect(run).toContainText('12s');
  await run.click();
  const output = block.getByTestId('tool-output');
  await expect(block.locator('.work-code-header')).toContainText('$ pnpm test');
  await expect(output).toContainText('output line 40');
  await expect(output).not.toContainText('output line 41');
  await expect(block).toContainText('还有 5 行');
  const edit = block.getByTestId('work-call').filter({ hasText: 'src/main.ts' }).last();
  await expect(edit).toContainText('+2');
  await expect(edit).toContainText('−1');
  await edit.click();
  await expect(block.getByTestId('tool-output').last()).toContainText('old line');
  await expect(block.getByTestId('tool-output').last()).toContainText('new line');
  await expect(block.getByTestId('work-call').last()).toContainText('docs · lookup');
  const failed = block.getByTestId('work-call').filter({ hasText: 'src/other.ts' });
  await expect(failed.getByLabel('失败')).toBeVisible();
  await failed.click();
  await expect(block.getByTestId('edit-error')).toHaveText('old_string not found in src/other.ts');
});

test('a call cut off by a stopped run shows as unfinished, not done', async ({ page }) => {
  await stubWorld(page, 'stopped');
  const cut = page.getByTestId('work-call').filter({ hasText: 'Check formatting' });
  await expect(cut.getByTestId('work-unfinished')).toBeVisible();
  await expect(cut.getByLabel('已完成')).toHaveCount(0);
  await expect(page.getByTestId('work-spinner')).toHaveCount(0);
});

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`history does not animate on first render (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await stubWorld(page);
    await expect(page.getByTestId('work-call').last()).toBeVisible();
    await expect(page.locator('.work-enter')).toHaveCount(0);
    const animations = await page.getByTestId('work-block').last().evaluate((el) =>
      el.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY).length,
    );
    expect(animations).toBe(0);
  });
}

test('a long summary stays on one line in a narrow column and keeps the full text in its title', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 732 });
  await stubWorld(page);
  const summary = page.getByTestId('work-summary').first();
  const text = summary.locator('span[title]');
  await expect(text).toHaveAttribute('title', /思考 1 次.*调用 1 个工具/);
  const box = await text.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    lineHeight: Number.parseFloat(getComputedStyle(el).lineHeight),
  }));
  expect(box.height).toBeLessThanOrEqual(box.lineHeight + 1);
});
