// #931 返工回原分支 E2E（真 server + 真 daemon + hosted bare repo + 门控
// stub LLM）：失败重启（带反馈）与审核关口打回两条返工路在同一 todo 上都
// 不再产出第二个 conversationId / 第二条分支；原分支收到新提交（PR 就地
// 更新的机制面 = conv 分支 push——PR 本体是 GitHub 侧对象，github 形态无法
// 在集成层真实克隆，PR 字段按 daemon 真实回填形状由测试直插模拟）。
// 失败方式（先于实现固化，AGENTS.md 测试规则 3）：
//  1. 失败重启另起 conv/分支/PR（本 bug 现状）→ restart 后 build 数、
//     conversationId、分支名、PR 字段四不变
//  2. 复用轮吃不到任务语境：新会话 prompt 必须是「任务全文 + 返工指令」
//     组合串（#720 形，不是光杆指令）
//  3. 上一轮残渣带进返工轮：fresh-session 步在 reused worktree 上必须回退
//     到分支头（canon 日志行钉机制触发）
//  4. 原分支收不到新提交：返工轮每个步收尾 push 后 conv 分支 sha 必须前进
//  5. revision 打回路换 conv：review 关口打回后 build 数仍一、重规划步在同
//     build 上、plan 版本递增不重置
//  6. 返工轮会话续接错误：restart 轮 new session、其后 revision 轮 continue
//     同一轮会话（`new session` 行数 + `continue session` canon 对账）

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  appendPlanLocationNote,
  buildRestartPrompt,
  buildReviewRejectPrompt,
  buildTaskPromptText,
  composeTaskPromptWithInstruction,
  conversationBranch,
  PLAN_FILE_NAME,
} from '@pacman/shared';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  build as buildTable,
  message as messageTable,
  plan as planTable,
  step as stepTable,
  todo as todoTable,
} from '../../apps/server/src/db/schema.js';
import { runGit, systemGitOps } from '../../apps/server/src/lib/git.js';
import {
  AGENT_ID,
  api,
  bootRealServer,
  daemonLogLines,
  type RealServer,
  seedWorld,
  waitFor,
} from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

const TASK_TITLE = 'README 图标探针';
const TASK_SPEC = '在 README.md 追加一行 rework probe line。';
const TASK_TEXT = buildTaskPromptText(TASK_TITLE, TASK_SPEC);
const FEEDBACK = '我要的是svg样式的';
const REJECT_FEEDBACK = '图标行改小一号';
const PR_NUMBER = 888;
const PR_URL = `https://github.com/demo-owner/demo-repo/pull/${PR_NUMBER}`;

const PLAN_V1 = [
  '# 方案 v1',
  '',
  'Context: 图标探针任务。',
  'Changes: README.md 追加一行。',
  'Edge cases: 无。',
  'Verification: 读回 README.md。',
].join('\n');
const PLAN_V2 = PLAN_V1.replace('# 方案 v1', '# 方案 v2');
const PLAN_V3 = PLAN_V1.replace('# 方案 v1', '# 方案 v3');

/** user wire 消息文本（openai 双形：纯 string 或 text parts 数组）。 */
function userWireText(m: { role: string; content?: unknown }): string | null {
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) {
    const parts = m.content.filter(
      (p): p is { type: 'text'; text: string } =>
        typeof p === 'object' && p !== null && (p as { type?: string }).type === 'text',
    );
    return parts.length > 0 ? parts.map((p) => p.text).join('') : null;
  }
  return null;
}

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

function countLog(line: string): number {
  return logLines().filter((l) => l.includes(line)).length;
}

/** 证据捕获（apps/web/e2e/evidence.ts 同律的 integration 形：opt-in env，
 * 未设 = no-op——回归跑不写跟踪路径）：
 *   PACMAN_IT_EVIDENCE=docs/verify/931 pnpm --filter integration exec vitest run \
 *   test/rework-branch-reuse-e2e.test.ts
 * 值从仓根 resolve（evidence.ts 同式），目录按需建。 */
const EVIDENCE_ROOT = process.env.PACMAN_IT_EVIDENCE
  ? resolve(import.meta.dirname, '../..', process.env.PACMAN_IT_EVIDENCE)
  : null;

function evidenceText(name: string, text: string): void {
  if (EVIDENCE_ROOT === null) return;
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  writeFileSync(join(EVIDENCE_ROOT, name), text);
}

function evidenceJson(name: string, data: unknown): void {
  evidenceText(name, `${JSON.stringify(data, null, 2)}\n`);
}

beforeAll(async () => {
  stub = await startStubLlm([
    // —— 第一轮：plan v1 → build v1 → review 400（失败面）——
    {
      toolCall: { name: 'bash', arguments: { command: `cat > plan.md <<'EOF'\n${PLAN_V1}\nEOF` } },
    },
    { content: '方案 v1 就绪。' },
    {
      toolCall: {
        name: 'bash',
        arguments: { command: 'printf "rework probe line\\n" >> README.md' },
      },
    },
    { content: '改动完成。' },
    { status: 400 },
    // —— 返工轮（restart 复用）：plan v2 → build v2 ——
    {
      toolCall: { name: 'bash', arguments: { command: `cat > plan.md <<'EOF'\n${PLAN_V2}\nEOF` } },
    },
    { content: '按反馈调整为 v2。' },
    {
      toolCall: {
        name: 'bash',
        arguments: { command: 'printf "rework probe line v2\\n" >> README.md' },
      },
    },
    { content: '返工改动完成。' },
    // —— 打回轮（revision 同分支）：plan v3 ——
    {
      toolCall: { name: 'bash', arguments: { command: `cat > plan.md <<'EOF'\n${PLAN_V3}\nEOF` } },
    },
    { content: '按打回意见调整为 v3。' },
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试执行 Agent：按任务要求用 bash 工具完成文件改动，然后简短汇报。',
  });
  home = mkdtempSync(join(tmpdir(), 'pacman-rework-reuse-home-'));
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'rework-reuse-mbp',
    },
    {},
  );
  paths = statePaths(config.home, config.workspacesDir);
  const logger = createDaemonLogger({ logFile: paths.daemonLog });
  handle = await runMachine({
    config,
    paths,
    logger,
    idleSleepPrevention: false,
    proxyEnv: {},
    claimBackoffBaseMs: 50,
    heartbeatIntervalMs: 500,
  });
  await waitFor(() => logLines().includes('[wake] push channel connected'), 30_000);
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  if (home) rmSync(home, { recursive: true, force: true });
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${logLines().slice(-60).join('\n')}\n`,
  );
});

/** conv 分支在 bare repo 上的提交数（「原 PR 收到新提交」的真值面）。 */
async function branchCommitCount(bareDir: string, branch: string): Promise<number> {
  const r = await runGit(['rev-list', '--count', `refs/heads/${branch}`], {
    cwd: bareDir,
    timeoutMs: 10_000,
  });
  if (r.code !== 0) throw new Error(`rev-list failed: ${r.stderr}`);
  return Number(r.stdout.toString('utf8').trim());
}

describe('#931 两条返工路回原分支（E2E）', () => {
  test('失败重启与审核打回：同 conv / 同分支 / 新提交落原分支 / 会话形态正确', async () => {
    const world = await seedWorld(
      server.url,
      server.teamId,
      { title: TASK_TITLE, spec: TASK_SPEC },
      { repoKind: 'hosted', projectName: 'rework-lifecycle' },
    );
    const bareDir = join(server.reposDir, server.teamId, 'rework-lifecycle.git');
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    expect(started.status).toBe(201);
    const buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;
    const branch = conversationBranch(buildId);

    // —— 第一轮：plan v1 → 确认 → build v1 → review ——
    await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 150_000);
    const confirmedRound1 = await api(server.url, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'confirm',
    });
    expect(confirmedRound1.status).toBe(202);
    await waitFor(() => server.todoPhase(world.todoId) === 'review', 150_000);
    // PR 字段直插（github 世界里 daemon 探测回填的落库形状；hosted 世界无探测，
    // 由测试模拟「已产 PR 的 build」——复用判定的输入面）。
    server.db
      .update(buildTable)
      .set({ prUrl: PR_URL, prNumber: PR_NUMBER })
      .where(eq(buildTable.id, buildId))
      .run();

    const commitsAfterRound1 = await branchCommitCount(bareDir, branch);
    expect(commitsAfterRound1).toBeGreaterThanOrEqual(2); // plan + build 步双提交

    // 失败面：review 步 400 → todo failed（票面事故同形：build 腿已交付、审核死）。
    const reviewed = await api(server.url, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'review',
      agentId: AGENT_ID,
    });
    expect(reviewed.status).toBe(202);
    await waitFor(() => server.todoPhase(world.todoId) === 'failed', 150_000);
    const newSessionCountBefore = countLog(`new session ${buildId}`);

    // —— 返工路 1：失败带反馈重启 → 必须复用原 conv/分支/PR ——
    const sent = await api(server.url, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'restart',
      feedback: FEEDBACK,
      clientMessageId: 'cm-931-e2e',
    });
    expect(sent.status).toBe(202);

    // 失败方式 1：四不变（build 数 / conversationId / 分支 / PR 字段）。
    const builds = server.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.todoId, world.todoId))
      .all();
    expect(builds).toHaveLength(1);
    const todoRow = server.db.select().from(todoTable).where(eq(todoTable.id, world.todoId)).get()!;
    expect(todoRow.latestBuildId).toBe(buildId);
    expect((await systemGitOps.listBranches(bareDir)).branches.map((b) => b.name)).toEqual([
      'main',
      branch,
    ]); // 无第二条 conv 分支
    const buildRow = server.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.prNumber).toBe(PR_NUMBER);
    expect(buildRow.prUrl).toBe(PR_URL);

    // 反馈行 + 轮界 note 落同一 conv。
    const rows = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    expect(rows.some((m) => m.role === 'user' && m.content === FEEDBACK)).toBe(true);
    expect(
      rows.some((m) => m.role === 'system' && String(m.content).includes(`PR #${PR_NUMBER}`)),
    ).toBe(true);

    // 失败方式 3：fresh-session 步在 reused worktree 上回退到分支头（机制 canon）。
    await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 150_000);
    expect(countLog('返工新会话：工作区回退到分支头')).toBeGreaterThanOrEqual(1);
    // 失败方式 6：restart 轮是 new session（不是续接旧会话）。
    expect(countLog(`new session ${buildId}`)).toBe(newSessionCountBefore + 1);

    // 失败方式 2：新会话首条 user = 任务全文 + 返工指令组合串（#720 形）；
    // #1203：restart 复用轮首步是 plan 步，daemon 投递串尾部附 plan.md 交接
    // 位置注记行（路径 = daemon home 的 plans 面，conv id = build id）。
    const expectedReworkPrompt = appendPlanLocationNote(
      composeTaskPromptWithInstruction(TASK_TEXT, buildRestartPrompt(FEEDBACK)),
      join(paths.plansDir, buildId, PLAN_FILE_NAME),
    );
    expect(
      stub.requests.some((r) =>
        r.messages.some((m) => m.role === 'user' && userWireText(m) === expectedReworkPrompt),
      ),
    ).toBe(true);

    // 失败方式 4：返工轮步收尾 push → 原分支收到新提交（PR 就地更新的机制面）。
    const commitsAfterReworkPlan = await branchCommitCount(bareDir, branch);
    expect(commitsAfterReworkPlan).toBeGreaterThan(commitsAfterRound1);
    // plan 版本递增不重置（v2 落库）。
    const plans = server.db.select().from(planTable).where(eq(planTable.buildId, buildId)).all();
    expect(plans.map((p) => p.version).sort()).toEqual([1, 2]);

    // —— 返工轮执行：confirm → build v2 → review ——
    const confirmed = await api(server.url, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'confirm',
    });
    expect(confirmed.status).toBe(202);
    await waitFor(() => server.todoPhase(world.todoId) === 'review', 150_000);
    const commitsAfterReworkBuild = await branchCommitCount(bareDir, branch);
    expect(commitsAfterReworkBuild).toBeGreaterThan(commitsAfterReworkPlan);

    // —— 返工路 2：审核关口打回 → 仍同 build 同 conv，重规划步 continue 会话 ——
    const continueCountBefore = countLog(`continue session ${buildId}`);
    const rejected = await api(server.url, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'revision',
      side: 'plan',
      feedback: REJECT_FEEDBACK,
      clientMessageId: 'cm-931-e2e-rev',
    });
    expect(rejected.status).toBe(202);
    expect(
      server.db.select().from(buildTable).where(eq(buildTable.todoId, world.todoId)).all(),
    ).toHaveLength(1); // 失败方式 5：打回不换 build

    // 打回轮重规划步（continue session 同 conv 会话）→ plan v3。
    await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 150_000);
    expect(countLog(`continue session ${buildId}`)).toBeGreaterThan(continueCountBefore);
    const plansFinal = server.db
      .select()
      .from(planTable)
      .where(eq(planTable.buildId, buildId))
      .all();
    expect(plansFinal.map((p) => p.version).sort()).toEqual([1, 2, 3]);
    const replanStep = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, buildId))
      .orderBy(asc(stepTable.createdAt))
      .all()
      .filter((st) => st.kind === 'plan')
      .at(-1)!;
    expect(replanStep.prompt).toBe(buildReviewRejectPrompt(REJECT_FEEDBACK));

    // 终态对账：conv 分支最终提交数 > 第一轮（两条返工路的提交都落原分支）。
    const commitsFinal = await branchCommitCount(bareDir, branch);
    expect(commitsFinal).toBeGreaterThan(commitsAfterRound1);
    // worktree 目录 = conversationId（02 §5.5 契约，复用轮共用同目录）。
    expect(countLog('Worktree reused')).toBeGreaterThanOrEqual(2);

    // —— 证据落盘（opt-in）：终态 DB / git / daemon canon / stub 请求面。——
    if (EVIDENCE_ROOT !== null) {
      const branchLog = await runGit(['log', '--oneline', '--decorate', `refs/heads/${branch}`], {
        cwd: bareDir,
        timeoutMs: 10_000,
      });
      evidenceJson(
        'todo.json',
        server.db.select().from(todoTable).where(eq(todoTable.id, world.todoId)).get(),
      );
      evidenceJson(
        'builds.json',
        server.db.select().from(buildTable).where(eq(buildTable.todoId, world.todoId)).all(),
      );
      evidenceJson(
        'steps.json',
        server.db
          .select()
          .from(stepTable)
          .where(eq(stepTable.buildId, buildId))
          .orderBy(asc(stepTable.createdAt))
          .all(),
      );
      evidenceJson(
        'messages.json',
        server.db
          .select()
          .from(messageTable)
          .where(eq(messageTable.conversationId, buildId))
          .all()
          .map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })),
      );
      evidenceJson(
        'plans.json',
        server.db
          .select()
          .from(planTable)
          .where(eq(planTable.buildId, buildId))
          .orderBy(asc(planTable.version))
          .all(),
      );
      evidenceText(
        'git-conv-branch.txt',
        `branch: ${branch}\ncommit count: ${commitsFinal}\n\n${branchLog.stdout.toString('utf8')}\n`,
      );
      evidenceText(
        'daemon-canon-lines.txt',
        logLines()
          .filter((l) =>
            [
              `step `,
              ` for conv ${buildId}`,
              'new session',
              'continue session',
              'pushed',
              'Worktree',
              '返工新会话',
              'using model',
              'finished',
            ].some((needle) => l.includes(needle)),
          )
          .join('\n') + '\n',
      );
      evidenceJson(
        'stub-user-prompts.json',
        stub.requests.map((r, i) => ({
          request: i + 1,
          userTexts: r.messages
            .filter((m) => m.role === 'user')
            .map((m) => userWireText(m))
            .filter((t): t is string => t !== null),
        })),
      );
    }
  }, 300_000);
});
