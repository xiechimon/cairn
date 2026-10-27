import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  chiefMessage,
  machine as machineTable,
  provider as providerTable,
  steerPending,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { providerHealth } from '../src/services/provider-health.js';
import { bootServer, issueApiKey, type TestServer } from './helpers.js';

const AGENT_ID = 'agent-chief-queue';
const QUOTA_ERROR = '402: {"message":"insufficient quota: usage limit reached","type":..}';

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

interface PendingEntry {
  messageId: string;
  state: 'queued' | 'held';
}
interface ThreadView {
  id: string;
  activeRun: unknown;
  pending?: PendingEntry[];
  fallbackModel?: string | null;
}

async function setupWorld(fallbackModels: { provider: string; modelId: string }[] | null = null) {
  const s: TestServer = bootServer({ claimHoldMs: 100, pingIntervalMs: 3_600_000 });
  disposables.push(() => s.dispose());
  const teamId = s.team.id;
  const key = await issueApiKey(s);
  for (const p of ['relay-a', 'relay-b']) {
    s.db
      .insert(providerTable)
      .values({
        id: `prov-${p}`,
        teamId,
        kind: 'custom',
        providerId: p,
        label: p.toUpperCase(),
        baseUrl: `http://127.0.0.1:9/${p}`,
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
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId, name: 'queue-box', cliVersion: '0.1.0' },
  });
  const { token } = (await enrollRes.json()) as { token: string };
  const machineId = s.db.select().from(machineTable).limit(1).all()[0]!.id;
  s.db
    .update(machineTable)
    .set({ online: true, enabledRuntimes: ['pi'], maxConcurrent: 4 })
    .where(eq(machineTable.id, machineId))
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId,
      displayName: 'queue-chief',
      provider: 'relay-a',
      modelId: 'model-a',
      machineId,
      fallbackModels,
    })
    .run();
  const projRes = await call(s.app, 'POST', '/api/projects', { body: { name: 'queue-proj' } });
  const projectId = ((await projRes.json()) as { id: string }).id;
  await call(s.app, 'PATCH', `/api/teams/${teamId}/chief`, {
    body: { agent: { agentId: AGENT_ID } },
  });

  let threadId: string | null = null;
  return {
    s,
    teamId,
    projectId,
    get threadId() {
      if (threadId === null) throw new Error('no thread yet');
      return threadId;
    },
    async send(content: string): Promise<string> {
      const res =
        threadId === null
          ? await call(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, { body: { content } })
          : await call(s.app, 'POST', `/api/conversations/${threadId}/messages`, {
              body: { content },
            });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { thread: { id: string }; message: { id: string } };
      threadId = body.thread.id;
      return body.message.id;
    },
    async claim(): Promise<ClaimedStep | null> {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
      const body = (await res.json()) as { step: unknown };
      return body.step ? claimedStepSchema.parse(body.step) : null;
    },
    async done(stepId: string, body: Record<string, unknown>): Promise<void> {
      const res = await call(s.app, 'POST', `/api/machine/done/${stepId}`, { cred: token, body });
      expect(res.status).toBe(200);
    },
    async relay(stepId: string, name: string, params: Record<string, unknown>) {
      const res = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
        cred: token,
        body: { name, params },
      });
      expect(res.status).toBe(200);
      return JSON.parse(((await res.json()) as { text: string }).text) as Record<string, unknown>;
    },
    async reportTool(stepId: string, call_: Record<string, unknown>) {
      const res = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
        cred: token,
        body: call_,
      });
      expect(res.status).toBe(200);
    },
    async thread(): Promise<ThreadView> {
      const res = await call(s.app, 'GET', `/api/teams/${teamId}/chief/threads`);
      const list = (await res.json()) as ThreadView[];
      return list.find((t) => t.id === threadId)!;
    },
    async envelope() {
      const res = await call(s.app, 'GET', `/api/teams/${teamId}/chief`);
      return (await res.json()) as {
        outage?: { reason: string; retryAt: number | null; model: string | null } | null;
      };
    },
    messages() {
      return s.db
        .select()
        .from(chiefMessage)
        .where(eq(chiefMessage.threadId, threadId ?? ''))
        .all();
    },
    withdraw(messageId: string) {
      return call(
        s.app,
        'DELETE',
        `/api/teams/${teamId}/chief/threads/${threadId}/messages/${messageId}`,
      );
    },
    steer(messageId: string) {
      return call(
        s.app,
        'POST',
        `/api/teams/${teamId}/chief/threads/${threadId}/messages/${messageId}/steer`,
      );
    },
    stop() {
      return call(s.app, 'POST', `/api/teams/${teamId}/chief/threads/${threadId}/stop`);
    },
    async ackSteer(stepId: string) {
      const res = await call(s.app, 'POST', `/api/machine/steer/ack?stepId=${stepId}`, {
        cred: token,
      });
      expect(res.status).toBe(200);
    },
    async fetchSteer(stepId: string) {
      const res = await call(s.app, 'GET', `/api/machine/steer?stepId=${stepId}`, { cred: token });
      return ((await res.json()) as { content: string | null }).content;
    },
    stepRow(id: string) {
      return s.db.select().from(stepTable).where(eq(stepTable.id, id)).get();
    },
  };
}

describe('chief turn queue (T5): one turn per thread, oldest first', () => {
  test('a message sent while a turn runs waits as queued and is not claimed beside it', async () => {
    const w = await setupWorld();
    await w.send('第一句');
    const first = await w.claim();
    expect(first).not.toBeNull();
    const second = await w.send('第二句');
    expect(await w.claim()).toBeNull();
    const view = await w.thread();
    expect(view.pending).toEqual([{ messageId: second, state: 'queued' }]);
    await w.done(first!.step.id, { status: 'success' });
    const after = await w.thread();
    expect(after.activeRun).not.toBeNull();
    const next = await w.claim();
    expect(next?.instruction).toBe('第二句');
    expect((await w.thread()).pending).toEqual([]);
  });

  test('sending never creates a task by itself', async () => {
    const w = await setupWorld();
    await w.send('把看板计数修一下');
    await w.send('顺便改下空列提示');
    expect(w.s.db.select().from(todoTable).all()).toHaveLength(0);
  });

  test('withdraw deletes a queued message and its turn, and refuses a turn that already started', async () => {
    const w = await setupWorld();
    const first = await w.send('第一句');
    await w.claim();
    const second = await w.send('第二句');
    expect((await w.withdraw(first)).status).toBe(409);
    const res = await w.withdraw(second);
    expect(res.status).toBe(200);
    expect(w.messages().map((m) => m.id)).toEqual([first]);
    expect(w.stepRow(second)).toBeUndefined();
    expect((await w.thread()).pending).toEqual([]);
  });

  test('turns created in the same millisecond run in arrival order, matching the queue', async () => {
    const w = await setupWorld();
    const firstSent = await w.send('第一句');
    const secondSent = await w.send('第二句');
    for (const [from, to] of [
      [firstSent, 'turn-z'],
      [secondSent, 'turn-a'],
    ] as const) {
      w.s.db.update(stepTable).set({ id: to, createdAt: 1 }).where(eq(stepTable.id, from)).run();
      w.s.db
        .update(chiefMessage)
        .set({ id: to, createdAt: 1 })
        .where(eq(chiefMessage.id, from))
        .run();
    }
    expect((await w.thread()).pending?.map((p) => p.messageId)).toEqual(['turn-a']);
    const first = await w.claim();
    expect(first?.step.id).toBe('turn-z');
    expect(await w.claim()).toBeNull();
  });

  test('queue order survives a reload: pending entries come back oldest first', async () => {
    const w = await setupWorld();
    await w.send('第一句');
    await w.claim();
    const b = await w.send('第二句');
    const c = await w.send('第三句');
    expect((await w.thread()).pending?.map((p) => p.messageId)).toEqual([b, c]);
    expect((await w.thread()).pending?.map((p) => p.messageId)).toEqual([b, c]);
  });
});

describe('steer (T5): `现在插话`', () => {
  test('steer moves a queued message into the running turn and after the earlier rows', async () => {
    const w = await setupWorld();
    await w.send('第一句');
    const running = await w.claim();
    const queued = await w.send('改成只看 cairn 项目');
    const before = w.messages().find((m) => m.id === queued)!.createdAt;
    const res = await w.steer(queued);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ steered: true });
    const pending = w.s.db.select().from(steerPending).all();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.stepId).toBe(running!.step.id);
    expect(pending[0]!.content).toBe('改成只看 cairn 项目');
    expect((await w.thread()).pending).toEqual([]);
    expect(await w.fetchSteer(running!.step.id)).toBe('改成只看 cairn 项目');
    expect(w.stepRow(queued)).toBeDefined();
    await w.ackSteer(running!.step.id);
    expect(w.stepRow(queued)).toBeUndefined();
    expect(w.messages().find((m) => m.id === queued)!.createdAt).toBeGreaterThanOrEqual(before);
    await w.done(running!.step.id, { status: 'success' });
    expect(await w.claim()).toBeNull();
  });

  test('a steered message keeps the composer project chip', async () => {
    const w = await setupWorld();
    await w.send('第一句');
    const running = await w.claim();
    const res = await call(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      body: { content: '改一下按钮', projectId: w.projectId },
    });
    const queued = ((await res.json()) as { message: { id: string } }).message.id;
    expect((await w.steer(queued)).status).toBe(200);
    expect(await w.fetchSteer(running!.step.id)).toBe(
      `【输入框选定项目：queue-proj（id: ${w.projectId}）】\n改一下按钮`,
    );
  });

  test('a steer the running turn never picks up runs as its own turn afterwards', async () => {
    const w = await setupWorld();
    await w.send('第一句');
    const running = await w.claim();
    const queued = await w.send('改成只看 cairn 项目');
    expect((await w.steer(queued)).status).toBe(200);
    await w.done(running!.step.id, { status: 'success' });
    expect(w.s.db.select().from(steerPending).all()).toHaveLength(0);
    expect((await w.thread()).pending).toEqual([]);
    const next = await w.claim();
    expect(next?.step.id).toBe(queued);
    expect(next?.instruction).toBe('改成只看 cairn 项目');
  });

  test('a steered message can no longer be withdrawn, so the daemon never gets withdrawn text', async () => {
    const w = await setupWorld();
    await w.send('第一句');
    const running = await w.claim();
    const queued = await w.send('改成只看 cairn 项目');
    expect((await w.steer(queued)).status).toBe(200);
    expect((await w.withdraw(queued)).status).toBe(409);
    expect(await w.fetchSteer(running!.step.id)).toBe('改成只看 cairn 项目');
    expect(w.messages().some((m) => m.id === queued)).toBe(true);
  });

  test('a turn that finishes after the daemon fetched a steer but before it delivered it keeps the message queued', async () => {
    const w = await setupWorld();
    await w.send('第一句');
    const running = await w.claim();
    const queued = await w.send('改成只看 cairn 项目');
    expect((await w.steer(queued)).status).toBe(200);
    expect(await w.fetchSteer(running!.step.id)).toBe('改成只看 cairn 项目');
    expect((await w.thread()).pending).toEqual([]);
    expect((await w.withdraw(queued)).status).toBe(409);
    await w.done(running!.step.id, { status: 'success' });
    const next = await w.claim();
    expect(next?.step.id).toBe(queued);
    expect(next?.instruction).toBe('改成只看 cairn 项目');
  });

  test('an ack only settles the batch it acknowledges; a later steer waits for its own fetch and ack', async () => {
    const w = await setupWorld();
    await w.send('第一句');
    const running = await w.claim();
    const a = await w.send('插话 A');
    const b = await w.send('插话 B');
    expect((await w.steer(a)).status).toBe(200);
    expect(await w.fetchSteer(running!.step.id)).toBe('插话 A');
    expect((await w.steer(b)).status).toBe(200);
    expect(await w.fetchSteer(running!.step.id)).toBeNull();
    await w.ackSteer(running!.step.id);
    expect(w.stepRow(a)).toBeUndefined();
    expect(w.stepRow(b)).toBeDefined();
    expect(await w.fetchSteer(running!.step.id)).toBe('插话 B');
    await w.done(running!.step.id, { status: 'success' });
    const next = await w.claim();
    expect(next?.step.id).toBe(b);
  });

  test('steering the same message twice sends its text once', async () => {
    const w = await setupWorld();
    await w.send('第一句');
    const running = await w.claim();
    const queued = await w.send('改成只看 cairn 项目');
    expect((await w.steer(queued)).status).toBe(200);
    expect(await w.fetchSteer(running!.step.id)).toBe('改成只看 cairn 项目');
    expect(await (await w.steer(queued)).json()).toEqual({ steered: true });
    expect(await w.fetchSteer(running!.step.id)).toBeNull();
  });

  test('a steer that arrives after the reply finished stays a normal message for the next turn', async () => {
    const w = await setupWorld();
    await w.send('第一句');
    const running = await w.claim();
    const queued = await w.send('补一句');
    await w.done(running!.step.id, { status: 'success' });
    const res = await w.steer(queued);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ steered: false });
    expect(w.s.db.select().from(steerPending).all()).toHaveLength(0);
    const next = await w.claim();
    expect(next?.instruction).toBe('补一句');
  });

  test('the chief prompt requires using a steer and saying what changed', async () => {
    const w = await setupWorld();
    await w.send('第一句');
    const claimed = await w.claim();
    expect(claimed?.chief?.systemPrompt).toContain('插话');
  });
});

describe('stop (T5)', () => {
  test('stopping a running turn ends it without an error row and says no task was created', async () => {
    const w = await setupWorld();
    await w.send('第一句');
    const running = await w.claim();
    const res = await w.stop();
    expect(res.status).toBe(200);
    await w.done(running!.step.id, { status: 'stopped' });
    expect(w.stepRow(running!.step.id)?.status).toBe('stopped');
    const rows = w.messages();
    expect(rows.some((m) => m.id.startsWith('chief-err-'))).toBe(false);
    const note = rows.find((m) => m.id === `chief-stop-${running!.step.id}`);
    expect(JSON.parse(note!.content as string)).toEqual({ kind: 'chief_turn_stopped', todos: [] });
    expect((await w.thread()).activeRun).toBeNull();
  });

  test('stop after create_todo names the task in the stop row', async () => {
    const w = await setupWorld();
    await w.send('把看板计数修一下');
    const running = await w.claim();
    const created = await w.relay(running!.step.id, 'create_todo', {
      projectId: w.projectId,
      title: '修复看板计数',
      spec: '> 把看板计数修一下',
    });
    await w.reportTool(running!.step.id, {
      id: 'call-create',
      name: 'create_todo',
      arguments: { projectId: w.projectId, title: '修复看板计数' },
      result: JSON.stringify(created),
      startedAt: Date.now(),
      endedAt: Date.now(),
    });
    await w.stop();
    await w.done(running!.step.id, { status: 'stopped' });
    const note = w.messages().find((m) => m.id === `chief-stop-${running!.step.id}`);
    expect(JSON.parse(note!.content as string)).toEqual({
      kind: 'chief_turn_stopped',
      todos: [{ id: created.id, seq: created.seqNum, title: '修复看板计数' }],
    });
  });

  test('stop with no running turn is refused, so a queued message is never cancelled by it', async () => {
    const w = await setupWorld();
    await w.send('第一句');
    const running = await w.claim();
    const queued = await w.send('第二句');
    await w.done(running!.step.id, { status: 'success' });
    expect((await w.stop()).status).toBe(409);
    expect(w.stepRow(queued)?.status).toBe('pending');
  });

  test('stop on a turn whose machine went silent ends it right away', async () => {
    const w = await setupWorld();
    await w.send('第一句');
    const running = await w.claim();
    w.s.db
      .update(stepTable)
      .set({ lastHeartbeatAt: Date.now() - 10 * 60_000 })
      .where(eq(stepTable.id, running!.step.id))
      .run();
    const res = await w.stop();
    expect(await res.json()).toEqual({ delegated: false });
    expect(w.stepRow(running!.step.id)?.status).toBe('stopped');
    expect(w.messages().some((m) => m.id === `chief-stop-${running!.step.id}`)).toBe(true);
    expect((await w.thread()).activeRun).toBeNull();
  });

  test('stop while queued turns wait: the next queued message still runs', async () => {
    const w = await setupWorld();
    await w.send('第一句');
    const running = await w.claim();
    await w.send('第二句');
    await w.stop();
    await w.done(running!.step.id, { status: 'stopped' });
    const next = await w.claim();
    expect(next?.instruction).toBe('第二句');
  });
});

describe('chief unavailable (T4)', () => {
  test('a quota failure parks the turn, reports an outage, and newer messages are held in order', async () => {
    const w = await setupWorld();
    const first = await w.send('第一句');
    const running = await w.claim();
    await w.done(running!.step.id, { status: 'failed', errorMessage: QUOTA_ERROR });
    const env = await w.envelope();
    expect(env.outage?.reason).toBe('quota');
    expect(env.outage?.model).toBe('relay-a/model-a');
    expect(typeof env.outage?.retryAt).toBe('number');
    const second = await w.send('第二句');
    expect((await w.thread()).pending).toEqual([
      { messageId: first, state: 'held' },
      { messageId: second, state: 'held' },
    ]);
    expect(await w.claim()).toBeNull();
    w.s.db.update(stepTable).set({ holdUntil: 0 }).where(eq(stepTable.id, first)).run();
    const resumed = await w.claim();
    expect(resumed?.instruction).toBe('第一句');
    expect((await w.envelope()).outage ?? null).toBeNull();
  });

  test('capacity without a backup parks the chief with the effective provider', async () => {
    const w = await setupWorld();
    await w.send('第一句');
    const running = await w.claim();
    expect(running).not.toBeNull();
    await w.done(running!.step.id, { status: 'failed', errorMessage: '429: rate limit exceeded' });
    const row = w.stepRow(running!.step.id);
    expect(row?.status).toBe('waiting_quota');
    expect(row?.quotaBlock?.providerId).toBe('relay-a');
    expect(await w.claim()).toBeNull();
  });

  test('a held message can be withdrawn while the chief is down', async () => {
    const w = await setupWorld();
    await w.send('第一句');
    const running = await w.claim();
    await w.done(running!.step.id, { status: 'failed', errorMessage: QUOTA_ERROR });
    const second = await w.send('第二句');
    expect((await w.withdraw(second)).status).toBe(200);
    expect(w.messages().some((m) => m.id === second)).toBe(false);
  });

  test('with a backup model the turn retries on it, no outage, and the thread names the model', async () => {
    const w = await setupWorld([{ provider: 'relay-b', modelId: 'model-b' }]);
    await w.send('第一句');
    const running = await w.claim();
    await w.done(running!.step.id, { status: 'failed', errorMessage: QUOTA_ERROR });
    expect((await w.envelope()).outage ?? null).toBeNull();
    const retried = await w.claim();
    expect(retried?.step.id).toBe(running!.step.id);
    expect(retried?.agent?.provider).toBe('relay-b');
    expect(retried?.agent?.modelId).toBe('model-b');
    expect((await w.thread()).fallbackModel).toBe('relay-b/model-b');
    const note = w.messages().find((m) => m.id.startsWith('chief-fallback-'));
    expect(JSON.parse(note!.content as string)).toEqual({
      kind: 'chief_model_fallback',
      from: 'relay-a/model-a',
      to: 'relay-b/model-b',
      stepId: running!.step.id,
    });
  });

  test('a backup model on another runtime is skipped, so the thread session stays usable', async () => {
    const w = await setupWorld([{ provider: 'claude-code', modelId: 'sonnet' }]);
    w.s.db
      .update(machineTable)
      .set({ enabledRuntimes: ['pi', 'claude-code'] })
      .run();
    await w.send('第一句');
    const running = await w.claim();
    await w.done(running!.step.id, { status: 'failed', errorMessage: QUOTA_ERROR });
    expect((await w.envelope()).outage?.reason).toBe('quota');
    expect(w.stepRow(running!.step.id)?.fallback ?? null).toBeNull();
  });

  test('a backup model on a different backend runtime is skipped too', async () => {
    const w = await setupWorld([{ provider: 'gemini', modelId: 'gemini-pro' }]);
    w.s.db
      .update(agentTable)
      .set({ provider: 'claude-code', modelId: 'sonnet' })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    w.s.db
      .update(machineTable)
      .set({ enabledRuntimes: ['pi', 'claude-code', 'gemini'] })
      .run();
    await w.send('第一句');
    const running = await w.claim();
    expect(running?.agent?.provider).toBe('claude-code');
    await w.done(running!.step.id, { status: 'failed', errorMessage: QUOTA_ERROR });
    expect(w.stepRow(running!.step.id)?.fallback ?? null).toBeNull();
  });

  test('fallback chain exhausted: the turn parks on quota and the outage shows', async () => {
    const w = await setupWorld([{ provider: 'relay-b', modelId: 'model-b' }]);
    await w.send('第一句');
    const first = await w.claim();
    await w.done(first!.step.id, { status: 'failed', errorMessage: QUOTA_ERROR });
    const second = await w.claim();
    await w.done(second!.step.id, { status: 'failed', errorMessage: QUOTA_ERROR });
    expect((await w.envelope()).outage?.reason).toBe('quota');
  });
});
