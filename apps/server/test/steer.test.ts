// steer 写面（W3 #278，06 册 D9）：POST /api/conversations/{id}/messages 的
// build 会话分支 = steer 语义（claimed 步门 409 + 单槽 pending + 拉取-确认投递
// + machine stream steer 信号）。失败方式枚举先于实现固化（票 #278 AC／
// spec #277 Testing Decisions）：
//   1. 无 claimed 步发送 → 409 不静默
//   2. 未知会话 → 404；空 body → 400（{content} min 1）
//   3. 双发竞态 → 单槽覆盖（pending 只余后发）
//   4. 拉取-确认：首次 {content}、二次 {content:null}
//   5. 无凭证/坏凭证拉取 → 401；他机不投递（pending 不清）
//   6. 旧步 pending（步收尾换新步）→ fetch 空 + 丢弃
//   7. steer 信号 → machine stream 收 {type:'steer', stepId}（hub 单元面）
//   8. GET messages 面 steerPending 透出 pending 内容
//   9. chief 会话 POST 分支零回归（既有 chief 行为不变）

import { type ClaimedStep, claimedStepSchema } from '@cairn/shared';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import { agent as agentTable, provider as providerTable } from '../src/db/schema.js';
import { MachineWakeHub } from '../src/services/machine-wake-hub.js';
import type { TestServer } from './helpers.js';
import { bindAllAgents, bootServer, issueApiKey, postProject, req } from './helpers.js';

const AGENT_ID = 'agent-stub-steer';

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
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
  );
}

interface World {
  s: TestServer;
  token: string;
  machineId: string;
  todoId: string;
  startBuild(withPlan?: boolean): Promise<{ buildId: string }>;
  claim(): Promise<{ step: ClaimedStep | null }>;
}

async function setupWorld(opts: { claimHoldMs?: number } = {}): Promise<World> {
  const s = bootServer({ claimHoldMs: opts.claimHoldMs ?? 250, pingIntervalMs: 3_600_000 });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-steer',
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
      displayName: 'stub-builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'test-mbp', cliVersion: '0.1.0' },
  });

  bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）
  expect(enrollRes.status).toBe(200);
  const machineJson = (await enrollRes.json()) as { token: string; machineId: string };
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '探针任务', spec: '写一行探针到 README.md' },
  });
  const todoBody = (await todoRes.json()) as { id: string };
  return {
    s,
    token: machineJson.token,
    machineId: machineJson.machineId,
    todoId: todoBody.id,
    async startBuild(withPlan = true) {
      const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
        body: {
          todoIds: [todoBody.id],
          assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
          withPlan,
        },
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { builds: { id: string }[] };
      return { buildId: body.builds[0]!.id };
    },
    async claim() {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', {
        cred: machineJson.token,
        body: {},
      });
      const body = (await res.json()) as { step: unknown };
      return { step: body.step ? claimedStepSchema.parse(body.step) : null };
    },
  };
}

describe('steer 服务端写面（W3 #278）', () => {
  let w: World;
  beforeEach(async () => {
    w = await setupWorld();
  });

  test('失败方式 1/2：无 claimed 步 409 不静默；未知会话 404；空 body 400', async () => {
    const { buildId } = await w.startBuild(true);
    const pending = await req(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, {
      content: '补充一句',
    });
    expect(pending.status).toBe(409);
    expect(Object.keys((await pending.json()) as object)).toEqual(['error']);
    const unknown = await req(w.s.app, 'POST', '/api/conversations/does-not-exist/messages', {
      content: 'x',
    });
    expect(unknown.status).toBe(404);
    const { step } = await w.claim();
    const empty = await req(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, {});
    expect(empty.status).toBe(400);
    expect(step).not.toBeNull();
  });

  test('happy path：claimed 步发送 → 201 + 消息行进 transcript + steerPending 透出', async () => {
    const { buildId } = await w.startBuild(true);
    await w.claim();
    const res = await req(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, {
      content: '顺便把测试也补上',
    });
    expect(res.status).toBe(201);
    const sent = (await res.json()) as { message: { id: string; role: string; content: string } };
    expect(sent.message.role).toBe('user');
    expect(sent.message.content).toBe('顺便把测试也补上');
    const get = await req(w.s.app, 'GET', `/api/conversations/${buildId}/messages`);
    const face = (await get.json()) as {
      messages: { role: string; content: string }[];
      steerPending: string[];
    };
    expect(face.messages.some((m) => m.role === 'user' && m.content === '顺便把测试也补上')).toBe(
      true,
    );
    expect(face.steerPending).toEqual(['顺便把测试也补上']);
  });

  test('失败方式 3：双发竞态 → 单槽覆盖', async () => {
    const { buildId } = await w.startBuild(true);
    await w.claim();
    await req(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, { content: '第一条' });
    await req(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, { content: '第二条' });
    const get = await req(w.s.app, 'GET', `/api/conversations/${buildId}/messages`);
    const face = (await get.json()) as { steerPending: string[] };
    expect(face.steerPending).toEqual(['第二条']);
  });

  test('失败方式 4/5：拉取-确认；无凭证 401', async () => {
    const { buildId } = await w.startBuild(true);
    const { step: claimed } = await w.claim();
    const stepId = claimed?.step.id ?? '';
    await req(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, { content: '拉我' });
    const noCred = await call(w.s.app, 'GET', `/api/machine/steer?stepId=${stepId}`);
    expect(noCred.status).toBe(401);
    const first = await call(w.s.app, 'GET', `/api/machine/steer?stepId=${stepId}`, {
      cred: w.token,
    });
    expect(await first.json()).toEqual({ content: '拉我' });
    const second = await call(w.s.app, 'GET', `/api/machine/steer?stepId=${stepId}`, {
      cred: w.token,
    });
    expect(await second.json()).toEqual({ content: null });
  });

  test('失败方式 6：旧步 pending → 新步 fetch 空 + 丢弃', async () => {
    const { buildId } = await w.startBuild(true);
    const { step: claimed } = await w.claim();
    const oldStepId = claimed?.step.id ?? '';
    await req(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, { content: '旧步的补充' });
    await call(w.s.app, 'POST', `/api/machine/done/${oldStepId}`, {
      cred: w.token,
      body: { status: 'success' },
    });
    await req(w.s.app, 'POST', `/api/builds/${buildId}/steps`, { action: 'confirm' });
    const next = await w.claim();
    const newStepId = next.step?.step.id ?? '';
    expect(newStepId).not.toBe('');
    const fetch = await call(w.s.app, 'GET', `/api/machine/steer?stepId=${newStepId}`, {
      cred: w.token,
    });
    expect(await fetch.json()).toEqual({ content: null });
    const get = await req(w.s.app, 'GET', `/api/conversations/${buildId}/messages`);
    const face = (await get.json()) as { steerPending: string[] };
    expect(face.steerPending).toEqual([]);
  });

  test('失败方式 7：steer 信号 = machine stream {type:"steer", stepId}（hub 单元面）', () => {
    const hub = new MachineWakeHub();
    const events: unknown[] = [];
    hub.subscribe('team-1', (ev) => events.push(ev));
    hub.steerSignal('team-1', 'step-9');
    expect(events).toEqual([{ type: 'steer', stepId: 'step-9' }]);
    // 不触发 claim 长轮询 wake（steer 不入队）：等待者不被唤醒。
    const waiter = hub.waitWake('team-1', 30);
    hub.steerSignal('team-1', 'step-9');
    return waiter.then((woken) => expect(woken).toBe(false));
  });

  test('失败方式 9：chief 会话 POST 分支零回归（既有行为不变）', async () => {
    // chief 会话发送走 chief 分支（本票不动）：非 chief- 前缀外的会话才进 steer。
    // chief 面回归 = chief.test.ts 既有覆盖；此处只钉分流不误伤 chief 形状。
    const res = await req(w.s.app, 'POST', `/api/conversations/chief-nope/messages`, {
      content: 'x',
    });
    expect(res.status).toBe(404);
  });
});
