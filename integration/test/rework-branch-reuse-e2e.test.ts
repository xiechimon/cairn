import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { join, resolve } from 'node:path';
import {
  appendPlanLocationNote,
  buildRestartPrompt,
  buildReviewRejectPrompt,
  buildTaskPromptText,
  composeTaskPromptWithInstruction,
  conversationBranch,
  PLAN_FILE_NAME,
} from '@cairn/shared';
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
import { makeTestTempDir } from '../../scripts/test-tmpdir.mjs';
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

const EVIDENCE_ROOT = process.env.CAIRN_IT_EVIDENCE
  ? resolve(import.meta.dirname, '../..', process.env.CAIRN_IT_EVIDENCE)
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
  home = makeTestTempDir('cairn-rework-reuse-home-');
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

async function branchCommitCount(bareDir: string, branch: string): Promise<number> {
  const r = await runGit(['rev-list', '--count', `refs/heads/${branch}`], {
    cwd: bareDir,
    timeoutMs: 10_000,
  });
  if (r.code !== 0) throw new Error(`rev-list failed: ${r.stderr}`);
  return Number(r.stdout.toString('utf8').trim());
}

describe('#931 both rework paths return to the original branch (E2E)', () => {
  test('failed restart and review reject: same conv / same branch / new commits land on the original branch / correct session shapes', async () => {
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

    await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 150_000);
    const confirmedRound1 = await api(server.url, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'confirm',
    });
    expect(confirmedRound1.status).toBe(202);
    await waitFor(() => server.todoPhase(world.todoId) === 'review', 150_000);
    server.db
      .update(buildTable)
      .set({ prUrl: PR_URL, prNumber: PR_NUMBER })
      .where(eq(buildTable.id, buildId))
      .run();

    const commitsAfterRound1 = await branchCommitCount(bareDir, branch);
    expect(commitsAfterRound1).toBeGreaterThanOrEqual(2);

    const reviewed = await api(server.url, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'review',
      agentId: AGENT_ID,
    });
    expect(reviewed.status).toBe(202);
    await waitFor(() => server.todoPhase(world.todoId) === 'failed', 150_000);
    const newSessionCountBefore = countLog(`new session ${buildId}`);

    const sent = await api(server.url, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'restart',
      feedback: FEEDBACK,
      clientMessageId: 'cm-931-e2e',
    });
    expect(sent.status).toBe(202);

    const builds = server.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.todoId, world.todoId))
      .all();
    expect(builds).toHaveLength(1);
    const todoRow = server.db.select().from(todoTable).where(eq(todoTable.id, world.todoId)).get()!;
    expect(todoRow.latestBuildId).toBe(buildId);
    expect((await systemGitOps.listBranches(bareDir)).branches.map((b) => b.name).sort()).toEqual(
      ['main', branch].sort(),
    );
    const buildRow = server.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.prNumber).toBe(PR_NUMBER);
    expect(buildRow.prUrl).toBe(PR_URL);

    const rows = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    expect(rows.some((m) => m.role === 'user' && m.content === FEEDBACK)).toBe(true);
    expect(
      rows.some((m) => m.role === 'system' && String(m.content).includes(`PR #${PR_NUMBER}`)),
    ).toBe(true);

    await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 150_000);
    expect(countLog('返工新会话：工作区回退到分支头')).toBeGreaterThanOrEqual(1);
    expect(countLog(`new session ${buildId}`)).toBe(newSessionCountBefore + 1);

    const expectedReworkPrompt = appendPlanLocationNote(
      composeTaskPromptWithInstruction(TASK_TEXT, buildRestartPrompt(FEEDBACK)),
      join(paths.plansDir, buildId, PLAN_FILE_NAME),
    );
    expect(
      stub.requests.some((r) =>
        r.messages.some((m) => m.role === 'user' && userWireText(m) === expectedReworkPrompt),
      ),
    ).toBe(true);

    const commitsAfterReworkPlan = await branchCommitCount(bareDir, branch);
    expect(commitsAfterReworkPlan).toBeGreaterThan(commitsAfterRound1);
    const plans = server.db.select().from(planTable).where(eq(planTable.buildId, buildId)).all();
    expect(plans.map((p) => p.version).sort()).toEqual([1, 2]);

    const confirmed = await api(server.url, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'confirm',
    });
    expect(confirmed.status).toBe(202);
    await waitFor(() => server.todoPhase(world.todoId) === 'review', 150_000);
    const commitsAfterReworkBuild = await branchCommitCount(bareDir, branch);
    expect(commitsAfterReworkBuild).toBeGreaterThan(commitsAfterReworkPlan);

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
    ).toHaveLength(1);

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

    const commitsFinal = await branchCommitCount(bareDir, branch);
    expect(commitsFinal).toBeGreaterThan(commitsAfterRound1);
    expect(countLog('Worktree reused')).toBeGreaterThanOrEqual(2);

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
        `${logLines()
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
          .join('\n')}\n`,
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
