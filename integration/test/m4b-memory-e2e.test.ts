// M4b memory 写路径 E2E（真 server + 真 daemon + pi + stub LLM，对照 r5 §6）：
// ① spec 指令触发 + 执行步进行中写：stub 模型在步中调 save_memory（remoteTools
//    relay → 服务端落库），写入时点早于步收尾（r5 §6「10:02:20 早于 review park
//    约 17s」的时序等价断言：relay 落库时 step 仍 claimed）。
// ② 三级溯源：sourceTodoId/sourceBuildId = 运行中 todo/build（r5 §6 样本形）。
// ③ 零自动写入语义：任务收尾（done）不产记忆；无指令轮同样零写入——「任务
//    结束自动蒸馏」证伪结论的结构性守住（r5 §6）。
// ④ 读侧注入形验证（04 附录 A 触发项）：第二轮 claim 载荷 agent.memories →
//    composeWorkerSystemPrompt `## 记忆` 段 → provider wire 请求体可观测注入
//    痕迹（stub 捕获的请求体含已存条目 title——transcript 对照的宿主等价物）。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  agentMemory,
  step as stepTable,
  todo as todoTable,
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

const MEMORY_TITLE = 'README 只在末尾追加小节';
const MEMORY_CONTENT = 'README.md 约定：新增说明一律在文件末尾追加二级标题小节。';

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let world1: { projectId: string; todoId: string };
let world2: { projectId: string; todoId: string };
let build1 = '';
/** relay 落库瞬间的步状态采样（「执行步进行中写」时序证据）。 */
let stepStatusAtWrite: string | null = null;

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

beforeAll(async () => {
  stub = await startStubLlm([
    // 轮 1（任务一执行步，spec 含记忆指令）：步中调 save_memory（relay）。
    {
      toolCall: {
        name: 'save_memory',
        arguments: { title: MEMORY_TITLE, content: MEMORY_CONTENT },
      },
    },
    // 轮 2（任务一）：真做任务改动（#703 闸 2——执行步无改动过不了 review 闸）。
    {
      toolCall: { name: 'bash', arguments: { command: 'printf "mem probe line\\n" >> README.md' } },
    },
    // 轮 3：拿到结果后收尾（delayMs = 采样窗口，坐实「写入早于收尾」）。
    { content: '已完成：README 追加小节，并已按要求保存一条项目经验到记忆。', delayMs: 1500 },
    // 轮 4（任务二执行步，spec 无记忆指令）：真改动 + 直接收尾——记忆零写入。
    {
      toolCall: { name: 'bash', arguments: { command: 'printf "mem task2 line\\n" >> README.md' } },
    },
    // 轮 5：任务二收尾。
    { content: '已完成任务二。' },
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试执行 Agent：按任务要求完成改动，然后简短汇报。',
  });
  home = mkdtempSync(join(tmpdir(), 'cairn-m4b-mem-home-'));
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'm4b-mem-mbp',
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
  const diagTail = logLines().slice(-40).join('\n');
  if (home) rmSync(home, { recursive: true, force: true });
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${diagTail}\n`,
  );
});

describe('M4b memory E2E：指令触发 + 执行步中写 + 溯源 + 零自动写入（r5 §6）', () => {
  test('spec 指令轮：save_memory 执行步进行中落库，三级溯源 = 运行中上下文', async () => {
    world1 = await seedWorld(
      server.url,
      server.teamId,
      {
        title: '记忆指令任务',
        spec: `在 README.md 追加一行探针。\n\n完成后请用你的记忆工具保存一条与本项目相关的一句话经验（r5 §6 指令原文形）。`,
      },
      { projectName: 'm4b-mem-1' },
    );
    const started = await api(server.url, 'POST', `/api/projects/${world1.projectId}/builds`, {
      todoIds: [world1.todoId],
      assignment: { plan: null, build: { agentId: AGENT_ID } },
      withPlan: false,
    });
    expect(started.status).toBe(201);
    build1 = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    // 写入落库瞬间采样步状态（「进行中」时序证据：早于步收尾）。
    await waitFor(() => {
      const rows = server.db.select().from(agentMemory).all();
      if (rows.length > 0) {
        if (stepStatusAtWrite === null) {
          stepStatusAtWrite =
            server.db.select().from(stepTable).where(eq(stepTable.buildId, build1)).all()[0]
              ?.status ?? null;
        }
        return true;
      }
      return false;
    }, 120_000);
    expect(stepStatusAtWrite).toBe('claimed'); // 步仍在运行 = 执行步进行中写

    const rows = server.db.select().from(agentMemory).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agentId: AGENT_ID,
      teamId: server.teamId,
      title: MEMORY_TITLE,
      content: MEMORY_CONTENT,
      projectId: world1.projectId, // 缺省 = 运行中项目（r5 §6 样本）
      sourceTodoId: world1.todoId, // r5 §6 实测：sourceTodoId = 当次 todo
      sourceBuildId: build1, // buildId ≡ conversationId
    });

    // 步收尾 → review park；收尾后记忆数不增（零自动蒸馏，r5 §6 证伪结论）。
    await waitFor(() => server.todoPhase(world1.todoId) === 'review', 120_000);
    expect(server.db.select().from(agentMemory).all()).toHaveLength(1);
  }, 150_000);

  test('无指令轮：零写入（5+ 运行实测语义等价）+ 读侧注入痕迹上 wire（04 附录 A）', async () => {
    // 注入痕迹断言前采样：任务二的 provider 请求体应含已存记忆 title。
    // 任务二与任务一同项目：注入只取本项目与全局条目（#1494），任务一存的条目
    // 带任务一的 projectId。
    const todo2Res = await api(server.url, 'POST', `/api/projects/${world1.projectId}/todos`, {
      title: '无记忆指令任务',
      spec: '在 README.md 追加一行任务二探针。',
    });
    world2 = { projectId: world1.projectId, todoId: (todo2Res.body as { id: string }).id };
    const started = await api(server.url, 'POST', `/api/projects/${world2.projectId}/builds`, {
      todoIds: [world2.todoId],
      assignment: { plan: null, build: { agentId: AGENT_ID } },
      withPlan: false,
    });
    expect(started.status).toBe(201);

    await waitFor(() => server.todoPhase(world2.todoId) === 'review', 120_000);

    // 零自动写入：无指令 + 收尾完成，记忆仍恰 1 条（任务一指令轮所写）。
    expect(server.db.select().from(agentMemory).all()).toHaveLength(1);
    const todo2 = server.db.select().from(todoTable).where(eq(todoTable.id, world2.todoId)).get();
    expect(todo2?.phase).toBe('review');

    // 读侧注入形（04 附录 A 验证动作「对照 Agent 执行 transcript 观察注入
    // 痕迹」的宿主等价物）：任务二会话的 provider wire 请求体含 `## 记忆` 段
    // 与已存条目 title——注入位 = systemPrompt（claim agent.memories →
    // composeWorkerSystemPrompt，02 §4.4 读路径）。
    const task2Requests = stub.requests.filter((r) => JSON.stringify(r).includes('无记忆指令任务'));
    expect(task2Requests.length).toBeGreaterThan(0);
    const wire = JSON.stringify(task2Requests[0]);
    expect(wire).toContain('## 记忆');
    expect(wire).toContain(MEMORY_TITLE);
    expect(wire).toContain(MEMORY_CONTENT);
  }, 150_000);
});
