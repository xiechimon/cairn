// M3b demo（#80 票面）：单机全生命周期实跑 todo→done（02 §4.2 主时序 = E2E
// 脊柱）——新建 → 规划（plan.md 落库 v1 + worktree/分支落地 + push）→ 确认 →
// 执行（continue session + bash 真改文件 + commit/push + hasChanges git 真值）
// → 审核 → merge 202 delegated → 合并步（continue session + git merge
// --no-edit + server bare repo main fast-forward）→ done。
// 同测覆盖：worktree 契约对照 r3 §1.4/02 §5.5（目录名=conversationId、分支
// cairn/conv-*、基座 <projectId>/repo、pushed 日志行）、per-step 凭证不落盘
// （02 §8：git 凭证一次性发行/步收尾回收 + daemon home/worktree 无凭证残留
// 扫盘）、失败仅人工重跑（02/A6：provider 400 → failed → 无自动重跑 →
// POST builds 重跑 = 新 conv/新分支）。

import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  apiKey as apiKeyTable,
  build as buildTable,
  plan as planTable,
  step as stepTable,
  todo as todoTable,
  tokenUsage,
} from '../../apps/server/src/db/schema.js';
import { systemGitOps } from '../../apps/server/src/lib/git.js';
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

const PLAN_MD = [
  '# 方案',
  '',
  'Context: 探针任务，README 当前无探针行。',
  'Changes: 在 README.md 追加一行 m3b probe。',
  'Edge cases: 无。',
  'Verification: 读回 README.md 确认探针行在位。',
].join('\n');

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let world: { projectId: string; todoId: string };
let buildId = '';
let bareDir = '';

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

beforeAll(async () => {
  stub = await startStubLlm([
    // 规划步：bash 写 plan.md（pi 内建工具真执行）→ 收尾文本轮。
    {
      toolCall: {
        name: 'bash',
        arguments: { command: `cat > plan.md <<'EOF'\n${PLAN_MD}\nEOF` },
      },
    },
    { content: '方案已就绪：Context / Changes / Edge cases / Verification 四段完整。' },
    // 执行步：bash 追加 README 探针行 → 收尾文本轮。
    {
      toolCall: {
        name: 'bash',
        arguments: { command: 'printf "m3b probe line\\n" >> README.md' },
      },
    },
    { content: '修改已完成并验证通过：README.md 末行为 m3b probe line。' },
    // 合并步：文本轮（git merge 由 daemon 确定性执行，r3 §3.6 等价物）。
    { content: '合并已确认：分支改动已并入默认分支。' },
    // 失败语义轮：plan 步 provider 400（非可重试类——5xx 会被 pi 流级
    // auto_retry 吸收并重发请求，02 §4.2「自动重试仅 pi provider 流级」；
    // 步级失败无自动重跑面用不可重试错误隔离）。
    { status: 400 },
    // 人工重跑轮：正常规划（tool_call + 收尾）。
    {
      toolCall: {
        name: 'bash',
        arguments: { command: `cat > plan.md <<'EOF'\n${PLAN_MD}\nEOF` },
      },
    },
    { content: '重跑方案已就绪。' },
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试执行 Agent：按任务要求用 bash 工具完成文件改动，然后简短汇报。',
  });
  home = mkdtempSync(join(tmpdir(), 'cairn-m3b-home-'));
  const config = loadDaemonConfig(
    { serverUrl: server.url, apiKey: server.apiKey, teamId: server.teamId, home, name: 'm3b-mbp' },
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
  // 诊断面：daemon.log 尾部 + stub 请求消费位落 stdout（失败排障用）。
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${logLines().slice(-60).join('\n')}\n`,
  );
});

describe('M3b demo：单机全生命周期实跑 todo→done（02 §4.2 主时序）', () => {
  test('新建 → 规划：worktree 契约落地 + plan.md v1 落库 + push（r3 §1.4/§3.3）', async () => {
    world = await seedWorld(
      server.url,
      server.teamId,
      { title: 'M3b 生命周期探针', spec: '在 README.md 追加一行 m3b probe line。' },
      { repoKind: 'hosted', projectName: 'm3b-lifecycle' },
    );
    bareDir = join(server.reposDir, server.teamId, 'm3b-lifecycle.git');
    expect(existsSync(bareDir)).toBe(true);

    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    expect(started.status).toBe(201);
    buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 120_000);

    // —— buildId ≡ conversationId 收敛（CONTEXT.md 实体等式）：worktree 目录名
    // = conversationId = buildId；分支 = cairn/conv-<buildId>（02 §5.5）——
    const convDir = join(paths.workspacesDir, buildId);
    expect(existsSync(join(convDir, 'plan.md'))).toBe(true);
    const branch = `cairn/conv-${buildId}`;
    const branchSha = await systemGitOps.resolveCommit(bareDir, `refs/heads/${branch}`);
    expect(branchSha).toMatch(/^[0-9a-f]{40}$/);
    // 基座布局 <workspacesRoot>/<projectId>/repo（02 §5.5 行 1）。
    expect(existsSync(join(paths.workspacesDir, world.projectId, 'repo', '.git'))).toBe(true);

    // push 已把 plan.md 带上远端 conv 分支（r3 §3.3 规划轮结束即 push）。
    const planOnRemote = await systemGitOps.readFileAt(bareDir, branchSha!, 'plan.md');
    expect(planOnRemote).not.toBeNull();
    expect(new TextDecoder().decode(planOnRemote!.content)).toContain('Context:');

    // —— plan.md 产物落库：plan v1 + build.planDocId（02 §4.2 plan 即文件）——
    const plans = server.db.select().from(planTable).where(eq(planTable.buildId, buildId)).all();
    expect(plans).toHaveLength(1);
    expect(plans[0]!.version).toBe(1);
    expect(plans[0]!.content).toContain('Changes:');
    const buildRow = server.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.planDocId).toBe(plans[0]!.id);
    const todoRow = server.db.select().from(todoTable).where(eq(todoTable.id, world.todoId)).get()!;
    expect(todoRow.hasPlan).toBe(true);

    // —— daemon.log canon 行（02 §5.5/§5.7 + r3 §1.4/§1.5）——
    const lines = logLines();
    for (const canon of [
      '[workspace] 准备工作区...',
      'Cloning',
      `pushed ${branch}`,
      `new session ${buildId}`,
    ]) {
      expect(
        lines.some((l) => l.includes(canon)),
        `missing canon line: ${canon}`,
      ).toBe(true);
    }

    // —— per-step git 凭证回收 + 不落盘（02 §8；push_credential 对照 r5 §3.1）——
    const stepRows = server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
    expect(stepRows.every((s) => s.status === 'done')).toBe(true);
    // 规划步 checkpointCommit = conv 分支 HEAD（「恢复到此处」数据面，r3 §3.5）。
    expect(stepRows[0]!.checkpointCommit).toBe(branchSha);
    const gitKeys = server.db
      .select()
      .from(apiKeyTable)
      .where(eq(apiKeyTable.gitAccess, true))
      .all();
    expect(gitKeys).toHaveLength(0); // 步收尾全部回收（一次性凭证生命周期）
    // 扫盘：daemon home 无凭证残留（credential.helper/password 串不入任何文件；
    // machine.json 只含机器 token——02 §5.3 形状）。
    const residue = scanForPattern(home, /credential\.helper|password=/);
    expect(residue).toEqual([]);
    // 基座 .git/config 无凭证位（凭证仅 per-command env 注入）。
    const gitConfig = readFileSync(
      join(paths.workspacesDir, world.projectId, 'repo', '.git', 'config'),
      'utf8',
    );
    expect(gitConfig).not.toContain('credential');
    expect(gitConfig).not.toContain('cairn_');
  }, 150_000);

  test('确认 → 执行：continue session + bash 真改动 → commit/push → review + hasChanges（git 真值）', async () => {
    const confirmed = await api(server.url, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'confirm',
    });
    expect(confirmed.status).toBe(202);
    try {
      await waitFor(() => server.todoPhase(world.todoId) === 'review', 120_000);
    } catch (err) {
      // 诊断面：卡住的 phase + build.errorMessage + 步状态一并抛出。
      const b = server.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get();
      const s = server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
      throw new Error(
        `${err instanceof Error ? err.message : err} | phase=${server.todoPhase(world.todoId)} buildErr=${b?.errorMessage ?? null} steps=${JSON.stringify(s.map((r) => [r.kind, r.status]))}`,
      );
    }

    expect(logLines().some((l) => l.includes(`continue session ${buildId}`))).toBe(true);

    // 远端 conv 分支 README 已带探针行（执行步 commit+push，02 §5.5 每步 push）。
    const branchSha = await systemGitOps.resolveCommit(bareDir, `refs/heads/cairn/conv-${buildId}`);
    const readme = await systemGitOps.readFileAt(bareDir, branchSha!, 'README.md');
    expect(readme).not.toBeNull();
    expect(new TextDecoder().decode(readme!.content)).toContain('m3b probe line');

    // hasChanges = git 真值（conv 分支领先 origin/main）→ todo 行同步。
    const todoRow = server.db.select().from(todoTable).where(eq(todoTable.id, world.todoId)).get()!;
    expect(todoRow.hasChanges).toBe(true);
    // 执行步 checkpoint 前移（≠ 规划步 checkpoint）。
    const steps = server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
    const buildStep = steps.find((s) => s.kind === 'build')!;
    expect(buildStep.checkpointCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(buildStep.checkpointCommit).not.toBe(
      steps.find((s) => s.kind === 'plan')!.checkpointCommit,
    );

    // transcript 工具行落库（bash 真执行回传，r3 §3.5 `> bash <命令>` 面）。
    const msgs = await api(server.url, 'GET', `/api/conversations/${buildId}/messages`);
    const messages = (msgs.body as { messages: { content: unknown }[] }).messages;
    expect(JSON.stringify(messages)).toContain('README.md');
  }, 150_000);

  test('审核 → merge 202 delegated → 合并步 → main fast-forward → done（02 §4.2/A6 + r3 §3.6）', async () => {
    const mergeRes = await api(server.url, 'POST', `/api/builds/${buildId}/merge`, {});
    expect(mergeRes.status).toBe(202);
    expect(mergeRes.body).toEqual({ delegated: true });

    await waitFor(() => server.todoPhase(world.todoId) === 'done', 120_000);

    // 服务端 main 验证（r3 §3.6 83 号同款）：GET file?path=README.md&ref=main。
    const mainFile = (
      await api(server.url, 'GET', `/api/projects/${world.projectId}/file?path=README.md&ref=main`)
    ).body as { content: string; commit: string };
    expect(mainFile.content).toContain('m3b probe line');

    // main = 合并步 done 回传 commit（fast-forward 落地键）。
    const steps = server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
    const mergeStep = steps.find((s) => s.kind === 'merge')!;
    expect(mergeStep.status).toBe('done');
    const mainSha = await systemGitOps.resolveCommit(bareDir, 'refs/heads/main');
    expect(mainSha).toBe(mergeStep.checkpointCommit);
    expect(mainSha).toBe(mainFile.commit);

    // 时间线（r3 §3.6）：「发起了合并」+ 合并结果行 + 🎉。
    const msgs = await api(server.url, 'GET', `/api/conversations/${buildId}/messages`);
    const flat = JSON.stringify((msgs.body as { messages: unknown[] }).messages);
    expect(flat).toContain('发起了合并');
    expect(flat).toContain('git merge origin/main 结果为');
    expect(flat).toContain('🎉 任务已完成');

    // token 记账 = 单行累加（build × model，02 §6.2；三步同模型）。
    const usage = server.db.select().from(tokenUsage).all();
    expect(usage).toHaveLength(1);
    expect(usage[0]!.buildId).toBe(buildId);
  }, 150_000);

  test('失败仅人工重跑（02/A6）：provider 400 → failed → 无自动重跑 → POST builds 重跑 = 新 conv/新分支', async () => {
    const world2 = await seedWorld(
      server.url,
      server.teamId,
      { title: 'M3b 失败探针', spec: '这个任务的第一轮会失败。' },
      { repoKind: 'hosted', projectName: 'm3b-failure' },
    );
    const started = await api(server.url, 'POST', `/api/projects/${world2.projectId}/builds`, {
      todoIds: [world2.todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    const failedBuildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(world2.todoId) === 'failed', 150_000);
    const buildRow = server.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.id, failedBuildId))
      .get()!;
    expect(buildRow.errorMessage).toBeTruthy();
    const failedStep = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, failedBuildId))
      .all();
    expect(failedStep).toHaveLength(1);
    expect(failedStep[0]!.status).toBe('failed');

    // 步级失败无自动重跑：静置窗口内无新 pending 步（02 §4.2）。
    await new Promise((r) => setTimeout(r, 2_500));
    const stepsAfter = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, failedBuildId))
      .all();
    expect(stepsAfter).toHaveLength(1);

    // 人工重跑 = POST builds → 新 build/新 conv/新分支（r3 §3.7）。
    const rerun = await api(server.url, 'POST', `/api/projects/${world2.projectId}/builds`, {
      todoIds: [world2.todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    expect(rerun.status).toBe(201);
    const rerunBuildId = (rerun.body as { builds: { id: string }[] }).builds[0]!.id;
    expect(rerunBuildId).not.toBe(failedBuildId);
    await waitFor(() => server.todoPhase(world2.todoId) === 'confirm', 120_000);
    // 新 conv 工作区 + 新分支（buildId ≡ conversationId 收敛面）。
    expect(existsSync(join(paths.workspacesDir, rerunBuildId, 'plan.md'))).toBe(true);
    const bareDir2 = join(server.reposDir, server.teamId, 'm3b-failure.git');
    const branch2 = await systemGitOps.resolveCommit(
      bareDir2,
      `refs/heads/cairn/conv-${rerunBuildId}`,
    );
    expect(branch2).toMatch(/^[0-9a-f]{40}$/);
    // 失败轮的旧 conv 目录仍在（工作保全分支语义，r3 §3.7 面板文案族）。
    expect(existsSync(join(paths.workspacesDir, failedBuildId))).toBe(true);
  }, 200_000);
});

/** 递归扫盘（跳过 pi 会话 jsonl 的大目录噪声可接受——全扫）。 */
function scanForPattern(dir: string, pattern: RegExp): string[] {
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (!entry.isFile()) continue;
      const st = statSync(p);
      if (st.size > 8 * 1024 * 1024) continue;
      try {
        if (pattern.test(readFileSync(p, 'utf8'))) hits.push(p);
      } catch {
        // 二进制/不可读文件跳过
      }
    }
  };
  walk(dir);
  return hits;
}
