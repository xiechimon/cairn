// #1104 无指派 build 双修：A = chief run_builds 漏传/空传 assignment（两槽
// 全空）→ 400 打回，文案指导 chief 补正，补传即成功；B = scheduler/REST
// 入口建出的无主 build 步允许入队，claim 面判「无 Agent 可领」（单源判据 =
// dispatch-eligibility agentForStep 返 null）时按失败收尾：step failed +
// build.errorMessage 落根因 + todo → failed 终态，绝不静默 continue。
// 失败方式（先于实现固化，仓测试纪律）：
// 1. chief run_builds：整参缺失 / 空对象 / 两槽显式全空 → 400；补传后同 todo 成功
//    （400 不留半启动态）
// 2. REST startBuilds 空 assignment → 201 入队；claim → 无主步 failed +
//    errorMessage 落「无指派 Agent」根因 + todo failed；且无主步失败不挡
//    同批更晚的合法步认领（无队头阻塞）
// 3. scheduler 定时触发无指派 todo（assignment ?? {plan:null,build:null} 兜底）
//    → 同 2 漏斗（triggerSource 'schedule'）
// 4. 指派齐全路径行为不变：双槽 + withPlan → claim 领到 plan 步；仅 build 槽 +
//    直执行 → claim 领到 build 步
// 5. 槽指向已删 Agent（有主变无主）→ 同 2 漏斗，文案点名 agentId

import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newUuidv7, nowMs } from '../src/lib/ids.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { createScheduler } from '../src/services/scheduler.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  postProject,
  req,
  type TestServer,
} from './helpers.js';

const AGENT_ID = 'agent-unassigned-1';

const servers: TestServer[] = [];
afterAll(() => {
  for (const s of servers) s.dispose();
});

/** machine wire 面裸请求（helpers.req 不带鉴权头，machine-pin 同律）。 */
function call(
  app: TestServer['app'],
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

interface World {
  s: TestServer;
  tokenA: string;
  projectId: string;
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 50 });
  servers.push(s);
  const key = await issueApiKey(s);
  const res = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'unassigned-mbp', cliVersion: '0.1.0' },
  });
  expect(res.status).toBe(200);
  const token = ((await res.json()) as { token: string }).token;
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: AGENT_ID,
      modelId: 'stub-model',
    })
    .run();
  bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）

  const projectId = await postProject(s.app, 'unassigned-proj');
  return { s, tokenA: token, projectId };
}

/** enroll 走 issueApiKey 凭据的裸请求（helpers.req 不带 machine 鉴权头）。 */
async function createTodo(w: World): Promise<string> {
  const res = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
    title: '',
    spec: 'unassigned probe',
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function startBuild(
  w: World,
  todoId: string,
  assignment: unknown,
  withPlan: boolean,
): Promise<string> {
  const res = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
    todoIds: [todoId],
    assignment,
    withPlan,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id;
}

async function claim(w: World): Promise<ClaimedStep | null> {
  const res = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
    cred: w.tokenA,
    body: {},
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { step: ClaimedStep | null };
  return body.step === null ? null : claimedStepSchema.parse(body.step);
}

function stepRowOf(s: TestServer, buildId: string) {
  return s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).get()!;
}

/** 断言 B 漏斗：无主步 failed + errorMessage 落根因 + todo failed 终态。 */
function expectFailedFunnel(s: TestServer, buildId: string, todoId: string, rootNeedle: string) {
  const stepRow = stepRowOf(s, buildId);
  expect(stepRow.status).toBe('failed');
  const buildRow = s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
  expect(buildRow.errorMessage).toContain(rootNeedle);
  const todoRow = s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
  expect(todoRow.phase).toBe('failed');
}

describe('#1104 A：chief run_builds 无指派 assignment → 400 打回', () => {
  test('失败方式 1：整参缺失 / 空对象 / 两槽全空 → 400；补传后成功', async () => {
    const w = await setupWorld();
    const chiefId = `chief-${w.s.user.id}-${w.s.team.id}`;
    w.s.db
      .insert(chiefTable)
      .values({
        id: chiefId,
        userId: w.s.user.id,
        teamId: w.s.team.id,
        agentId: AGENT_ID,
        charter: '',
        createdAt: nowMs(),
      })
      .run();
    const threadId = `chief-${newUuidv7()}`;
    w.s.db
      .insert(chiefThreadTable)
      .values({
        id: threadId,
        chiefId,
        userId: w.s.user.id,
        teamId: w.s.team.id,
        title: 'unassigned relay',
        createdAt: nowMs(),
        updatedAt: nowMs(),
        sessionRuntime: 'pi',
        sessionId: '',
        sessionOpenedAt: nowMs(),
        toolDefHashes: {},
        toolResultHashes: {},
      })
      .run();
    const relay = (params: Record<string, unknown>) =>
      executeChiefTool(
        {
          db: w.s.db,
          hub: w.s.hub,
          machineHub: w.s.machineHub,
          box: w.s.secretBox,
          user: w.s.user,
          reposDir: w.s.reposDir,
          attachmentsDir: w.s.attachmentsDir,
          skillsDir: w.s.skillsDir,
        },
        {
          teamId: w.s.team.id,
          userId: w.s.user.id,
          chiefId,
          threadId,
          chiefAgentId: AGENT_ID,
          conversationId: threadId,
        },
        'run_builds',
        params,
      );

    const todoId = await createTodo(w);
    // 三种空形同一 400：整参缺失、空对象、两槽显式全空。
    await expect(relay({ todoIds: [todoId] })).rejects.toThrow(/两槽全空/);
    await expect(relay({ todoIds: [todoId], assignment: {} })).rejects.toThrow(/两槽全空/);
    await expect(
      relay({ todoIds: [todoId], assignment: { plan: null, build: null } }),
    ).rejects.toThrow(/两槽全空/);
    // 400 不留半启动态：todo 仍在 todo 相，补传后同 todo 派发成功。
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
    expect(todoRow.phase).toBe('todo');
    const out = JSON.parse(
      await relay({
        todoIds: [todoId],
        assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      }),
    ) as { builds: { id: string }[] };
    expect(out.builds).toHaveLength(1);
    const todoAfter = w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
    expect(todoAfter.phase).toBe('queued');
  });
});

describe('#1104 B：无主步 claim 面失败收尾（单源判据 agentForStep）', () => {
  test('失败方式 2：REST 空 assignment → 201 入队；claim 后失败收尾；不挡合法步', async () => {
    const w = await setupWorld();
    const unassignedId = await createTodo(w);
    const buildId = await startBuild(w, unassignedId, { plan: null, build: null }, false);
    // 更晚入队的合法步（FIFO 在后）：无主步失败不得造成队头阻塞。
    const validId = await createTodo(w);
    await startBuild(w, validId, { plan: null, build: { agentId: AGENT_ID } }, false);

    const claimed = await claim(w);
    expect(claimed?.step.kind).toBe('build'); // 领到的是合法步
    expectFailedFunnel(w.s, buildId, unassignedId, '无指派 Agent');
  });

  test('失败方式 3：scheduler 无指派 todo 定时触发 → 同漏斗', async () => {
    const w = await setupWorld();
    const todoId = await createTodo(w); // todo 无 assignment → 兜底全空
    const scheduler = createScheduler(w.s.svc, { tickMs: 60_000 });
    scheduler.start();
    try {
      const at = new Date('2026-10-01T00:00:00+08:00').getTime();
      const res = await req(w.s.app, 'POST', '/api/schedules', { todoId, kind: 'once', at });
      expect(res.status).toBe(201);
      scheduler.tick();
      const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.todoId, todoId)).get()!;
      expect(buildRow.triggerSource).toBe('schedule');

      await claim(w);
      expectFailedFunnel(w.s, buildRow.id, todoId, '无指派 Agent');
    } finally {
      scheduler.stop();
    }
  });

  test('失败方式 4：指派齐全路径行为不变（双槽 withPlan / 仅 build 直执行）', async () => {
    const w = await setupWorld();
    const dualId = await createTodo(w);
    await startBuild(
      w,
      dualId,
      { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      true,
    );
    const claimed1 = await claim(w);
    expect(claimed1?.step.kind).toBe('plan');

    const directId = await createTodo(w);
    await startBuild(w, directId, { plan: null, build: { agentId: AGENT_ID } }, false);
    const claimed2 = await claim(w);
    expect(claimed2?.step.kind).toBe('build');
  });

  test('失败方式 5：槽指向已删 Agent → 同漏斗，文案点名 agentId', async () => {
    const w = await setupWorld();
    const todoId = await createTodo(w);
    const buildId = await startBuild(
      w,
      todoId,
      { plan: null, build: { agentId: 'agent-gone' } },
      false,
    );
    await claim(w);
    expectFailedFunnel(w.s, buildId, todoId, 'agent-gone');
  });
});
