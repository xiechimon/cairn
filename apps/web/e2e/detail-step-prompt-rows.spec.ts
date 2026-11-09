import { mkdirSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

const TEAM_ID = 'team-1';
const USER_ID = 'user-1';
const AGENT_ID = 'agent-1';
const CARD_ID = 'todo-sp-1';
const BUILD_ID = 'build-sp-1';
const PROJECT_ID = 'proj-sp-1';

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

const BRANCH = 'cairn/conv-01a1b6f2-4b83-7c60-848b-c981f4cfcc51';
const BRANCH_NOTE = `[cairn 系统规则，不是用户的消息]工作分支注记：本步的工作分支是 ${BRANCH}。`;

const PREPUSH_LOG = [
  '[prepush] node scripts/english-only-gate.mjs',
  'english-only-gate: 0 line(s) with Chinese text',
  '[prepush] node scripts/public-content-gate.mjs',
  'public-content-gate: 0 offending added line(s)',
  ...Array.from({ length: 120 }, (_, i) => `[prepush] vitest shard ${i + 1}/120 PASS`),
  '[prepush] node scripts/heavy-slots.test.mjs',
  '✖ an inherited slot variable that no live process holds is ignored',
  '[ELIFECYCLE] Command failed with exit code 1.',
  `error: failed to push some refs to 'https://github.com/xiechimon/cairn.git'`,
].join('\n');

const CI_FIX_PROMPT = [
  '[ci-fix] Local pre-push hook rejected the closing push (round 1/3).',
  '',
  PREPUSH_LOG,
  '',
  `Fix the hook failures and push the same branch ${BRANCH}. Do not create another branch or PR, bypass hooks, or merge the PR.`,
  BRANCH_NOTE,
].join('\n');

const FEEDBACK = '哪个分支';
const REWORK_PROMPT = [
  'Rework request on this same session: keep the plan, tests and branch you already have, address the feedback below, rerun the self-check and quote the new evidence, then call thread_report.',
  '',
  FEEDBACK,
  BRANCH_NOTE,
].join('\n');

const ANSWER = `工作分支是 \`${BRANCH}\`，本地提交 \`a1cfe71e8\` 还没推送。`;

function msg(id: string, role: 'system' | 'user' | 'assistant', content: unknown, at: number) {
  return { id, role, content, createdAt: at };
}

const MESSAGES = [
  msg('owner-1', 'user', FEEDBACK, 10_000),
  msg('user-step-rework', 'user', REWORK_PROMPT, 10_100),
  msg('answer-1', 'assistant', [{ type: 'text', text: ANSWER }], 10_200),
  msg('user-step-cifix', 'user', CI_FIX_PROMPT, 20_000),
  msg('answer-2', 'assistant', [{ type: 'text', text: '修好了 heavy-slots 的测试，推送已通过 pre-push。' }], 20_500),
];

const STEPS = [
  { id: 'step-rework', buildId: BUILD_ID, kind: 'session', machineId: null, createdAt: 10_050, status: 'done', promptOrigin: { kind: 'rework' } },
  {
    id: 'step-cifix',
    buildId: BUILD_ID,
    kind: 'session',
    machineId: null,
    createdAt: 19_000,
    status: 'done',
    promptOrigin: { kind: 'ci-fix', trigger: 'pre-push', round: 1, roundsMax: 3 },
  },
];

async function stubWorld(page: Page) {
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  const card = { ...WIRE_CARD, phase: 'review' };
  await page.route((url) => url.pathname.startsWith('/api/'), (route, request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') return route.fulfill(json({ error: 'e2e stub' }, 500));
    if (path === '/api/teams') return route.fulfill(json([TEAM]));
    if (path === '/api/user/me') return route.fulfill(json(USER));
    if (path === '/api/projects') return route.fulfill(json([PROJECT]));
    if (path === '/api/todos') return route.fulfill(json([card]));
    if (path === `/api/todos/${CARD_ID}`) return route.fulfill(json(card));
    if (path === `/api/teams/${TEAM_ID}/members`) {
      return route.fulfill(
        json([{ id: 'member-user', teamId: TEAM_ID, actorId: USER_ID, memberType: 'user', actor: USER }]),
      );
    }
    if (path === `/api/teams/${TEAM_ID}/notifications`) return route.fulfill(json({ unreadThreadIds: [] }));
    if (path === `/api/builds/${BUILD_ID}`) return route.fulfill(json(WIRE_BUILD));
    if (path === `/api/builds/${BUILD_ID}/steps`) return route.fulfill(json(STEPS));
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

test.use({ viewport: { width: 1280, height: 1400 } });
test.setTimeout(90_000);

const CI_FIX_LINE = 'CI 修复第 1/3 轮：推送前检查未通过';

test('a ci-fix prompt is one line with its log behind the raw-log control', async ({ page }) => {
  await stubWorld(page);
  const col = page.getByTestId('transcript-col');
  await expect(col.getByTestId('agent-text').filter({ hasText: '修好了' })).toBeVisible();
  await expect(page.getByTestId('user-bubble').filter({ hasText: '[ci-fix]' })).toHaveCount(0);
  await expect(col).not.toContainText('vitest shard');
  const row = page.getByTestId('transcript-step-prompt').filter({ hasText: CI_FIX_LINE });
  await expect(row).toHaveCount(1);
  expect((await row.boundingBox())?.height ?? 0).toBeLessThanOrEqual(32);
  await row.getByRole('button', { name: '查看原始日志' }).click();
  const raw = page.getByTestId('step-prompt-raw');
  await expect(raw).toContainText('[ci-fix] Local pre-push hook rejected the closing push (round 1/3).');
  await expect(raw).toContainText('vitest shard 120/120 PASS');
  await expect(page.getByRole('dialog')).toContainText('原始日志');
});

test('a rework prompt folds and the owner words stay a bubble', async ({ page }) => {
  await stubWorld(page);
  await expect(page.getByTestId('user-bubble')).toHaveText([FEEDBACK]);
  const row = page.getByTestId('transcript-step-prompt').filter({ hasText: '按反馈返工，继续本会话' });
  await expect(row).toHaveCount(1);
  await expect(page.getByTestId('transcript-col')).not.toContainText('Rework request on this same session');
  await row.getByRole('button', { name: '查看完整指令' }).click();
  await expect(page.getByTestId('step-prompt-raw')).toContainText('Rework request on this same session');
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: step prompt rows`, async ({ page }, testInfo) => {
    const dir = SHOT_DIR === '' ? testInfo.outputPath() : SHOT_DIR;
    mkdirSync(dir, { recursive: true });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await stubWorld(page);
    await page.evaluate((light) => document.documentElement.classList.toggle('light', light), theme === 'light');
    await page.mouse.move(0, 0);
    const col = page.getByTestId('transcript-col');
    await expect(col.getByTestId('agent-text').filter({ hasText: '修好了' })).toBeVisible();
    await col.evaluate((root) => {
      for (const el of root.querySelectorAll('*')) if (el.scrollHeight > el.clientHeight + 1) el.scrollTop = 0;
    });
    await col.screenshot({ path: `${dir}/${SHOT_LABEL}-${theme}.png` });
    const button = page.getByRole('button', { name: '查看原始日志' });
    await button.hover();
    expect(await button.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
    await button.click();
    await expect(page.getByTestId('step-prompt-raw')).toBeVisible();
    await page.screenshot({ path: `${dir}/${SHOT_LABEL}-${theme}-raw-log.png` });
  });
}
