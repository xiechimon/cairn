// #929 命令闸 E2E（tool_call 阻断缝）：真 server + 真 daemon + stub LLM 全链。
// 双向证据（票面验收：只测一侧等于没测）：
// ① 放行路径——合法 bash 照跑（真改动落 README.md，过 review 闸到 done）；
// ② 拒绝路径——`rm -rf /` 被 DEFAULT_BASH_PATTERNS 拒：[gate] canon 行 +
//    拒绝文案进 transcript 工具行（模型可见 reason，非空 tool error）；
// ③ 覆盖面——MCP 工具调用过同一条闸（#929 新获能力立证）：注入规则表
//    reject `mcp__demo__echo` → 调用被拒 + [gate] 行 + 外部 server 零到达
//    （block 先于执行）。
// 无人值守安全（④）由实现面保证（gateToolCallHandler 签名无 ctx/ui，纯
// event 进纯裁决出）；本文件在真栈上钉 ①②③ 的行为面。

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createPiBackend } from '../../apps/daemon/src/backend/pi.js';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import {
  recordSession,
  resolveSessionFile,
  type StatePaths,
  statePaths,
} from '../../apps/daemon/src/state.js';
import { message as messageTable, todo as todoTable } from '../../apps/server/src/db/schema.js';
import {
  AGENT_ID,
  api,
  bootRealServer,
  daemonLogLines,
  type RealServer,
  seedWorld,
  startExternalMcp,
  waitFor,
} from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

let stub: StubLlm;
let server: RealServer;
let external: Awaited<ReturnType<typeof startExternalMcp>>;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let mcpConfig: string;
let buildId = '';
let world: { projectId: string; todoId: string };

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

beforeAll(async () => {
  external = await startExternalMcp();
  home = mkdtempSync(join(tmpdir(), 'cairn-gate-home-'));
  mcpConfig = join(home, 'claude.json');
  writeFileSync(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        demo: { url: external.url, headers: { Authorization: 'Bearer gate-secret' } },
      },
    }),
    'utf8',
  );
  stub = await startStubLlm([
    // 轮 1（bash 拒绝路径）：不可逆形态 → tool_call 闸拒（模型拿到 reason）。
    { toolCall: { name: 'bash', arguments: { command: 'rm -rf /' } } },
    // 轮 2（放行路径 + 覆盖面）：MCP echo 被注入规则拒 → 模型改道真改动。
    { toolCall: { name: 'mcp__demo__echo', arguments: { text: 'gate-probe' } } },
    // 轮 3：真做一处改动（#703 闸 2——执行步无改动过不了 review 闸）。
    { toolCall: { name: 'bash', arguments: { command: 'printf "gate probe\\n" >> README.md' } } },
    // 轮 4：收尾。
    { content: '闸双向验证完成。' },
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试 Agent：按指令使用工具，然后简短汇报。',
    mcpConfigPath: mcpConfig,
  });
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'gate-mbp',
      mcpConfigPath: mcpConfig,
    },
    {},
  );
  paths = statePaths(config.home, config.workspacesDir);
  const logger = createDaemonLogger({ logFile: paths.daemonLog });
  // 注入带规则表的 backend（PiBackendOpts.gateRules；machine-loop 同款配置面
  // ——覆盖面立证的唯一注入缝，产品馈源 = 将来服务端统一下发表）。
  handle = await runMachine({
    config,
    paths,
    logger,
    idleSleepPrevention: false,
    proxyEnv: {},
    claimBackoffBaseMs: 50,
    heartbeatIntervalMs: 500,
    backend: createPiBackend({
      agentDir: paths.agentRuntimeDir,
      sessionDir: paths.chatSessionsDir,
      skills: { skillsDir: config.skillsDir, cwd: config.home },
      resolveSessionFile: (sid) => resolveSessionFile(paths, sid),
      onSession: (sid, file) => {
        if (file) recordSession(paths, sid, file);
      },
      onMcpLog: (msg) => logger.mcp(msg),
      onSkillsLog: (msg) => logger.skills(msg),
      onGateLog: (msg) => logger.gate(msg),
      machineName: config.name,
      gateRules: [{ id: 'deny-echo', tool: 'mcp__demo__echo', action: 'reject' }],
    }),
  });
  await waitFor(() => logLines().includes('[wake] push channel connected'), 30_000);
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  await external?.close();
  const diagTail = logLines().slice(-30).join('\n');
  if (home) rmSync(home, { recursive: true, force: true });
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${diagTail}\n`,
  );
});

describe('#929 命令闸 tool_call 缝 E2E：双向 + MCP 覆盖面', () => {
  test('拒绝与放行各得其所：bash 不可逆形态拒（reason 进 transcript）、MCP 调用过同一闸、合法 bash 改动落地', async () => {
    // per-Agent MCP 授权：demo 勾上（MCP 工具注册进会话面，覆盖面才有对象）。
    const authed = await api(
      server.url,
      'PATCH',
      `/api/teams/${server.teamId}/agents/${AGENT_ID}`,
      { mcpServers: ['demo'] },
    );
    expect(authed.status).toBe(200);

    world = await seedWorld(
      server.url,
      server.teamId,
      { title: '命令闸探针', spec: '验证闸的双向行为。' },
      { projectName: 'gate-e2e' },
    );
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: null, build: { agentId: AGENT_ID } },
      withPlan: false,
    });
    expect(started.status).toBe(201);
    buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(world.todoId) === 'review', 150_000);

    // 拒绝路径（bash 面）：[gate] canon 行 + 拒绝文案进 transcript 工具行
    // （模型可见同义 reason——不是空 tool error）。
    const lines = logLines();
    expect(lines.some((l) => l.includes('[gate] ask: rule=ask-rm-rf-root command=rm -rf /'))).toBe(
      true,
    );
    const msgs = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    const transcript = JSON.stringify(msgs);
    expect(transcript).toContain('command gate (ask-rm-rf-root)');
    expect(transcript).toContain('requires approval, and this daemon runs unattended');

    // 覆盖面（MCP 过同一条闸）：注入规则拒 mcp__demo__echo → [gate] 行 +
    // 工具面拒绝文案进 transcript + 外部 server 零到达（block 先于执行）。
    expect(
      lines.some((l) => l.includes('[gate] reject: rule=deny-echo tool=mcp__demo__echo')),
    ).toBe(true);
    expect(transcript).toContain('tool gate (deny-echo)');
    expect(external.calls).toEqual([]);

    // 放行路径：合法 bash 照跑（真改动过 review 闸——phase=review 即执行步
    // 完成；改动面由 review 闸与 worktree 落地共同证明）。
    expect(transcript).toContain('gate probe');
    const todoRow = server.db.select().from(todoTable).where(eq(todoTable.id, world.todoId)).get();
    expect(todoRow?.phase).toBe('review');
  }, 150_000);
});
