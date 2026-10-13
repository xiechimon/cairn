// M4b watch/wake 三触发 E2E（真 server + 真 daemon + pi + stub LLM，对照 r5 §3.5）：
// ① 派工即自动 watch：chief run_builds relay → watches[0] reason canon
//    「Dispatched by the chief: report back when it parks at a gate or settles.」
// ② gate wake：worker 步停 review → chief wake 步（[wake:gate] prompt + continue
//    session）→ 线程内汇报（r5「已完成，停在 review 等待确认」等价物）；
//    wake 低延迟（machineHub.wake，非 75s 轮询——r5 实测 1 秒后领步）。
// ③ settle wake：chief merge_builds（用户指令「合并」）→ 先回「合并已启动」
//    （委派已受理）→ merge 步落地 done → settle wake →「已合并完成」（结果已
//    确认）→ watch 自动解除（r5 两阶段汇报 + 生命周期）。
// ④ failed wake：第二任务执行步 provider 400 → todo failed → failed wake →
//    chief 先调 machines 工具再产法证式汇报（r5 §3.5 失败轮实测序）→ watch 解除。
//
// stub 脚本按全局消费序编排（daemon 串行领活保证轮序）；动态参数
// （todoId/buildId）在对应轮消费前填入（responses 数组闭包活引用）。

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHIEF_WATCH_REASON_DISPATCH } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { resolveSessionFile, type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  build as buildTable,
  chiefMessage,
  chief as chiefTable,
  chiefThread,
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
import { type StubLlm, type StubResponse, startStubLlm } from './stub-llm.js';

let stub: StubLlm;
let script: StubResponse[];
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let world: { projectId: string; todoId: string };
let todo2Id = '';
let threadId = '';
let build1 = '';

/** 轮结束后仍在磁盘上的引擎会话（首轮定格，次轮对拍身份不变）。 */
let chiefSessionId = '';
let chiefSessionFile = '';

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

function chiefWatches(): { todoId: string; reason?: string | null }[] {
  const row = server.db.select().from(chiefTable).all()[0];
  return (row?.watches ?? []) as { todoId: string; reason?: string | null }[];
}

function wakeSteps(prefix: string) {
  return server.db
    .select()
    .from(stepTable)
    .where(eq(stepTable.kind, 'chief'))
    .all()
    .filter((s) => (s.prompt ?? '').startsWith(prefix));
}

function threadMessages(): string {
  return JSON.stringify(
    server.db.select().from(chiefMessage).where(eq(chiefMessage.threadId, threadId)).all(),
  );
}

/** 会话耐久面断言（本轮补钉）：轮结束后引擎会话**不随步回收**——
 * thread.sessionId 非空、chat-sessions 索引可解析、文件真在执行机磁盘上。
 * 这是下一轮 continue session 能接回对话前缀（缓存复用）的物理前提；
 * 收尾释放的是进程内句柄（sessionHandles.delete + session.dispose），
 * 碰不到这个文件。断言必须落在步已 done / activeRun 已清之后，否则测的
 * 是「轮内还活着」而不是「轮后仍留在磁盘」。 */
function expectSessionDurable(): string {
  const th = server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  expect(th).toBeDefined();
  expect(th!.activeRun).toBeNull();
  expect(th!.sessionId).not.toBe('');
  const file = resolveSessionFile(paths, th!.sessionId);
  expect(file).not.toBeNull();
  expect(existsSync(file!)).toBe(true);
  return file!;
}

async function waitThreadIdle(): Promise<void> {
  await waitFor(() => {
    const th = server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
    const chiefStepActive = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.kind, 'chief'))
      .all()
      .some((s) => s.status === 'pending' || s.status === 'claimed');
    return th != null && th.activeRun === null && !chiefStepActive;
  }, 120_000);
}

beforeAll(async () => {
  script = [
    // R0/R1 — chief 回合 1（用户：开始执行探针任务）：run_builds 派工 + 回执。
    {
      toolCall: {
        name: 'run_builds',
        arguments: {
          todoIds: ['__TODO1__'],
          withPlan: false,
          assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
        },
      },
    },
    { content: '已派工给执行 Agent。停在关口或落定后我会回来汇报。' },
    // R2/R3 — worker 执行步（探针任务）：bash 写探针行（daemon 步末 commit+push）→ review park。
    {
      toolCall: {
        name: 'bash',
        arguments: {
          command: 'printf "m4b wake probe\\n" >> README.md',
        },
      },
    },
    { content: '探针行已写入 README.md 并提交。' },
    // R4 — chief gate wake 轮：停 review 汇报（r5 截图 115 等价物）。
    { content: '「探针任务」已完成，停在 review 等待确认。确认没问题后请告诉我合并。' },
    // R5 — chief 回合 2（用户：合并）：#1256 合并只由人触发——chief 拒代合回执
    // （指认人工出口）；merge 步改由测试以人类身份走 REST 触发（R6 位）。
    { content: '合并只由人触发，我不能代合。请在 web 界面 review 关口点「完成」触发合并。' },
    // R6 — merge 步（continue session，git merge 由 daemon 确定性执行）。
    { content: '合并执行完成。' },
    // R8 — chief settle wake 轮：「结果已确认」汇报（r5 截图 117 等价物）。
    { content: '「探针任务」已合并完成，状态为 done。README.md 已落地到项目根目录。' },
    // R9/R10 — chief 回合 3（用户：启动第二个任务）：run_builds + 回执。
    {
      toolCall: {
        name: 'run_builds',
        arguments: {
          todoIds: ['__TODO2__'],
          withPlan: false,
          assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
        },
      },
    },
    { content: '已派工第二个任务。' },
    // R11 — worker 执行步（任务二）：provider 400 不可重试 → 步 failed。
    { status: 400 },
    // R12/R13 — chief failed wake 轮：先调 machines（r5 实测序）再法证式汇报。
    { toolCall: { name: 'machines', arguments: {} } },
    {
      content:
        '失败原因：执行步的模型服务返回 400，属环境问题，这不是代码问题。工作保全在分支 pacman/conv- 前缀的会话分支上，没有丢失。建议检查 stub provider 配置后重跑。',
    },
  ];
  stub = await startStubLlm(script);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试 Agent：按指令使用工具，然后简短汇报。',
  });
  home = mkdtempSync(join(tmpdir(), 'pacman-m4b-wake-home-'));
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'm4b-wake-mbp',
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
  // #691：落盘行带 wall-clock 前缀——集成面钉住新格式（logLines 已归一化剥前缀，
  // 这里读原始面，防悄悄回退成无时间戳）。
  expect(
    readFileSync(paths.daemonLog, 'utf8')
      .split('\n')
      .some((l) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[wake\] push channel connected$/.test(l)),
  ).toBe(true);

  // 世界 seed：托管 repo 项目（merge 落地需 bare 库）+ 两个 todo。
  world = await seedWorld(
    server.url,
    server.teamId,
    { title: '探针任务', spec: '在 README.md 追加一行 m4b wake probe。' },
    { repoKind: 'hosted', projectName: 'm4b-wake' },
  );
  const t2 = await api(server.url, 'POST', `/api/projects/${world.projectId}/todos`, {
    title: '失败语义任务',
    spec: '本任务用于失败触发观测。',
  });
  todo2Id = (t2.body as { id: string }).id;
  const dispatch = (todoId: string): StubResponse => ({
    toolCall: {
      name: 'run_builds',
      // #903（ADR 0014）：withPlan = chief 逐次判定参数（缺省先规划），
      // 本环测 wake 三触发全链，stub 显式传 false 保持 worker 直执行脚本语义。
      arguments: {
        todoIds: [todoId],
        withPlan: false,
        assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      },
    },
  });
  script[0] = dispatch(world.todoId);
  script[8] = dispatch(todo2Id);

  // 绑定 chief（PATCH /chief，r5 §2）。
  const patch = await api(server.url, 'PATCH', `/api/teams/${server.teamId}/chief`, {
    agent: { agentId: AGENT_ID, thinkingLevel: null },
  });
  expect(patch.status).toBe(200);
}, 150_000);

afterAll(async () => {
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  const diagTail = logLines().slice(-50).join('\n');
  if (home) rmSync(home, { recursive: true, force: true });
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${diagTail}\n`,
  );
});

describe('M4b watch/wake 三触发 E2E（r5 §3.5 对照实跑）', () => {
  test('派工即自动 watch（reason canon）+ gate wake 停 review 汇报', async () => {
    const sent = await api(server.url, 'POST', `/api/teams/${server.teamId}/chief/threads`, {
      content: `开始执行「探针任务」（todo ${world.todoId}），直接执行不做规划。`,
    });
    expect(sent.status).toBe(201);
    threadId = (sent.body as { thread: { id: string } }).thread.id;

    // 派工落库：build（triggerSource chief）+ 自动 watch（r5 §3.5）。
    await waitFor(() => {
      const builds = server.db.select().from(buildTable).all();
      return builds.length > 0 && chiefWatches().length > 0;
    }, 120_000);
    build1 = server.db.select().from(buildTable).all()[0]!.id;
    expect(server.db.select().from(buildTable).all()[0]!.triggerSource).toBe('chief');
    const watch = chiefWatches()[0]!;
    expect(watch.todoId).toBe(world.todoId);
    expect(watch.reason).toBe(CHIEF_WATCH_REASON_DISPATCH);

    // gate 触发：worker 步停 review → [wake:gate] chief 步（低延迟领步）。
    await waitFor(() => server.todoPhase(world.todoId) === 'review', 120_000);
    await waitFor(() => wakeSteps('[wake:gate]').length > 0, 120_000);
    const gateStep = wakeSteps('[wake:gate]')[0]!;
    await waitFor(() => {
      const row = server.db.select().from(stepTable).where(eq(stepTable.id, gateStep.id)).get();
      return row?.status === 'done';
    }, 120_000);
    // r5 实测「1 秒后机器领 Chief conv 新步」——wake SSE 低延迟派发（非 75s 轮询）。
    const doneGate = server.db.select().from(stepTable).where(eq(stepTable.id, gateStep.id)).get()!;
    expect((doneGate.claimedAt ?? 0) - gateStep.createdAt).toBeLessThan(10_000);
    // wake 轮 = continue session（r5 §3.5「continue session 短轮」）。
    expect(logLines().some((l) => l.includes(`continue session ${threadId}`))).toBe(true);
    // 线程内汇报（r5 截图 115 等价文案）。
    expect(threadMessages()).toContain('停在 review 等待确认');
    // gate 后 watch 仍在（settle/failed 才解除）。
    expect(chiefWatches().map((w) => w.todoId)).toContain(world.todoId);

    // 会话耐久：本轮（gate wake）已 done、activeRun 已清 = 一次真实的句柄
    // 回收点，会话文件必须仍留在执行机磁盘上且索引解得回来。
    await waitThreadIdle();
    chiefSessionFile = expectSessionDurable();
    chiefSessionId = server.db
      .select()
      .from(chiefThread)
      .where(eq(chiefThread.id, threadId))
      .get()!.sessionId;
  }, 150_000);

  test('settle wake：合并两阶段汇报（委派已受理 → 结果已确认）+ watch 自动解除', async () => {
    // 用户指令「合并」→ #1256：chief 拒代合回执（两阶段汇报其一变为拒绝+指认人工出口）。
    await waitThreadIdle();
    const sent = await api(
      server.url,
      'POST',
      `/api/conversations/chief-${threadId.replace(/^chief-/, '')}/messages`,
      { content: `合并 ${world.todoId}` },
    );
    expect([200, 201]).toContain(sent.status);
    await waitFor(() => threadMessages().includes('合并只由人触发'), 120_000);

    // 人工出口：测试以人类身份走 REST 触发 merge（202 delegated，merge 步 daemon 确定性执行）。
    const humanMerge = await api(server.url, 'POST', `/api/builds/${build1}/merge`, {});
    expect(humanMerge.status).toBe(202);

    // merge 步落地 → todo done → settle wake → 结果已确认汇报。
    await waitFor(() => server.todoPhase(world.todoId) === 'done', 150_000);
    await waitFor(() => wakeSteps('[wake:settle]').length > 0, 60_000);
    const settleStep = wakeSteps('[wake:settle]')[0]!;
    await waitFor(() => {
      const row = server.db.select().from(stepTable).where(eq(stepTable.id, settleStep.id)).get();
      return row?.status === 'done';
    }, 120_000);
    await waitFor(() => threadMessages().includes('已合并完成'), 60_000);

    // watch 生命周期：settle 后自动解除（r5「watches: []」）。
    await waitFor(() => !chiefWatches().some((w) => w.todoId === world.todoId), 60_000);

    // 跨轮续用（本轮补钉）：settle 轮跑完仍解回同一个会话文件、会话身份不变
    // ——未换机时每轮都是同一条会话续接，这正是缓存前缀能命中的物理依据。
    await waitThreadIdle();
    expect(expectSessionDurable()).toBe(chiefSessionFile);
    expect(
      server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get()!.sessionId,
    ).toBe(chiefSessionId);
  }, 150_000);

  test('failed wake：步 failed → chief 先调 machines 再产法证式汇报 + watch 解除', async () => {
    await waitThreadIdle();
    const sent = await api(
      server.url,
      'POST',
      `/api/conversations/chief-${threadId.replace(/^chief-/, '')}/messages`,
      { content: `启动第二个任务（todo ${todo2Id}），直接执行。` },
    );
    expect([200, 201]).toContain(sent.status);

    // 任务二执行步 provider 400 → 步 failed → todo failed。
    await waitFor(() => server.todoPhase(todo2Id) === 'failed', 150_000);

    // failed wake 步 + 收尾。
    await waitFor(() => wakeSteps('[wake:failed]').length > 0, 60_000);
    const failedStep = wakeSteps('[wake:failed]')[0]!;
    await waitFor(() => {
      const row = server.db.select().from(stepTable).where(eq(stepTable.id, failedStep.id)).get();
      return row?.status === 'done';
    }, 120_000);

    // r5 实测序：failed wake 轮先调 machines 工具（activeRun tool 证据的落库
    // 等价物 = chief_message 工具行）再产法证式汇报。
    const msgs = threadMessages();
    expect(msgs).toContain('machines');
    expect(msgs).toContain('失败原因');
    expect(msgs).toContain('这不是代码问题');
    expect(msgs).toContain('没有丢失');
    const machinesIdx = msgs.indexOf('machines');
    const reportIdx = msgs.indexOf('失败原因');
    expect(machinesIdx).toBeLessThan(reportIdx); // 先取证后汇报

    // failed 后 watch 自动解除（r5 §3.5 生命周期）。
    await waitFor(() => !chiefWatches().some((w) => w.todoId === todo2Id), 60_000);
  }, 150_000);
});
