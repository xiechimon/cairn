// #1262 E2E（真 server + 真 daemon + 真 git + stub LLM）：lint 失败提交的
// ANSI/OSC8 剥离全链。捕获侧（daemon done.errorMessage）是修复落点，这里实测
// 票面主诉场景——pre-commit 钩子输出彩色 biome 诊断（真实捕获样本，含 SGR +
// OSC8 超链接）→ git commit 失败 → daemon 捕获 stderr 原文 → done 上报 →
// server 落 build.errorMessage。失败方式（先于实现固化）：
//   E1 转义残留落库：build.errorMessage 含 \x1b 或 `]8;;`（板面几百行垃圾的
//      根因形）。
//   E2 首行不可读：剥离后首行不是「git commit failed (1): <file>:<line>:
//      <col> <rule>」形（验收 1）。
//   E3 假绿：钩子没触发（nothing-to-commit 提前 return false / 钩子路径
//      不通）→ 步 success，测试白跑——断言 status=failed 先钉住这条。
//   E4 语义误伤：干净错误文案路径被改（既有根因透传律回归）——由
//      runner-error-lifecycle 单测钉（本文件只测全链）。

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import { build as buildTable, step as stepTable } from '../../apps/server/src/db/schema.js';
import { AGENT_ID, api, bootRealServer, type RealServer, seedWorld, waitFor } from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

/** 真实 biome 彩色诊断样本（docs/verify/1262 捕获：--colors=force，含
 * SGR + OSC8 超链接对——规则名 lint/correctness/noUnusedVariables 带
 * biomejs.dev 链接）。钩子把它原样吐给 stderr = 用户库污染行的生成机制。 */
const BIOME_FIXTURE = fileURLToPath(new URL('./fixtures/biome-ansi-coloured.txt', import.meta.url));

/** 剥离后首行（git 前缀 + 诊断头）——验收 1 的「首行即文件:行号:规则」。 */
const EXPECTED_HEAD =
  'git commit failed (1): apps/daemon/test/1262-ansi-probe.ts:1:7 lint/correctness/noUnusedVariables';

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let todoId = '';
let buildId = '';

afterAll(async () => {
  // 诊断面：daemon.log 尾部 + todo 相位（失败排障用；m3b-demo 同律）——
  // 先取证再关栈（close 后 DB 不可读）。
  const diagPhase = todoId !== '' && server ? server.todoPhase(todoId) : 'n/a';
  const diagLog =
    home !== undefined && existsSync(paths.daemonLog)
      ? readFileSync(paths.daemonLog, 'utf8').split('\n').slice(-50).join('\n')
      : '(no log)';
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  process.stdout.write(`\n[diag] todo phase: ${diagPhase}\n[diag] daemon.log tail:\n${diagLog}\n`);
  if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

describe('#1262 E2E：lint 失败提交 → errorMessage 纯文本落库', () => {
  test('pre-commit 彩色 biome 输出 → failed → build.errorMessage 无转义、首行可读', async () => {
    stub = await startStubLlm([
      // build 步（withPlan:false 首步即 build）：bash 真改文件（脏树——
      // nothing-to-commit 提前 return false 会绕开 commit 抛错路径）+ 收尾轮。
      {
        toolCall: {
          name: 'bash',
          arguments: { command: 'printf "1262 probe\\n" >> README.md' },
        },
      },
      { content: '修改完成。' },
    ]);
    server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
    home = mkdtempSync(join(tmpdir(), 'cairn-1262-home-'));
    const config = loadDaemonConfig(
      {
        serverUrl: server.url,
        apiKey: server.apiKey,
        teamId: server.teamId,
        home,
        name: '1262-mbp',
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
    await waitFor(
      () =>
        existsSync(paths.daemonLog) &&
        readFileSync(paths.daemonLog, 'utf8').includes('[wake] push channel connected'),
      30_000,
    );

    const world = await seedWorld(
      server.url,
      server.teamId,
      { title: '1262 ANSI 探针', spec: '在 README.md 追加一行。' },
      { repoKind: 'hosted', projectName: 'ansi-lint-hook' },
    );
    todoId = world.todoId;

    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: null, build: { agentId: AGENT_ID } },
      withPlan: false,
    });
    expect(started.status).toBe(201);
    buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    // pre-commit 钩子装进 daemon 基座 clone 的 hooks/（worktree 与基座共享
    // common dir——git hooks 不随 clone 传播，托管 bare repo 的 hooks 对
    // daemon 不可达；基座 clone 在步 workspace 准备期落盘）。时机安全窗：
    // clone → stub 两轮响应 → commit，装钩子远早于 commit。cat 真实彩色
    // 诊断到 stderr + exit 1 = 用户库污染行的生成机制。
    const baseGitDir = join(paths.workspacesDir, world.projectId, 'repo', '.git');
    await waitFor(() => existsSync(baseGitDir), 60_000);
    const hookPath = join(baseGitDir, 'hooks', 'pre-commit');
    writeFileSync(hookPath, `#!/bin/sh\ncat "${BIOME_FIXTURE}" >&2\nexit 1\n`, { mode: 0o755 });
    chmodSync(hookPath, 0o755);

    await waitFor(() => server.todoPhase(todoId) === 'failed', 120_000);

    // E3 假绿先钉：钩子真触发、步真 failed（钩子路径不通时这里先红）。
    const steps = server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
    expect(steps.some((s) => s.status === 'failed')).toBe(true);

    const buildRow = server.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    // E1 转义残留：无 ESC、无 OSC8 痕。
    expect(buildRow.errorMessage).not.toBeNull();
    expect(buildRow.errorMessage).not.toContain('\x1b');
    expect(buildRow.errorMessage).not.toContain(']8;;');
    // E2 首行可读：git 前缀 + 文件:行:列 + 规则名（biomejs.dev 链接只留标签文本）。
    const firstLine = buildRow.errorMessage!.split('\n')[0]!;
    expect(firstLine.startsWith(EXPECTED_HEAD)).toBe(true);
  });
});
