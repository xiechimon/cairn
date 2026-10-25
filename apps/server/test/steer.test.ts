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

  bindAllAgents(s);
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

describe('the steer server write surface (W3 #278)', () => {
  let w: World;
  beforeEach(async () => {
    w = await setupWorld();
  });

  test('failure modes 1/2: no claimed step 409 not silent; an unknown conversation 404; an empty body 400', async () => {
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

  test('happy path: sending to a claimed step -> 201 + the message row enters the transcript + steerPending exposed', async () => {
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

  test('failure mode 3: a double-send race -> single-slot overwrite', async () => {
    const { buildId } = await w.startBuild(true);
    await w.claim();
    await req(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, { content: '第一条' });
    await req(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, { content: '第二条' });
    const get = await req(w.s.app, 'GET', `/api/conversations/${buildId}/messages`);
    const face = (await get.json()) as { steerPending: string[] };
    expect(face.steerPending).toEqual(['第二条']);
  });

  test('failure modes 4/5: fetch-acknowledge; no credential 401', async () => {
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

  test('failure mode 6: the old step pending -> the new step fetch gets empty + discard', async () => {
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

  test('failure mode 7: the steer signal = machine stream {type:"steer", stepId} (the hub unit surface)', () => {
    const hub = new MachineWakeHub();
    const events: unknown[] = [];
    hub.subscribe('team-1', (ev) => events.push(ev));
    hub.steerSignal('team-1', 'step-9');
    expect(events).toEqual([{ type: 'steer', stepId: 'step-9' }]);
    const waiter = hub.waitWake('team-1', 30);
    hub.steerSignal('team-1', 'step-9');
    return waiter.then((woken) => expect(woken).toBe(false));
  });

  test('failure mode 9: zero regression on the chief conversation POST branch (the existing behavior unchanged)', async () => {
    const res = await req(w.s.app, 'POST', `/api/conversations/chief-nope/messages`, {
      content: 'x',
    });
    expect(res.status).toBe(404);
  });
});
