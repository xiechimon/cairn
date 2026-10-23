// remote_shell 全链 E2E（XMON-110 验收 6）：真 server（HTTP + 审计表）+ 真
// daemon（runMachine + pi 会话）+ 真 bash spawn，stub LLM 只顶替模型决策。
// 链路 = claim localTools（双闸开）→ agent 调 remote_shell → 预检落审计行
// （running）→ 本机执行 → 回写终态（done + exitCode + output）→ 工具结果
// 文本回到 agent 会话面。
// 断言面三处：server shell_command 审计行（正本）、daemon.log 审计行族
// （执行机副本）、message 表（agent 真拿到输出）。任一环节静默失败即红。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_TOOL_SHELL } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  agent as agentTable,
  machine as machineTable,
  message as messageTable,
  shellCommand as shellCommandTable,
  step as stepTable,
} from '../../apps/server/src/db/schema.js';
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

/** 命令与输出 marker：审计行 / message 面共用的对账键。 */
const MARKER = 'SHELL-E2E-MARKER-110';
const COMMAND = `echo ${MARKER}`;
const MACHINE_NAME = 'shell-e2e-mbp';

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let world: { projectId: string; todoId: string };
let buildId = '';

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

beforeAll(async () => {
  stub = await startStubLlm([
    // 轮 1：agent 调 remote_shell（pi 会话内真执行：预检 → bash → 回写）。
    { toolCall: { name: 'remote_shell', arguments: { command: COMMAND } } },
    // 轮 2：真做一处改动（#703 闸 2——执行步无改动过不了 review 闸）。
    { toolCall: { name: 'bash', arguments: { command: 'printf "shell probe\\n" >> README.md' } } },
    // 轮 3：收尾。
    { content: '命令已执行。' },
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试 Agent：按指令使用工具，然后简短汇报。',
  });
  // 双闸 agent 侧：授「远程 shell」工具开关（machine.shellEnabled 在 daemon
  // 注册出 machine 行后开，见下——claim 期两闸齐开才有 localTools 词）。
  server.db
    .update(agentTable)
    .set({ tools: ['合并分支', '推送分支', AGENT_TOOL_SHELL] })
    .where(eq(agentTable.id, AGENT_ID))
    .run();
  home = mkdtempSync(join(tmpdir(), 'cairn-it-shell-home-'));
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: MACHINE_NAME,
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
  // 双闸 machine 侧：注册行落库后开机器 shell 闸（先于 build 创建 = 先于
  // claim，localTools 组装期两闸齐开）。
  await waitFor(
    () =>
      server.db.select().from(machineTable).where(eq(machineTable.name, MACHINE_NAME)).get() !==
      undefined,
    30_000,
  );
  server.db
    .update(machineTable)
    .set({ shellEnabled: true })
    .where(eq(machineTable.name, MACHINE_NAME))
    .run();
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  const diagTail = logLines().slice(-40).join('\n');
  if (home) rmSync(home, { recursive: true, force: true });
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${diagTail}\n`,
  );
});

describe('XMON-110 remote_shell 全链 E2E（预检 → 执行 → 审计行终态）', () => {
  test('一条真命令走通全链：审计行 done + exitCode/output 正确 + agent 拿到输出', async () => {
    world = await seedWorld(
      server.url,
      server.teamId,
      { title: 'shell 全链探针', spec: '执行命令并汇报输出。' },
      { projectName: 'shell-e2e' },
    );
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: null, build: { agentId: AGENT_ID } },
      withPlan: false,
    });
    expect(started.status).toBe(201);
    buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(world.todoId) === 'review', 150_000);

    // ① 审计正本（server shell_command 表）：一行、命令原文、终态 done、
    //    exitCode 0、输出含 marker、挂在本 build 的步上、finishedAt 落位。
    const rows = server.db.select().from(shellCommandTable).all();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.command).toBe(COMMAND);
    expect(row.status).toBe('done');
    expect(row.exitCode).toBe(0);
    expect(row.output ?? '').toContain(MARKER);
    expect(row.errorMessage).toBeNull();
    expect(row.finishedAt).not.toBeNull();
    const stepIds = server.db
      .select({ id: stepTable.id })
      .from(stepTable)
      .where(eq(stepTable.buildId, buildId))
      .all()
      .map((s) => s.id);
    expect(stepIds).toContain(row.stepId);

    // ② 执行机副本（daemon.log 审计行族）：allowed（预检放行）+ done（exit=0）。
    expect(logLines().some((l) => l.includes('shell allowed') && l.includes(`run=${row.id}`))).toBe(
      true,
    );
    expect(logLines().some((l) => l.includes('shell done') && l.includes('exit=0'))).toBe(true);

    // ③ agent 会话面：工具结果文本（真实输出）经 relay 落 message 表——
    //    证明 agent 拿到的不是错误占位文本。
    const msgs = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    expect(JSON.stringify(msgs)).toContain(MARKER);
  }, 150_000);
});
