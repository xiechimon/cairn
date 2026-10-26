import { createHash } from 'node:crypto';
import {
  CLAIM_POLL_INTERVAL_MS,
  type ClaimedStep,
  claimedStepSchema,
  MACHINE_ENDPOINTS,
  MACHINE_WIRE,
  MACHINE_WIRE_EXTENSIONS,
  MERGE_ANNOUNCEMENT,
  machineClaimResponseSchema,
  machineEnrollResponseSchema,
  machineOkResponseSchema,
  machineRecordSchema,
  machineRecoverResponseSchema,
  machineStreamEventSchema,
  machineTokenResponseSchema,
  machineUploadUrlsResponseSchema,
  PLAN_FILE_NAME,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  message as messageTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
  tokenUsage,
} from '../src/db/schema.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  postProject,
  withVerification,
} from './helpers.js';

type TestServer = ReturnType<typeof bootServer>;

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown; text?: string; contentType?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.contentType !== undefined) headers['content-type'] = opts.contentType;
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : opts.text,
    }),
  );
}

const AGENT_ID = 'agent-stub-1';

interface World {
  s: TestServer;
  apiKey: string;
  token: string;
  machineId: string;
  projectId: string;
  todoId: string;
  startBuild(withPlan?: boolean): Promise<{ buildId: string }>;
  claim(): Promise<{ res: Response; body: { step: ClaimedStep | null } }>;
}

async function setupWorld(
  opts: { claimHoldMs?: number; pingIntervalMs?: number } = {},
): Promise<World> {
  const s = bootServer({
    claimHoldMs: opts.claimHoldMs ?? 250,
    pingIntervalMs: opts.pingIntervalMs ?? 3_600_000,
  });
  const key = { plain: await issueApiKey(s) };
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-1',
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
    cred: key.plain,
    body: { teamId: s.team.id, name: 'test-mbp', cliVersion: '0.1.0' },
  });

  bindAllAgents(s);
  expect(enrollRes.status).toBe(200);
  const machineJson = machineEnrollResponseSchema.parse(await enrollRes.json());
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '探针任务', spec: '写一行探针到 README.md' },
  });
  const todoBody = (await todoRes.json()) as { id: string };
  return {
    s,
    apiKey: key.plain,
    token: machineJson.token,
    machineId: machineJson.machineId,
    projectId,
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
      return { res, body: (await res.json()) as { step: ClaimedStep | null } };
    },
  };
}

function normalizePath(path: string): string {
  return path.replaceAll(/:([A-Za-z]+)/g, '{$1}');
}

describe('machine-surface routes = 02 section 5 vocabulary (13 endpoints single-source match)', () => {
  const s = bootServer();
  const have = new Set(
    s.app.routes
      .filter((r) => r.method !== 'ALL' && r.path.startsWith('/api/machine/'))
      .map((r) => `${r.method} ${normalizePath(r.path)}`),
  );

  test('implementation surface covers all 13 MACHINE_WIRE endpoints (verb+path one by one)', () => {
    for (const w of MACHINE_WIRE) {
      expect(have.has(`${w.method} ${w.path}`), `${w.method} ${w.path}`).toBe(true);
    }
    expect(MACHINE_WIRE).toHaveLength(13);
    expect(MACHINE_ENDPOINTS.map((e) => e.path)).toEqual(MACHINE_WIRE.map((w) => w.path));
  });

  test('only [design] extension endpoints registered outside the vocabulary (single source = shared MACHINE_WIRE_EXTENSIONS)', () => {
    const wire = new Set(MACHINE_WIRE.map((w) => `${w.method} ${w.path}`));
    const extra = [...have].filter((r) => !wire.has(r));
    expect(extra).toEqual(MACHINE_WIRE_EXTENSIONS.map((e) => `${e.method} ${e.path}`));
  });

  test('production default claim hold = 75s (r3 section 1.5 ~75-76s cadence; wire constant single source)', () => {
    expect(CLAIM_POLL_INTERVAL_MS).toBe(75_000);
    expect(loadConfig().claimHoldMs).toBe(CLAIM_POLL_INTERVAL_MS);
  });
});

describe('enroll / me / presence / recover (02 §5.2-§5.4)', () => {
  test('no credential or bad credential = 401 {error} (error shape r5 section 1 family)', async () => {
    const w = await setupWorld();
    for (const res of [
      await call(w.s.app, 'GET', '/api/machine/me'),
      await call(w.s.app, 'GET', '/api/machine/me', { cred: 'deadbeef' }),
      await call(w.s.app, 'POST', '/api/machine/enroll', {
        cred: 'cairn_nope',
        body: { teamId: w.s.team.id },
      }),
    ]) {
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(['error']);
    }
  });

  test('re-registration reuses the same machineId (r3 section 1.2 observed: re-registering after logout unchanged)', async () => {
    const w = await setupWorld();
    const res = await call(w.s.app, 'POST', '/api/machine/enroll', {
      cred: w.apiKey,
      body: { teamId: w.s.team.id, name: 'test-mbp', cliVersion: '0.1.0' },
    });
    const again = machineEnrollResponseSchema.parse(await res.json());
    expect(again.machineId).toBe(w.machineId);
    expect(again.token).not.toBe(w.token);
    expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: w.token })).status).toBe(401);
    expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: again.token })).status).toBe(200);
  });

  test('me = machine record field by field (02 section 6.2)', async () => {
    const w = await setupWorld();
    const res = await call(w.s.app, 'GET', '/api/machine/me', { cred: w.token });
    const record = machineRecordSchema.parse(await res.json());
    expect(record).toMatchObject({
      id: w.machineId,
      name: 'test-mbp',
      teamId: w.s.team.id,
      latestCliVersion: '0.1.0',
    });
  });

  test('presence sets online + team stream machine_presence event (02 section 1.2)', async () => {
    const w = await setupWorld();
    const streamP = (async () => {
      const ctrl = new AbortController();
      const res = await w.s.app.request(`/api/teams/${w.s.team.id}/stream`, {
        signal: ctrl.signal,
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf('\n\n');
        while (idx >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const ev = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
            if (ev.type === 'machine_presence') {
              ctrl.abort();
              return ev;
            }
          }
          idx = buf.indexOf('\n\n');
        }
      }
      return null;
    })();
    const res = await call(w.s.app, 'POST', '/api/machine/presence', {
      cred: w.token,
      body: { cliVersion: '0.1.0' },
    });
    expect(machineOkResponseSchema.parse(await res.json())).toEqual({ ok: true });
    const ev = await streamP;
    expect(ev).toMatchObject({
      type: 'machine_presence',
      machineId: w.machineId,
      online: true,
    });
    const me = machineRecordSchema.parse(
      await (await call(w.s.app, 'GET', '/api/machine/me', { cred: w.token })).json(),
    );
    expect(me.online).toBe(true);
  });

  test('recover initial empty set (r3 section 1.5 `[recover] no pending steps found` line semantics)', async () => {
    const w = await setupWorld();
    const res = await call(w.s.app, 'POST', '/api/machine/recover', { cred: w.token });
    expect(machineRecoverResponseSchema.parse(await res.json())).toEqual({ steps: [] });
  });
});

describe('claim/wake timing (r3 section 1.5 measured: ~75s long poll cadence + wake low-latency dispatch)', () => {
  test('empty long poll returns {step:null} after about the hold duration (same cadence shape, shortened timescale)', async () => {
    const w = await setupWorld({ claimHoldMs: 400 });
    const t0 = Date.now();
    const { res, body } = await w.claim();
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(200);
    expect(machineClaimResponseSchema.parse(body)).toEqual({ step: null });
    expect(elapsed).toBeGreaterThanOrEqual(380);
    expect(elapsed).toBeLessThan(3_000);
  });

  test('enqueue wakes immediately: suspended claim claims at once (far below hold = low-latency dispatch)', async () => {
    const w = await setupWorld({ claimHoldMs: 30_000 });
    const t0 = Date.now();
    const claimP = w.claim();
    const { buildId } = await w.startBuild(true);
    const { body } = await claimP;
    const elapsed = Date.now() - t0;
    const step = claimedStepSchema.parse(body.step);
    expect(step.step.buildId).toBe(buildId);
    expect(elapsed).toBeLessThan(3_000);
  });

  test('#1217 missed-wake re-awake: wake after baseline before arming -> waitWake returns immediately', async () => {
    const s = bootServer();
    const since = s.machineHub.wakeSeq(s.team.id);
    s.machineHub.wake(s.team.id);
    const t0 = Date.now();
    const woken = await s.machineHub.waitWake(s.team.id, 30_000, undefined, since);
    expect(woken).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1_000);
    const bare = s.machineHub.waitWake(s.team.id, 50);
    const wokenBare = await bare;
    expect(wokenBare).toBe(false);
    s.dispose();
  });

  test('machine stream SSE pushes wake events (02 section 1.2 machine channel)', async () => {
    const w = await setupWorld({ claimHoldMs: 30_000 });
    const ctrl = new AbortController();
    const res = await w.s.app.request('/api/machine/stream', {
      headers: { authorization: `Bearer ${w.token}` },
      signal: ctrl.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const readWake = (async () => {
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return null;
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf('\n\n');
        while (idx >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const ev = JSON.parse(line.slice(5).trim()) as { type?: string };
            if (ev.type === 'wake') return ev;
          }
          idx = buf.indexOf('\n\n');
        }
      }
    })();
    for (let i = 0; i < 100 && w.s.machineHub.streamCount(w.s.team.id) === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await w.startBuild(true);
    const ev = await readWake;
    ctrl.abort();
    expect(machineStreamEventSchema.parse(ev)).toEqual({ type: 'wake' });
  });

  test('#863 machine-channel keepalive: SSE comment frames heartbeat at pingInterval (streams of event-less machines no longer silently cut by the client bodyTimeout -> machine.online does not flap -> session-affinity gate criteria not wrongly allowed)', async () => {
    const w = await setupWorld({ claimHoldMs: 200, pingIntervalMs: 80 });
    const ctrl = new AbortController();
    const res = await w.s.app.request('/api/machine/stream', {
      headers: { authorization: `Bearer ${w.token}` },
      signal: ctrl.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let sawComment = false;
    const deadline = Date.now() + 5_000;
    read: for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf('\n\n');
      while (idx >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (frame.split('\n').some((line) => line.startsWith(':'))) {
          sawComment = true;
          break read;
        }
        idx = buf.indexOf('\n\n');
      }
      if (Date.now() > deadline) break;
    }
    ctrl.abort();
    expect(sawComment).toBe(true);
  });
});

describe('step journal full chain (02 section 5.4 vocabulary + section 4.2 main timeline machine side)', () => {
  test('claim->heartbeat->tool->token->upload-urls->transcript->done->confirm->continue->review->merge->done full chain field by field', async () => {
    const w = await setupWorld({ claimHoldMs: 200 });
    const cred = { cred: w.token };
    const { buildId } = await w.startBuild(true);

    const { body: claim1 } = await w.claim();
    const claimed = claimedStepSchema.parse(claim1.step);
    expect(claimed.step.kind).toBe('plan');
    expect(claimed.conversationId).toBe(buildId);
    expect(claimed.session).toEqual({ action: 'new', sessionId: null });
    expect(claimed.todo).toMatchObject({ id: w.todoId, seqNum: 1, title: '探针任务' });
    expect(claimed.agent).toMatchObject({
      id: AGENT_ID,
      provider: 'stub-gw',
      modelId: 'stub-model',
    });
    const stepId = claimed.step.id;
    const todoNow = () => w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoNow().phase).toBe('planning');

    const hb = await call(w.s.app, 'POST', `/api/machine/heartbeat/${stepId}`, {
      ...cred,
      body: {},
    });
    expect(machineOkResponseSchema.parse(await hb.json())).toEqual({ ok: true });

    const toolCall = {
      id: 'call-1',
      name: 'edit',
      arguments: { path: 'README.md' },
      result: { content: 'ok' },
      isError: false,
      startedAt: Date.now(),
      endedAt: Date.now(),
    };
    const toolRes = await call(w.s.app, 'POST', `/api/machine/tool/${stepId}`, {
      ...cred,
      body: toolCall,
    });
    expect(machineOkResponseSchema.parse(await toolRes.json())).toEqual({ ok: true });

    const tokenRes = await call(w.s.app, 'GET', `/api/machine/token/${stepId}`, cred);
    const token = machineTokenResponseSchema.parse(await tokenRes.json());
    expect(token.provider).toMatchObject({
      kind: 'http',
      providerId: 'stub-gw',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      authHeader: true,
    });
    expect(token.secrets).toEqual({});
    expect(token.git).toBeNull();

    const urlsRes = await call(w.s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
      ...cred,
      body: { files: [{ name: 'transcript.json' }] },
    });
    const urls = machineUploadUrlsResponseSchema.parse(await urlsRes.json());
    expect(urls.uploads).toHaveLength(1);
    const upload = urls.uploads[0]!;
    expect(upload.method).toBe('PUT');
    const putRes = await call(w.s.app, 'PUT', upload.url.replace(/^https?:\/\/[^/]+/, ''), {
      ...cred,
      body: {
        stepId,
        messages: [
          {
            id: 'call-1',
            role: 'assistant',
            content: { kind: 'toolcall', call: { ...toolCall, result: { content: 'final' } } },
            createdAt: Date.now(),
          },
          {
            id: 'msg-1',
            role: 'assistant',
            content: { kind: 'text', text: '方案已写入 plan.md' },
            createdAt: Date.now(),
          },
        ],
      },
    });
    expect(machineOkResponseSchema.parse(await putRes.json())).toEqual({ ok: true });
    const rows = w.s.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    expect(rows).toHaveLength(2);
    const toolRow = rows.find((r) => r.id === 'call-1')!;
    expect((toolRow.content as { call: { result: { content: string } } }).call.result.content).toBe(
      'final',
    );
    expect(
      (
        await call(w.s.app, 'PUT', upload.url.replace(/^https?:\/\/[^/]+/, ''), {
          ...cred,
          body: { stepId, messages: [] },
        })
      ).status,
    ).toBe(404);

    const planUrlsRes = await call(w.s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
      ...cred,
      body: { files: [{ name: PLAN_FILE_NAME }] },
    });
    const planUpload = machineUploadUrlsResponseSchema.parse(await planUrlsRes.json()).uploads[0]!;
    const planPut = await call(w.s.app, 'PUT', planUpload.url.replace(/^https?:\/\/[^/]+/, ''), {
      ...cred,
      text: withVerification('# 方案\nContext: 探针\n'),
      contentType: 'text/markdown',
    });
    expect(machineOkResponseSchema.parse(await planPut.json())).toEqual({ ok: true });

    const doneRes = await call(w.s.app, 'POST', `/api/machine/done/${stepId}`, {
      ...cred,
      body: {
        status: 'success',
        sessionId: 'pi-session-1',
        usage: [
          { model: 'stub-gw/stub-model', input: 12, output: 980, cacheRead: 100, cacheWrite: 50 },
        ],
        hasChanges: true,
      },
    });
    expect(machineOkResponseSchema.parse(await doneRes.json())).toEqual({ ok: true });
    expect(todoNow().phase).toBe('confirm');
    const usage = w.s.db.select().from(tokenUsage).all();
    expect(usage).toEqual([
      {
        buildId,
        model: 'stub-gw/stub-model',
        input: 12,
        output: 980,
        cacheRead: 100,
        cacheWrite: 50,
        costInput: null,
        costOutput: null,
        costCacheRead: null,
        costCacheWrite: null,
        costTotal: null,
      },
    ]);

    const confirmRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'confirm' },
    });
    expect(confirmRes.status).toBe(202);
    const { body: claim2 } = await w.claim();
    const step2 = claimedStepSchema.parse(claim2.step);
    expect(step2.step.kind).toBe('build');
    expect(step2.session).toEqual({ action: 'continue', sessionId: 'pi-session-1' });
    expect(todoNow().phase).toBe('building');

    await call(w.s.app, 'POST', `/api/machine/done/${step2.step.id}`, {
      ...cred,
      body: { status: 'success', sessionId: 'pi-session-1', hasChanges: true },
    });
    expect(todoNow().phase).toBe('review');

    w.s.db
      .update(agentTable)
      .set({ tools: ['合并分支', '推送分支'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const mergeRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} });
    expect(mergeRes.status).toBe(202);
    expect(await mergeRes.json()).toEqual({ delegated: true });
    const { body: claim3 } = await w.claim();
    const step3 = claimedStepSchema.parse(claim3.step);
    expect(step3.step.kind).toBe('merge');
    expect(step3.session.action).toBe('continue');
    await call(w.s.app, 'POST', `/api/machine/done/${step3.step.id}`, {
      ...cred,
      body: { status: 'success', sessionId: 'pi-session-1' },
    });
    expect(todoNow().phase).toBe('done');
    expect(w.s.db.select().from(tokenUsage).all()).toHaveLength(1);
  });

  test('done failed -> todo failed + build.errorMessage (02 section 4.2 step-level failure has no auto rerun)', async () => {
    const w = await setupWorld({ claimHoldMs: 200 });
    const { buildId } = await w.startBuild(true);
    const { body } = await w.claim();
    const claimed = claimedStepSchema.parse(body.step);
    const res = await call(w.s.app, 'POST', `/api/machine/done/${claimed.step.id}`, {
      cred: w.token,
      body: { status: 'failed', errorMessage: '模型连接失败' },
    });
    expect(res.status).toBe(200);
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('failed');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.errorMessage).toBe('模型连接失败');
    const stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, claimed.step.id)).get()!;
    expect(stepRow.status).toBe('failed');
  });

  test('recover returns this machine claimed unfinished steps (journal restores the server-side truth)', async () => {
    const w = await setupWorld({ claimHoldMs: 200 });
    await w.startBuild(true);
    const { body } = await w.claim();
    const claimed = claimedStepSchema.parse(body.step);
    const res = await call(w.s.app, 'POST', '/api/machine/recover', { cred: w.token });
    const recovered = machineRecoverResponseSchema.parse(await res.json());
    expect(recovered.steps.map((s) => s.id)).toEqual([claimed.step.id]);
  });

  test('another machine step = 404; unknown step = 410 (error shape {error})', async () => {
    const w = await setupWorld({ claimHoldMs: 200 });
    await w.startBuild(true);
    const { body } = await w.claim();
    const claimed = claimedStepSchema.parse(body.step);
    w.s.db
      .insert(machineTable)
      .values({
        id: 'machine-other',
        teamId: w.s.team.id,
        name: 'other',
        online: false,
        tokenHash: createHash('sha256').update('other-token').digest('hex'),
        apiKeyId: null,
        latestCliVersion: null,
      })
      .run();
    const res = await call(w.s.app, 'POST', `/api/machine/heartbeat/${claimed.step.id}`, {
      cred: 'other-token',
      body: {},
    });
    expect(res.status).toBe(404);
    expect(Object.keys((await res.json()) as object)).toEqual(['error']);
    const unknown = await call(w.s.app, 'POST', '/api/machine/heartbeat/nope', {
      cred: w.token,
      body: {},
    });
    expect(unknown.status).toBe(410);
  });

  test('#1488 card reset deletes the running steps -> heartbeat 410; steps this machine still holds -> 200', async () => {
    const w = await setupWorld({ claimHoldMs: 200 });
    await w.startBuild(true);
    const { body } = await w.claim();
    const claimed = claimedStepSchema.parse(body.step);
    const beat = () =>
      call(w.s.app, 'POST', `/api/machine/heartbeat/${claimed.step.id}`, {
        cred: w.token,
        body: {},
      });
    expect((await beat()).status).toBe(200);
    expect((await call(w.s.app, 'POST', `/api/todos/${w.todoId}/reset`, { body: {} })).status).toBe(
      200,
    );
    const gone = await beat();
    expect(gone.status).toBe(410);
    expect(Object.keys((await gone.json()) as object)).toEqual(['error']);
  });
});

describe('claim payload: agent.skillsAllowlist grant + defaultSkill carried (#1169 split fields)', () => {
  async function claimWith(opts: {
    defaultSkill?: string | null;
    skillsAllowlist?: string[] | null;
  }): Promise<ClaimedStep | null> {
    const w = await setupWorld({ claimHoldMs: 200 });
    w.s.db
      .update(agentTable)
      .set({ ...opts })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    await w.startBuild(false);
    const { body } = await w.claim();
    const step = body.step ? claimedStepSchema.parse(body.step) : null;
    w.s.dispose();
    return step;
  }

  test('checked subset carried verbatim (worker step, no filter no reorder -- filtering is the daemon catalog build responsibility)', async () => {
    const step = await claimWith({ defaultSkill: 'alpha', skillsAllowlist: ['alpha', 'ghost'] });
    expect(step).not.toBeNull();
    expect(step!.agent?.skillsAllowlist).toEqual(['alpha', 'ghost']);
    expect(step!.agent?.defaultSkill).toBe('alpha');
  });

  test('null (unrestricted) and [] (explicit all-deny) each carried verbatim -- the two states must not collapse', async () => {
    const unrestricted = await claimWith({ defaultSkill: null, skillsAllowlist: null });
    expect(unrestricted).not.toBeNull();
    expect(unrestricted!.agent?.skillsAllowlist).toBeNull();
    expect(unrestricted!.agent?.defaultSkill).toBeNull();
    const denyAll = await claimWith({ skillsAllowlist: [] });
    expect(denyAll).not.toBeNull();
    expect(denyAll!.agent?.skillsAllowlist).toEqual([]);
  });

  test('a never-set agent row (column default) = carries null (unrestricted -- creation default is this ticket default, no longer [] all-deny)', async () => {
    const w = await setupWorld({ claimHoldMs: 200 });
    await w.startBuild(false);
    const { body } = await w.claim();
    const step = body.step ? claimedStepSchema.parse(body.step) : null;
    expect(step).not.toBeNull();
    expect(step!.agent?.skillsAllowlist).toBeNull();
    expect(step!.agent?.defaultSkill).toBeNull();
    w.s.dispose();
  });
});

describe('claim payload: agent.tools permission switch set passthrough (XMON-77)', () => {
  async function claimWithTools(tools: string[]): Promise<ClaimedStep | null> {
    const w = await setupWorld({ claimHoldMs: 200 });
    w.s.db.update(agentTable).set({ tools }).where(eq(agentTable.id, AGENT_ID)).run();
    await w.startBuild(false);
    const { body } = await w.claim();
    const step = body.step ? claimedStepSchema.parse(body.step) : null;
    w.s.dispose();
    return step;
  }

  test('enabled set carried verbatim (read side wide: legacy residual values also passed through, filtering is not on the claim surface)', async () => {
    const step = await claimWithTools(['推送分支', '远程 shell']);
    expect(step).not.toBeNull();
    expect(step!.agent?.tools).toEqual(['推送分支', '远程 shell']);
  });

  test('all-off = carries [] (least-privilege same law as skills; default kept for legacy server fail-open)', async () => {
    const step = await claimWithTools([]);
    expect(step).not.toBeNull();
    expect(step!.agent?.tools).toEqual([]);
  });
});

describe('merge permission gate: requestMerge validates the build-slot Agent two switches (XMON-77)', () => {
  async function reachReview(): Promise<World> {
    const w = await setupWorld({ claimHoldMs: 200 });
    const cred = { cred: w.token };
    const { buildId } = await w.startBuild(true);
    const { body: claim1 } = await w.claim();
    const step1 = claimedStepSchema.parse(claim1.step);
    const planUrls = await call(w.s.app, 'POST', `/api/machine/upload-urls/${step1.step.id}`, {
      ...cred,
      body: { files: [{ name: PLAN_FILE_NAME }] },
    });
    const planUpload = machineUploadUrlsResponseSchema.parse(await planUrls.json()).uploads[0]!;
    await call(w.s.app, 'PUT', planUpload.url.replace(/^https?:\/\/[^/]+/, ''), {
      ...cred,
      text: withVerification('# 方案\n'),
      contentType: 'text/markdown',
    });
    await call(w.s.app, 'POST', `/api/machine/done/${step1.step.id}`, {
      ...cred,
      body: { status: 'success', sessionId: 'pi-session-1' },
    });
    await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, { body: { action: 'confirm' } });
    const { body: claim2 } = await w.claim();
    const step2 = claimedStepSchema.parse(claim2.step);
    await call(w.s.app, 'POST', `/api/machine/done/${step2.step.id}`, {
      ...cred,
      body: { status: 'success', sessionId: 'pi-session-1', hasChanges: true },
    });
    expect(w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!.phase).toBe(
      'review',
    );
    return w;
  }

  test('all-off agent (default []) -> 403 naming both switches; no merge step/no timeline row/phase stays review', async () => {
    const w = await reachReview();
    const buildId = w.s.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.todoId, w.todoId))
      .get()!.id;
    const mergeRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} });
    expect(mergeRes.status).toBe(403);
    const errBody = (await mergeRes.json()) as { error: string };
    expect(Object.keys(errBody)).toEqual(['error']);
    expect(errBody.error).toContain('合并分支');
    expect(errBody.error).toContain('推送分支');
    const steps = w.s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
    expect(steps.every((s) => s.kind !== 'merge')).toBe(true);
    const msgRows = w.s.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    expect(msgRows.map((m) => m.content)).not.toContain(MERGE_ANNOUNCEMENT);
    expect(w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!.phase).toBe(
      'review',
    );
    w.s.dispose();
  });

  test('only holding merge branch (missing push) -> 403 naming only push branch (landing requires push first)', async () => {
    const w = await reachReview();
    w.s.db
      .update(agentTable)
      .set({ tools: ['合并分支'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const buildId = w.s.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.todoId, w.todoId))
      .get()!.id;
    const mergeRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} });
    expect(mergeRes.status).toBe(403);
    const errBody = (await mergeRes.json()) as { error: string };
    expect(errBody.error).toContain('推送分支');
    w.s.dispose();
  });

  test('both switches on -> 202 delegated (positive path pinned in the main-timeline full-chain test)', async () => {
    const w = await reachReview();
    w.s.db
      .update(agentTable)
      .set({ tools: ['合并分支', '推送分支'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const buildId = w.s.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.todoId, w.todoId))
      .get()!.id;
    const mergeRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} });
    expect(mergeRes.status).toBe(202);
    expect(await mergeRes.json()).toEqual({ delegated: true });
    w.s.dispose();
  });
});
