import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHIEF_WATCH_REASON_DISPATCH } from '@cairn/shared';
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
    {
      toolCall: {
        name: 'bash',
        arguments: {
          command: 'printf "m4b wake probe\\n" >> README.md',
        },
      },
    },
    { content: '探针行已写入 README.md 并提交。' },
    { content: '「探针任务」已完成，停在 review 等待确认。确认没问题后请告诉我合并。' },
    { content: '合并只由人触发，我不能代合。请在 web 界面 review 关口点「完成」触发合并。' },
    { content: '合并执行完成。' },
    { content: '「探针任务」已合并完成，状态为 done。README.md 已落地到项目根目录。' },
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
    { status: 400 },
    { toolCall: { name: 'machines', arguments: {} } },
    {
      content:
        '失败原因：执行步的模型服务返回 400，属环境问题，这不是代码问题。工作保全在分支 cairn/conv- 前缀的会话分支上，没有丢失。建议检查 stub provider 配置后重跑。',
    },
  ];
  stub = await startStubLlm(script);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试 Agent：按指令使用工具，然后简短汇报。',
  });
  home = mkdtempSync(join(tmpdir(), 'cairn-m4b-wake-home-'));
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
  expect(
    readFileSync(paths.daemonLog, 'utf8')
      .split('\n')
      .some((l) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[wake\] push channel connected$/.test(l)),
  ).toBe(true);

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
      arguments: {
        todoIds: [todoId],
        withPlan: false,
        assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      },
    },
  });
  script[0] = dispatch(world.todoId);
  script[8] = dispatch(todo2Id);

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

describe('M4b watch/wake three-trigger E2E (r5 §3.5 reference run)', () => {
  test('dispatch auto-watch (reason canon) + gate wake parks at review and reports', async () => {
    const sent = await api(server.url, 'POST', `/api/teams/${server.teamId}/chief/threads`, {
      content: `开始执行「探针任务」（todo ${world.todoId}），直接执行不做规划。`,
    });
    expect(sent.status).toBe(201);
    threadId = (sent.body as { thread: { id: string } }).thread.id;

    await waitFor(() => {
      const builds = server.db.select().from(buildTable).all();
      return builds.length > 0 && chiefWatches().length > 0;
    }, 120_000);
    build1 = server.db.select().from(buildTable).all()[0]!.id;
    expect(server.db.select().from(buildTable).all()[0]!.triggerSource).toBe('chief');
    const watch = chiefWatches()[0]!;
    expect(watch.todoId).toBe(world.todoId);
    expect(watch.reason).toBe(CHIEF_WATCH_REASON_DISPATCH);

    await waitFor(() => server.todoPhase(world.todoId) === 'review', 120_000);
    await waitFor(() => wakeSteps('[wake:gate]').length > 0, 120_000);
    const gateStep = wakeSteps('[wake:gate]')[0]!;
    await waitFor(() => {
      const row = server.db.select().from(stepTable).where(eq(stepTable.id, gateStep.id)).get();
      return row?.status === 'done';
    }, 120_000);
    const doneGate = server.db.select().from(stepTable).where(eq(stepTable.id, gateStep.id)).get()!;
    expect((doneGate.claimedAt ?? 0) - gateStep.createdAt).toBeLessThan(10_000);
    expect(logLines().some((l) => l.includes(`continue session ${threadId}`))).toBe(true);
    expect(threadMessages()).toContain('停在 review 等待确认');
    expect(chiefWatches().map((w) => w.todoId)).toContain(world.todoId);

    await waitThreadIdle();
    chiefSessionFile = expectSessionDurable();
    chiefSessionId = server.db
      .select()
      .from(chiefThread)
      .where(eq(chiefThread.id, threadId))
      .get()!.sessionId;
  }, 150_000);

  test('settle wake: two-phase merge report (delegation accepted → result confirmed) + watch auto-release', async () => {
    await waitThreadIdle();
    const sent = await api(
      server.url,
      'POST',
      `/api/conversations/chief-${threadId.replace(/^chief-/, '')}/messages`,
      { content: `合并 ${world.todoId}` },
    );
    expect([200, 201]).toContain(sent.status);
    await waitFor(() => threadMessages().includes('合并只由人触发'), 120_000);

    const humanMerge = await api(server.url, 'POST', `/api/builds/${build1}/merge`, {});
    expect(humanMerge.status).toBe(202);

    await waitFor(() => server.todoPhase(world.todoId) === 'done', 150_000);
    await waitFor(() => wakeSteps('[wake:settle]').length > 0, 60_000);
    const settleStep = wakeSteps('[wake:settle]')[0]!;
    await waitFor(() => {
      const row = server.db.select().from(stepTable).where(eq(stepTable.id, settleStep.id)).get();
      return row?.status === 'done';
    }, 120_000);
    await waitFor(() => threadMessages().includes('已合并完成'), 60_000);

    await waitFor(() => !chiefWatches().some((w) => w.todoId === world.todoId), 60_000);

    await waitThreadIdle();
    expect(expectSessionDurable()).toBe(chiefSessionFile);
    expect(
      server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get()!.sessionId,
    ).toBe(chiefSessionId);
  }, 150_000);

  test('failed wake: step failed → chief calls machines first, then evidence-style report + watch release', async () => {
    await waitThreadIdle();
    const sent = await api(
      server.url,
      'POST',
      `/api/conversations/chief-${threadId.replace(/^chief-/, '')}/messages`,
      { content: `启动第二个任务（todo ${todo2Id}），直接执行。` },
    );
    expect([200, 201]).toContain(sent.status);

    await waitFor(() => server.todoPhase(todo2Id) === 'failed', 150_000);

    await waitFor(() => wakeSteps('[wake:failed]').length > 0, 60_000);
    const failedStep = wakeSteps('[wake:failed]')[0]!;
    await waitFor(() => {
      const row = server.db.select().from(stepTable).where(eq(stepTable.id, failedStep.id)).get();
      return row?.status === 'done';
    }, 120_000);

    const msgs = threadMessages();
    expect(msgs).toContain('machines');
    expect(msgs).toContain('失败原因');
    expect(msgs).toContain('这不是代码问题');
    expect(msgs).toContain('没有丢失');
    const machinesIdx = msgs.indexOf('machines');
    const reportIdx = msgs.indexOf('失败原因');
    expect(machinesIdx).toBeLessThan(reportIdx);

    await waitFor(() => !chiefWatches().some((w) => w.todoId === todo2Id), 60_000);
  }, 150_000);
});
