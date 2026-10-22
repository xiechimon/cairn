// 模型降级链 + provider 熔断（#1493）：machine done(failed) → plan/build 步
// 换到下一个健康备选重派；审核/验证/合并步只等不换。失败方式枚举先于实现
// （AGENTS.md 测试规则 3，票面「失败方式」逐条落到下面）：
//   X1 不换：主模型额度用完时步挂起等额度，配了备选也不用。断言步回
//      pending、fallback.model = 第一个备选、claim 载荷改发备选模型、凭证
//      改发备选 provider。
//   X2 死循环：备选全挂后链继续转。断言链走完回落 waiting_quota，tried 封顶。
//   X3 弱模型放行：review / merge 步被降级。断言只等不换（负对照）。
//   X4 显式模型被换：agent 没配备选也被换。断言旧行为（waiting_quota）。
//   X5 限流也换：429 换模型丢上下文。断言 capacity 不换。
//   X6 会话串台：换模型后续用旧 provider 的会话。断言 claim session=new。
//   X7 熔断失明：open 的 provider 仍被选为备选。断言跳过它选下一个。
//   X8 runtime 闸漏判：选了归属机没开 runtime 的备选，步卡 pending。断言跳过。
//   X9 不可见：换模型零痕迹。断言会话流 system 行 + model_fallback 通知。
//   X10 404 / 认证失败不换：断言两类都换。
//   X11 0 token 静默成功：断言重试一次，第二次按失败收尾；daemon 没说「无
//      输出」或没上报 usage 都不判（pi 对不回 usage 的 relay 也报 0 token）。
//   X12 降级后续不上自己的会话：备选上跑出的会话在挂起释放后被丢弃。断言
//      续接本步在备选上的会话。

import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  message as messageTable,
  notification as notificationTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { providerHealth } from '../src/services/provider-health.js';
import { sweepQuotaWaitSteps } from '../src/services/quota-wait.js';
import { bootServer, issueApiKey, postProject, type TestServer } from './helpers.js';

const AGENT_ID = 'agent-fallback-1';

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

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});
beforeEach(() => {
  providerHealth.reset();
});

interface World {
  s: TestServer;
  token: string;
  projectId: string;
  todoId: string;
}

function insertProvider(s: TestServer, providerId: string): void {
  s.db
    .insert(providerTable)
    .values({
      id: `prov-${providerId}`,
      teamId: s.team.id,
      kind: 'custom',
      providerId,
      label: providerId.toUpperCase(),
      baseUrl: `http://127.0.0.1:9/${providerId}`,
      api: 'openai-completions',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [{ id: 'm', name: 'm' }],
      createdBy: s.user.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

async function setupWorld(
  fallbackModels: { provider: string; modelId: string }[] | null = [
    { provider: 'relay-b', modelId: 'model-b' },
    { provider: 'relay-c', modelId: 'model-c' },
  ],
): Promise<World> {
  const s = bootServer({ claimHoldMs: 200, pingIntervalMs: 3_600_000 });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  for (const p of ['relay-a', 'relay-b', 'relay-c']) insertProvider(s, p);
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'fallback-builder',
      provider: 'relay-a',
      modelId: 'model-a',
      fallbackModels,
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'fallback-box', cliVersion: '0.1.0' },
  });
  expect(enrollRes.status).toBe(200);
  const token = ((await enrollRes.json()) as { token: string }).token;
  const machineRow = s.db.select().from(machineTable).limit(1).all()[0]!;
  s.db
    .update(machineTable)
    .set({ enabledRuntimes: ['pi'] })
    .where(eq(machineTable.id, machineRow.id))
    .run();
  s.db
    .update(agentTable)
    .set({ machineId: machineRow.id })
    .where(eq(agentTable.id, AGENT_ID))
    .run();
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '降级链探针', spec: '写一行探针' },
  });
  const todoId = ((await todoRes.json()) as { id: string }).id;
  return { s, token, projectId, todoId };
}

async function startBuild(w: World): Promise<string> {
  const res = await call(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
    body: {
      todoIds: [w.todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: false,
    },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id;
}

interface Claimed {
  stepId: string;
  provider: string | null;
  modelId: string | null;
  session: { action: string; sessionId: string | null };
}

async function claim(w: World): Promise<Claimed> {
  const res = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
    cred: w.token,
    body: {},
  });
  const body = (await res.json()) as {
    step?: {
      step?: { id?: string };
      agent?: { provider: string | null; modelId: string | null };
      session?: { action: string; sessionId: string | null };
    };
  };
  const stepId = body.step?.step?.id;
  if (!stepId) {
    throw new Error(`claim returned no step (status=${res.status} body=${JSON.stringify(body)})`);
  }
  return {
    stepId,
    provider: body.step?.agent?.provider ?? null,
    modelId: body.step?.agent?.modelId ?? null,
    session: body.step?.session ?? { action: '?', sessionId: null },
  };
}

async function done(w: World, stepId: string, body: Record<string, unknown>): Promise<void> {
  const res = await call(w.s.app, 'POST', `/api/machine/done/${stepId}`, { cred: w.token, body });
  expect(res.status).toBe(200);
}

function quotaDone(providerId: string): Record<string, unknown> {
  return {
    status: 'failed',
    errorMessage: '402: quota exceeded',
    sessionId: `sess-${providerId}`,
    quotaBlock: { kind: 'quota', providerId, reason: '402: quota exceeded' },
  };
}

function stepRow(w: World, stepId: string) {
  return w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
}

describe('模型降级链（#1493）', () => {
  test('X1+X6+X9：主模型额度用完 → 换第一个备选重派（新会话、凭证跟着换、可见）', async () => {
    const w = await setupWorld();
    const buildId = await startBuild(w);
    const first = await claim(w);
    expect(first.provider).toBe('relay-a');
    expect(first.modelId).toBe('model-a');
    await done(w, first.stepId, quotaDone('relay-a'));

    const row = stepRow(w, first.stepId);
    expect(row.status).toBe('pending');
    expect(row.machineId).toBeNull();
    expect(row.fallback?.model).toEqual({ provider: 'relay-b', modelId: 'model-b' });
    expect(row.fallback?.tried).toEqual(['relay-a/model-a', 'relay-b/model-b']);
    // todo 不判死、build 无错误。
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('building');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.errorMessage).toBeNull();

    const again = await claim(w);
    expect(again.stepId).toBe(first.stepId);
    expect(again.provider).toBe('relay-b');
    expect(again.modelId).toBe('model-b');
    // X6：换 provider = 新会话（不续 relay-a 的 sess-relay-a）。
    expect(again.session.action).toBe('new');
    // 凭证跟着换：token 端点下发 relay-b 的 provider 配置。
    const tokRes = await call(w.s.app, 'GET', `/api/machine/token/${again.stepId}`, {
      cred: w.token,
    });
    expect(tokRes.status).toBe(200);
    const tok = (await tokRes.json()) as { provider: { providerId: string } | null };
    expect(tok.provider?.providerId).toBe('relay-b');

    // X9：会话流 system 行 + model_fallback 通知。
    const notes = w.s.db
      .select()
      .from(messageTable)
      .where(and(eq(messageTable.conversationId, buildId), eq(messageTable.role, 'system')))
      .all();
    const note = notes.map((n) => String(n.content)).find((c) => c.includes('model-b'));
    expect(note).toContain('model-a');
    const notif = w.s.db
      .select()
      .from(notificationTable)
      .where(eq(notificationTable.entityId, w.todoId))
      .all();
    expect(notif.map((n) => n.type)).toContain('model_fallback');
  });

  test('X2：备选全挂 → 回落 waiting_quota，不死循环', async () => {
    const w = await setupWorld();
    await startBuild(w);
    const a = await claim(w);
    await done(w, a.stepId, quotaDone('relay-a'));
    const b = await claim(w);
    expect(b.provider).toBe('relay-b');
    await done(w, b.stepId, quotaDone('relay-b'));
    const c = await claim(w);
    expect(c.provider).toBe('relay-c');
    await done(w, c.stepId, quotaDone('relay-c'));
    const row = stepRow(w, a.stepId);
    expect(row.status).toBe('waiting_quota');
    expect(row.fallback?.tried).toHaveLength(3);
    // 链走完停在最后一个备选上等额度（不回绕重试主模型）。
    expect(row.fallback?.model).toEqual({ provider: 'relay-c', modelId: 'model-c' });
  });

  test('X12：降级后的步挂起等额度、释放重领时续它自己在备选上的会话', async () => {
    const w = await setupWorld([{ provider: 'relay-b', modelId: 'model-b' }]);
    await startBuild(w);
    const a = await claim(w);
    await done(w, a.stepId, quotaDone('relay-a'));
    const b = await claim(w);
    expect(b.session.action).toBe('new');
    await done(w, b.stepId, quotaDone('relay-b'));
    const held = stepRow(w, a.stepId);
    expect(held.status).toBe('waiting_quota');
    sweepQuotaWaitSteps(w.s.svc, held.quotaBlock!.probeAt + 1);
    const c = await claim(w);
    expect(c.provider).toBe('relay-b');
    expect(c.session).toEqual({ action: 'continue', sessionId: 'sess-relay-b' });
  });

  test.each(['review', 'merge'] as const)(
    'X3：%s 步禁止降级——额度用完只等不换（负对照）',
    async (kind) => {
      const w = await setupWorld();
      await startBuild(w);
      const pending = w.s.db.select().from(stepTable).where(eq(stepTable.status, 'pending')).get()!;
      w.s.db
        .update(stepTable)
        .set({
          kind,
          prompt: kind === 'review' ? `{"kind":"review","agentId":"${AGENT_ID}"}\n审一下` : null,
        })
        .where(eq(stepTable.id, pending.id))
        .run();
      const c = await claim(w);
      expect(c.stepId).toBe(pending.id);
      await done(w, c.stepId, quotaDone('relay-a'));
      const row = stepRow(w, c.stepId);
      expect(row.status).toBe('waiting_quota');
      expect(row.fallback).toBeNull();
      const notif = w.s.db
        .select()
        .from(notificationTable)
        .where(eq(notificationTable.type, 'model_fallback'))
        .all();
      expect(notif).toHaveLength(0);
    },
  );

  test('X4：agent 没配备选 → 旧行为（waiting_quota）', async () => {
    const w = await setupWorld(null);
    await startBuild(w);
    const c = await claim(w);
    await done(w, c.stepId, quotaDone('relay-a'));
    const row = stepRow(w, c.stepId);
    expect(row.status).toBe('waiting_quota');
    expect(row.fallback).toBeNull();
  });

  test('X5：限流（capacity）不换模型', async () => {
    const w = await setupWorld();
    await startBuild(w);
    const c = await claim(w);
    await done(w, c.stepId, {
      status: 'failed',
      errorMessage: '429 rate limited',
      quotaBlock: { kind: 'capacity', providerId: 'relay-a', reason: '429 rate limited' },
    });
    const row = stepRow(w, c.stepId);
    expect(row.status).toBe('waiting_quota');
    expect(row.fallback).toBeNull();
  });

  test('X7：open 的 provider 不被选为备选', async () => {
    const w = await setupWorld();
    for (let i = 0; i < 5; i++) providerHealth.recordFailure('relay-b');
    expect(providerHealth.state('relay-b')).toBe('open');
    await startBuild(w);
    const c = await claim(w);
    await done(w, c.stepId, quotaDone('relay-a'));
    expect(stepRow(w, c.stepId).fallback?.model).toEqual({
      provider: 'relay-c',
      modelId: 'model-c',
    });
  });

  test('X8：归属机没开对应 runtime 的备选直接跳过', async () => {
    const w = await setupWorld([
      { provider: 'claude-code', modelId: 'claude-sonnet' },
      { provider: 'relay-c', modelId: 'model-c' },
    ]);
    await startBuild(w);
    const c = await claim(w);
    await done(w, c.stepId, quotaDone('relay-a'));
    expect(stepRow(w, c.stepId).fallback?.model).toEqual({
      provider: 'relay-c',
      modelId: 'model-c',
    });
  });

  test('X10：模型 404 与认证失败也换', async () => {
    for (const errorMessage of [
      'POST /v1/messages 404 model_not_found',
      'Error: 401 {"type":"error","error":{"type":"authentication_error"}}',
    ]) {
      const w = await setupWorld();
      await startBuild(w);
      const c = await claim(w);
      await done(w, c.stepId, { status: 'failed', errorMessage });
      const row = stepRow(w, c.stepId);
      expect(row.status).toBe('pending');
      expect(row.fallback?.model).toEqual({ provider: 'relay-b', modelId: 'model-b' });
    }
  });

  test('熔断计数：额度用完记 provider 连败，成功清零', async () => {
    const w = await setupWorld();
    await startBuild(w);
    const a = await claim(w);
    await done(w, a.stepId, quotaDone('relay-a'));
    for (let i = 0; i < 2; i++) providerHealth.recordFailure('relay-a');
    expect(providerHealth.state('relay-a')).toBe('degraded');
    providerHealth.recordFailure('relay-b');
    const b = await claim(w);
    await done(w, b.stepId, {
      status: 'success',
      usage: [{ model: 'relay-b/model-b', input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }],
    });
    expect(providerHealth.state('relay-b')).toBe('healthy');
    expect(providerHealth.state('relay-a')).toBe('degraded');
  });
});

describe('0 token 静默失败（#1493）', () => {
  const zeroUsage = [
    { model: 'relay-a/model-a', input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  ];

  test('X11：成功但 0 token 且无输出 → 同模型重试一次，再来一次按失败收尾', async () => {
    const w = await setupWorld(null);
    const buildId = await startBuild(w);
    const a = await claim(w);
    await done(w, a.stepId, { status: 'success', usage: zeroUsage, noOutput: true });
    let row = stepRow(w, a.stepId);
    expect(row.status).toBe('pending');
    expect(row.fallback?.zeroUsageRetried).toBe(true);
    expect(row.fallback?.model).toBeNull();
    const b = await claim(w);
    expect(b.stepId).toBe(a.stepId);
    expect(b.provider).toBe('relay-a');
    await done(w, b.stepId, { status: 'success', usage: zeroUsage, noOutput: true });
    row = stepRow(w, a.stepId);
    expect(row.status).toBe('failed');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.errorMessage).toContain('0 token');
  });

  test('X11 负对照：0 token 但 daemon 没说无输出（不回 usage 的 relay）不判', async () => {
    const w = await setupWorld(null);
    await startBuild(w);
    const a = await claim(w);
    await done(w, a.stepId, { status: 'success', usage: zeroUsage });
    expect(stepRow(w, a.stepId).status).not.toBe('pending');
    expect(stepRow(w, a.stepId).fallback).toBeNull();
  });

  test('X11 负对照：没上报 usage（老 daemon）不判', async () => {
    const w = await setupWorld(null);
    await startBuild(w);
    const a = await claim(w);
    await done(w, a.stepId, { status: 'success' });
    expect(stepRow(w, a.stepId).status).not.toBe('pending');
    expect(stepRow(w, a.stepId).fallback).toBeNull();
  });
});

describe('agent 写面（#1493）', () => {
  test('PATCH fallbackModels：落库 + 记录投影 + 超过 5 个 400 + null 清空', async () => {
    const w = await setupWorld(null);
    const path = `/api/teams/${w.s.team.id}/agents/${AGENT_ID}`;
    const six = Array.from({ length: 6 }, (_, i) => ({ provider: 'relay-b', modelId: `m${i}` }));
    expect((await call(w.s.app, 'PATCH', path, { body: { fallbackModels: six } })).status).toBe(
      400,
    );
    const ok = await call(w.s.app, 'PATCH', path, {
      body: { fallbackModels: [{ provider: 'relay-b', modelId: 'model-b' }] },
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { fallbackModels: unknown }).fallbackModels).toEqual([
      { provider: 'relay-b', modelId: 'model-b' },
    ]);
    const cleared = await call(w.s.app, 'PATCH', path, { body: { fallbackModels: null } });
    expect(((await cleared.json()) as { fallbackModels: unknown }).fallbackModels).toBeNull();
  });
});
