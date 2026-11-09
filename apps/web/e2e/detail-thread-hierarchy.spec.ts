import { mkdirSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

const TEAM_ID = 'team-1';
const USER_ID = 'user-1';
const AGENT_ID = 'agent-1';
const CARD_ID = 'todo-th-1';
const BUILD_ID = 'build-th-1';
const PROJECT_ID = 'proj-th-1';
const STEP_ID = 'step-th-2';

const SHOT_DIR = process.env.SHOT_DIR ?? '';
const SHOT_LABEL = process.env.SHOT_LABEL ?? 'shot';

const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: USER_ID, displayName: 'ian', avatarUrl: null };

const TITLE = '公开内容只用英文的提交闸门';
const SPEC = '在 pre-commit 和 prepush 里拦住非英文的公开内容。';

const WIRE_CARD = {
  id: CARD_ID,
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: TITLE,
  spec: SPEC,
  phase: 'building',
  phaseAt: 0,
  seqNum: 412,
  orderIndex: 0,
  tagIds: [],
  assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
  agent: { id: AGENT_ID, displayName: 'builder', avatarUrl: null },
  latestBuildId: BUILD_ID,
  lastRunAt: 0,
  hasChanges: true,
  hasPlan: false,
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
  githubRepo: 'xiechimon/cairn',
  localPath: null,
};

const WIRE_BUILD = {
  id: BUILD_ID,
  todoId: CARD_ID,
  withPlan: false,
  prevPhase: null,
  triggerSource: 'user',
  planDocId: null,
  errorMessage: null,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: 0,
};

const GIT_ERROR = [
  'git commit failed (exit 1): On branch cairn/conv-01a1b6f2-4b83-7c60-848b-c981f4cfcc51',
  "Your branch and 'origin/main' have diverged,",
  'and have 1 and 62 different commits each, respectively.',
  '',
  'Changes not staged for commit:',
  '  (use "git add <file>..." to update what will be committed)',
  '  (use "git restore <file>..." to discard changes in working directory)',
  '\tmodified:   pnpm-lock.yaml',
  '',
  'no changes added to commit (use "git add" and/or "git commit -a")',
].join('\n');

const FILES = [
  '.husky/pre-commit',
  'scripts/prepush.mjs',
  'scripts/prepush.test.mjs',
  'scripts/public-content-allowlist.json',
  'scripts/public-content-gate.mjs',
  'scripts/public-content-gate.test.mjs',
];
const COMMIT = 'a1cfe71e8377706ddd9aff08a6e90f97b7b40d8a';

let msgSeq = 0;
function msg(role: 'system' | 'user' | 'assistant', content: unknown, at: number) {
  msgSeq += 1;
  return { id: `msg-${msgSeq}`, role, content, createdAt: at };
}

function call(id: string, name: string, args: Record<string, unknown>, result: string, isError = false) {
  return {
    kind: 'toolcall',
    call: { id, name, arguments: args, result, ...(isError ? { isError: true } : {}), startedAt: 0, endedAt: 100 },
  };
}

const HOOK_ROW = [
  '.agents/resume hook ok (2589ms)',
  'Scope: all 7 workspace projects',
  '✓ Lockfile passes supply-chain policies (verified 2d ago)',
  'Lockfile is up to date, resolution step is skipped',
  'Done in 859ms using pnpm v12.5.1',
].join('\n');

const FALLBACK_REPORT = [
  '构建步兜底报告：本步异常结束，以下由系统根据已知记录生成。',
  `- 失败原因：${GIT_ERROR}`,
  `- 已知改动：${FILES.length} 个文件（${FILES.join('、')}）`,
  `- Commit: ${COMMIT}`,
  '- PR：无',
  '- 下一步：看过失败原因后带反馈重跑。',
].join('\n');

const REWORK_NOTE = `返工回到本分支继续。上一轮失败原因：${GIT_ERROR}。`;

const ANSWER = [
  '**还没有 PR。[#3411](https://github.com/xiechimon/cairn/issues/3411) 是 issue，不是 PR。**',
  '',
  '刚重新查询了当前分支，PR 结果为空；实现目前只有本地提交 `a1cfe71e8`，尚未推送。',
].join('\n');

const MESSAGES = [
  msg('user', '哪个 pr', 10_000),
  msg('system', HOOK_ROW, 10_100),
  msg('system', 'git 凭据来源：integration（per-step 下发 token）', 10_200),
  msg(
    'assistant',
    call('pr-1', 'Bash', { command: 'gh pr list --head cairn/conv-01a1b6f2 --json number,url' }, '[]'),
    10_300,
  ),
  msg('assistant', call('mem-1', 'mcp__cairn__search_issues', { query: '3411' }, '#3411 issue: public content English-only gate'), 10_400),
  msg('assistant', [{ type: 'text', text: ANSWER }], 10_500),
  msg('system', FALLBACK_REPORT, 10_600),
  msg('system', REWORK_NOTE, 10_700),
  msg(
    'assistant',
    call(
      'st-1',
      'Bash',
      { command: 'git status --short; ls scripts/*public* scripts/*english*; git log --oneline -3' },
      ' M pnpm-lock.yaml\nscripts/public-content-gate.mjs',
    ),
    10_800,
  ),
  msg(
    'assistant',
    call(
      'rg-1',
      'Bash',
      { command: "rg -n 'public-content|english-only' scripts/prepush.mjs .husky/pre-commit" },
      'rg: .husky/pre-commit: No such file or directory (os error 2)',
      true,
    ),
    10_900,
  ),
];

async function stubWorld(page: Page) {
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route((url) => url.pathname.startsWith('/api/'), (route, request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') return route.fulfill(json({ error: 'e2e stub' }, 500));
    if (path === '/api/teams') return route.fulfill(json([TEAM]));
    if (path === '/api/user/me') return route.fulfill(json(USER));
    if (path === '/api/projects') return route.fulfill(json([PROJECT]));
    if (path === '/api/todos') return route.fulfill(json([WIRE_CARD]));
    if (path === `/api/todos/${CARD_ID}`) return route.fulfill(json(WIRE_CARD));
    if (path === `/api/teams/${TEAM_ID}/members`) {
      return route.fulfill(
        json([{ id: 'member-user', teamId: TEAM_ID, actorId: USER_ID, memberType: 'user', actor: USER }]),
      );
    }
    if (path === `/api/teams/${TEAM_ID}/notifications`) return route.fulfill(json({ unreadThreadIds: [] }));
    if (path === `/api/builds/${BUILD_ID}`) return route.fulfill(json(WIRE_BUILD));
    if (path === `/api/builds/${BUILD_ID}/steps`) {
      return route.fulfill(
        json([
          { id: 'step-th-1', buildId: BUILD_ID, kind: 'build', machineId: null, createdAt: 9_000, status: 'failed' },
          { id: STEP_ID, buildId: BUILD_ID, kind: 'build', machineId: null, createdAt: 10_650, status: 'claimed' },
        ]),
      );
    }
    if (path === `/api/builds/${BUILD_ID}/plans`) return route.fulfill(json([]));
    if (path === `/api/builds/${BUILD_ID}/usage`) return route.fulfill(json([]));
    if (path === `/api/builds/${BUILD_ID}/changes`) return route.fulfill(json({ files: [] }));
    if (path === `/api/conversations/${BUILD_ID}/messages`) {
      return route.fulfill(
        json({ messages: MESSAGES, chips: [], historyEpoch: 0, steerPending: [], activeRun: null, nextCursor: null }),
      );
    }
    return route.fulfill(json({ error: 'e2e stub: not the surface under test' }, 500));
  });
  await page.goto(`/app/todo/${CARD_ID}`);
  await expect(page.getByTestId('transcript-col')).toBeVisible({ timeout: 30_000 });
}

test.use({ viewport: { width: 1280, height: 2000 } });
test.setTimeout(90_000);

const DIVERGED = "Your branch and 'origin/main' have diverged";

test('the agent answer links its issue reference', async ({ page }) => {
  await stubWorld(page);
  const answer = page.getByTestId('agent-text').filter({ hasText: '还没有 PR' });
  await expect(answer.getByRole('link', { name: '#3411' })).toHaveAttribute(
    'href',
    'https://github.com/xiechimon/cairn/issues/3411',
  );
  await expect(answer).not.toContainText('](https://');
});

test('hook output and the credential line stay folded inside the work group', async ({ page }) => {
  await stubWorld(page);
  const col = page.getByTestId('transcript-col');
  await expect(col.getByTestId('agent-text').filter({ hasText: '还没有 PR' })).toBeVisible();
  await expect(col).not.toContainText('Scope: all 7 workspace projects');
  await expect(col).not.toContainText('git 凭据来源');
  await expect(page.getByTestId('transcript-note').filter({ hasText: 'hook' })).toHaveCount(0);
  const summary = page.getByTestId('work-summary').first();
  await expect(summary).toContainText('准备了工作区');
  await summary.click();
  await expect(page.locator('[data-trace-card]').first()).toContainText('.agents/resume hook');
});

test('the failure reason shows once, behind the raw-error control', async ({ page }) => {
  await stubWorld(page);
  const col = page.getByTestId('transcript-col');
  await expect(col).toContainText('本步异常结束：git commit failed (exit 1)');
  expect((await col.innerText()).split(DIVERGED).length - 1).toBe(0);
  await expect(page.getByTestId('transcript-note').filter({ hasText: '返工回到本分支继续' })).toHaveText(
    '返工回到本分支继续。',
  );
  await page.getByRole('button', { name: '查看原始错误' }).click();
  await expect(page.getByTestId('fail-raw-error')).toContainText(DIVERGED);
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: hovered rows stay flat`, async ({ page }, testInfo) => {
    const dir = SHOT_DIR === '' ? testInfo.outputPath() : SHOT_DIR;
    mkdirSync(dir, { recursive: true });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await stubWorld(page);
    await page.evaluate((light) => document.documentElement.classList.toggle('light', light), theme === 'light');
    await page.mouse.move(0, 0);
    const col = page.getByTestId('transcript-col');
    await col.evaluate((root) => {
      for (const el of root.querySelectorAll('*')) if (el.scrollHeight > el.clientHeight + 1) el.scrollTop = 0;
    });
    await col.screenshot({ path: `${dir}/${SHOT_LABEL}-${theme}.png` });
    const rawButton = page.getByRole('button', { name: '查看原始错误' });
    await rawButton.hover();
    expect(await rawButton.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
    await col.screenshot({ path: `${dir}/${SHOT_LABEL}-${theme}-hover-failure.png` });
    await rawButton.click();
    await expect(page.getByTestId('fail-raw-error')).toBeVisible();
    await page.screenshot({ path: `${dir}/${SHOT_LABEL}-${theme}-raw-error.png` });
    await page.keyboard.press('Escape');
    for (const summary of await page.getByTestId('work-summary').all()) {
      if ((await summary.getAttribute('aria-expanded')) !== 'true') await summary.click();
    }
    const row = page.locator('[data-trace-card] button').first();
    await row.hover();
    expect(await row.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
    await col.screenshot({ path: `${dir}/${SHOT_LABEL}-${theme}-expanded-hover-row.png` });
  });
}
