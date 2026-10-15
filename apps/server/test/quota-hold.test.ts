// #1257 额度挂起（等额度）：relay 配额打满（402/usage limit 族错误）是配额
// 事件不是任务失败——done(failed) 面 classifyStepFailure → quota 时挂起步子
// 而非判死：步回 pending（认领位复位、sessionId 续接面在位、holdUntil 退避），
// todo 不落 failed，额度恢复后经既有 claim 循环自动续跑。挂起/续跑闭环 +
// waitingOn 板面派生（「等机器」/「等额度」与失败红态的区分）。
// 失败方式（先于实现固化）：
//  1. quota 失败 → 挂起：pending + 机位清 + sessionId ← done 载荷 + holdUntil
//     = now+首档退避；todo/build 不落失败痕迹；会话流 step pending 事件 +
//     等额度 system 行。
//  2. 挂起期间（holdUntil 未到）claim 不到该步。
//  3. holdUntil 过后可领：session 载荷 continue + 挂起步自己的 sessionId。
//  4. 续跑再失败 quota → 退避升级（第二档 5 分钟）。
//  5. 第三档起退避封顶（15 分钟）。
//  6. 非 quota 失败（network 文案）→ 走既有失败漏斗（step/todo failed +
//     build.errorMessage）。
//  7. waitingOn 派生：quota 挂起 → {on:'quota'}；归属机离线 / 团队零在线 →
//     {on:'machine'}；机器健康可领 → 缺席（正常排队）；非在飞相位 → 缺席。

import type { ClaimedStep } from '@pacman/shared';
import { claimedStepSchema } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  message as messageTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { QUOTA_HOLD_BACKOFF_MS } from '../src/services/dispatch-timeouts.js';
import { toTodoRecord } from '../src/services/todos.js';
import { bootServer, issueApiKey, postProject } from './helpers.js';

const QUOTA_ERROR = '402: {"message":"insufficient quota: usage limit reached","type":..}';
const NETWORK_ERROR = 'upstream stream disconnected: connection reset by peer';

async function call(
  app: Hono,
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

const AGENT_ID = 'agent-quota-1';

/** provider/agent + enroll + 项目/todo 就位（项目不绑 repo：本测试只走 claim →
 * done 面，不产物件）。直执行 build 步（withPlan=false）简化相位链。 */
async function setupWorld() {
  const s = bootServer({ claimHoldMs: 200 });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-quota',
      teamId: s.team.id,
      kind: 'custom',
      providerId: 'stub-gw',
      label: 'Stub Gateway',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [{ id: 'stub-model', name: 'stub-model' }],
      createdBy: s.user.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'quota-builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'quota-mbp', cliVersion: '0.1.0' },
  });
  const { token } = (await enrollRes.json()) as { token: string };
  const machineId = s.db.select().from(machineTable).limit(1).all()[0]!.id;
  s.db.update(machineTable).set({ online: true }).where(eq(machineTable.id, machineId)).run();
  // #1259 归属机绑定：quota 世界可领的缺省形态（agent 绑到唯一机器）。
  s.db.update(agentTable).set({ machineId }).where(eq(agentTable.id, AGENT_ID)).run();
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '额度探针任务', spec: '写一行探针到 README.md' },
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };

  async function startBuild(): Promise<string> {
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: {
        todoIds: [todoId],
        assignment: { plan: null, build: { agentId: AGENT_ID } },
        withPlan: false,
      },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { builds: { id: string }[] };
    return body.builds[0]!.id;
  }
  async function claim(): Promise<ClaimedStep | null> {
    const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
    const body = (await res.json()) as { step: unknown };
    if (!body.step) return null;
    return claimedStepSchema.parse(body.step);
  }
  async function done(stepId: string, body: Record<string, unknown>): Promise<void> {
    const res = await call(s.app, 'POST', `/api/machine/done/${stepId}`, { cred: token, body });
    if (res.status !== 200) throw new Error(`done returned ${res.status}`);
  }
  const todoRow = () => s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
  const buildRow = (buildId: string) =>
    s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
  const stepRow = (stepId: string) =>
    s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
  const messagesOf = (conversationId: string) =>
    s.db.select().from(messageTable).where(eq(messageTable.conversationId, conversationId)).all();
  return {
    s,
    token,
    machineId,
    todoId,
    startBuild,
    claim,
    done,
    todoRow,
    buildRow,
    stepRow,
    messagesOf,
  };
}

describe('#1257 quota 挂起（done 面分类 + 挂起/续跑闭环）', () => {
  test('失败方式 1：quota 失败 → 挂起（pending + 机位清 + sessionId 续接面 + holdUntil 首档；零失败痕迹 + step pending 事件 + 等额度行）', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild();
    const events: object[] = [];
    const untap = w.s.convHub.subscribe(buildId, {
      nextSeq: () => 1,
      send: (payload: object) => {
        events.push(payload);
        return Promise.resolve();
      },
    });
    const step = (await w.claim())!;
    expect(step.step.kind).toBe('build');

    const before = Date.now();
    await w.done(step.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
      sessionId: 'pi-sess-quota-1',
    });

    const row = w.stepRow(step.step.id);
    expect(row.status).toBe('pending');
    expect(row.machineId).toBeNull();
    expect(row.sessionId).toBe('pi-sess-quota-1'); // 续接面：重领时 continue
    expect(row.holdReason).toBe('quota');
    expect(row.holdCount).toBe(1);
    expect(row.holdUntil).not.toBeNull();
    expect(row.holdUntil! - before).toBeGreaterThanOrEqual(QUOTA_HOLD_BACKOFF_MS[0]! - 1_000);
    expect(row.holdUntil! - before).toBeLessThanOrEqual(QUOTA_HOLD_BACKOFF_MS[0]! + 5_000);
    // 零失败痕迹：todo 不落 failed、build.errorMessage 空。
    expect(w.todoRow().phase).not.toBe('failed');
    expect(w.buildRow(buildId).errorMessage).toBeNull();
    // 会话流：step pending 事件（挂起面与释放同形；订阅先于 claim，取最后
    // 一条 step 事件 = 挂起事件）。
    const stepEvents = events.filter(
      (e): e is { type: string; step: { status: string; id: string } } =>
        (e as { type?: string }).type === 'step',
    );
    const stepEv = stepEvents[stepEvents.length - 1];
    expect(stepEv?.step.status).toBe('pending');
    // 会话流 + 落库：等额度 system 行（可见态：原因 + 下次尝试）。
    const holdRows = w.messagesOf(buildId).filter((m) => m.id === `quota-hold-${step.step.id}`);
    expect(holdRows).toHaveLength(1);
    expect(holdRows[0]!.role).toBe('system');
    const content = String(holdRows[0]!.content);
    expect(content).toContain('等额度');
    expect(content).toContain('下次尝试');
    untap();
  });

  test('失败方式 2：挂起期间 claim 不到（holdUntil 未到）', async () => {
    const w = await setupWorld();
    await w.startBuild();
    const step = (await w.claim())!;
    await w.done(step.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
      sessionId: 'pi-sess-quota-1',
    });
    expect(w.stepRow(step.step.id).status).toBe('pending');

    const claimed = await w.claim();
    expect(claimed).toBeNull(); // 退避期内不可领
  });

  test('失败方式 3：holdUntil 过后可领，session 载荷 continue + 挂起步自己的 sessionId（额度回来即自动续跑）', async () => {
    const w = await setupWorld();
    await w.startBuild();
    const step = (await w.claim())!;
    await w.done(step.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
      sessionId: 'pi-sess-quota-1',
    });
    // 退避到期（时间旅行：直写 holdUntil 到过去）。
    w.s.db
      .update(stepTable)
      .set({ holdUntil: Date.now() - 1 })
      .where(eq(stepTable.id, step.step.id))
      .run();

    const reclaimed = await w.claim();
    expect(reclaimed).not.toBeNull();
    expect(reclaimed!.step.id).toBe(step.step.id);
    expect(reclaimed!.session.action).toBe('continue');
    expect(reclaimed!.session.sessionId).toBe('pi-sess-quota-1');
  });

  test('失败方式 4：续跑再失败 quota → 退避升级第二档', async () => {
    const w = await setupWorld();
    await w.startBuild();
    const step = (await w.claim())!;
    await w.done(step.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
      sessionId: 'pi-sess-1',
    });
    w.s.db
      .update(stepTable)
      .set({ holdUntil: Date.now() - 1 })
      .where(eq(stepTable.id, step.step.id))
      .run();
    const reclaimed = (await w.claim())!;
    const before = Date.now();
    await w.done(reclaimed.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
      sessionId: 'pi-sess-2',
    });

    const row = w.stepRow(step.step.id);
    expect(row.holdCount).toBe(2);
    expect(row.holdUntil! - before).toBeGreaterThanOrEqual(QUOTA_HOLD_BACKOFF_MS[1]! - 1_000);
    expect(row.holdUntil! - before).toBeLessThanOrEqual(QUOTA_HOLD_BACKOFF_MS[1]! + 5_000);
  });

  test('失败方式 5：第三档起退避封顶', async () => {
    const w = await setupWorld();
    await w.startBuild();
    const step = (await w.claim())!;
    // 直写第二档起点（两轮已耗）：再失败应落第三档（= 封顶值）。
    w.s.db
      .update(stepTable)
      .set({ holdReason: 'quota', holdCount: 2, holdUntil: Date.now() - 1 })
      .where(eq(stepTable.id, step.step.id))
      .run();
    w.s.db
      .update(stepTable)
      .set({ status: 'claimed', machineId: w.machineId })
      .where(eq(stepTable.id, step.step.id))
      .run();
    const before = Date.now();
    await w.done(step.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
      sessionId: 'pi-sess-3',
    });

    const row = w.stepRow(step.step.id);
    expect(row.holdCount).toBe(3);
    expect(row.holdUntil! - before).toBeGreaterThanOrEqual(QUOTA_HOLD_BACKOFF_MS[2]! - 1_000);
    expect(row.holdUntil! - before).toBeLessThanOrEqual(QUOTA_HOLD_BACKOFF_MS[2]! + 5_000);
    // 第四次同样封顶（不无限增长）。
    w.s.db
      .update(stepTable)
      .set({ holdCount: 9, holdUntil: Date.now() - 1, status: 'claimed', machineId: w.machineId })
      .where(eq(stepTable.id, step.step.id))
      .run();
    await w.done(step.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
      sessionId: 'pi-sess-4',
    });
    const capped = w.stepRow(step.step.id);
    expect(capped.holdCount).toBe(10);
    expect(capped.holdUntil! - before).toBeLessThanOrEqual(QUOTA_HOLD_BACKOFF_MS[2]! + 5_000);
  });

  test('失败方式 6：非 quota 失败（network 文案）→ 走既有失败漏斗（step/todo failed + errorMessage）', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild();
    const step = (await w.claim())!;

    await w.done(step.step.id, {
      status: 'failed',
      errorMessage: NETWORK_ERROR,
      sessionId: 'pi-sess-net-1',
    });

    expect(w.stepRow(step.step.id).status).toBe('failed');
    expect(w.todoRow().phase).toBe('failed');
    expect(w.buildRow(buildId).errorMessage).toContain('upstream stream disconnected');
  });

  test('退避档位单源（60s → 5min → 15min 封顶）', () => {
    expect(QUOTA_HOLD_BACKOFF_MS).toEqual([60_000, 300_000, 900_000]);
  });
});

describe('#1257 waitingOn 板面派生（「等机器」/「等额度」与失败红态的区分）', () => {
  test('quota 挂起 → waitingOn {on:"quota", retryAt=holdUntil}', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild();
    const step = (await w.claim())!;
    await w.done(step.step.id, {
      status: 'failed',
      errorMessage: QUOTA_ERROR,
      sessionId: 'pi-sess-quota-1',
    });

    const record = toTodoRecord(w.s.svc, w.todoRow());
    expect(record.waitingOn).toEqual({
      on: 'quota',
      retryAt: w.stepRow(step.step.id).holdUntil,
    });
    expect(buildId).not.toBeNull();
  });

  test('归属机离线 → waitingOn {on:"machine"}', async () => {
    const w = await setupWorld();
    await w.startBuild();
    w.s.db
      .update(machineTable)
      .set({ online: false })
      .where(eq(machineTable.id, w.machineId))
      .run();

    const record = toTodoRecord(w.s.svc, w.todoRow());
    expect(record.waitingOn).toEqual({ on: 'machine', retryAt: null });
  });

  test('团队零在线机器 → waitingOn {on:"machine"}', async () => {
    const w = await setupWorld();
    await w.startBuild();
    w.s.db
      .update(machineTable)
      .set({ online: false })
      .where(eq(machineTable.id, w.machineId))
      .run();

    const record = toTodoRecord(w.s.svc, w.todoRow());
    expect(record.waitingOn).toEqual({ on: 'machine', retryAt: null });
  });

  test('机器健康可领 → waitingOn 缺席（正常排队，不是挂起态）', async () => {
    const w = await setupWorld();
    await w.startBuild();

    const record = toTodoRecord(w.s.svc, w.todoRow());
    expect(record.waitingOn).toBeUndefined();
  });

  test('非在飞相位 → waitingOn 缺席（派生只答在飞卡的挂起态）', async () => {
    const w = await setupWorld();
    // todo 卡在 todo 相位（未启动）：即便机器全灭也不产 waitingOn。
    w.s.db
      .update(machineTable)
      .set({ online: false })
      .where(eq(machineTable.id, w.machineId))
      .run();

    const record = toTodoRecord(w.s.svc, w.todoRow());
    expect(record.waitingOn).toBeUndefined();
  });
});
