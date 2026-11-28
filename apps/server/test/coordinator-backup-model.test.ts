import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  chiefMessage,
  machine as machineTable,
  provider as providerTable,
  step as stepTable,
} from '../src/db/schema.js';
import { planModelFallback } from '../src/services/model-fallback.js';
import { providerHealth } from '../src/services/provider-health.js';
import {
  bootServer,
  claimedGeneration,
  issueApiKey,
  seedRoute,
  type TestServer,
} from './helpers.js';

const AUTH_ERROR =
  '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_1"}';
const OUTAGE_ERROR = '503 service unavailable: upstream connect error';
const CAPACITY_ERROR = '529: overloaded_error';

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
  teamId: string;
  send(content: string, projectId?: string): Promise<void>;
  claim(): Promise<ClaimedStep | null>;
  done(stepId: string, body: Record<string, unknown>): Promise<void>;
  messages(): {
    id: string;
    role: string;
    content: unknown;
    createdAt: number;
    projectId: string | null;
  }[];
  stepRow(id: string): typeof stepTable.$inferSelect | undefined;
  envelope(): Promise<{ outage?: { reason: string } | null }>;
}

async function setupWorld(
  providers: { providerId: string; models: string[] }[],
  fallbackModels: { provider: string; modelId: string }[] | null = null,
  primary: { provider: string; modelId: string } | null = null,
): Promise<World> {
  const s: TestServer = bootServer({ claimHoldMs: 100, pingIntervalMs: 3_600_000 });
  disposables.push(() => s.dispose());
  const teamId = s.team.id;
  const key = await issueApiKey(s);
  for (const p of providers) {
    s.db
      .insert(providerTable)
      .values({
        id: `prov-${p.providerId}`,
        teamId,
        kind: 'custom',
        providerId: p.providerId,
        label: p.providerId.toUpperCase(),
        baseUrl: `http://127.0.0.1:9/${p.providerId}`,
        api: 'openai-completions',
        authHeader: true,
        compat: { supportsDeveloperRole: false },
        models: p.models.map((id) => ({ id, name: id })),
        createdBy: s.user.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
  }
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({ teamId, name: 'backup-box', cliVersion: '0.1.0' }),
  });
  const { token } = (await enrollRes.json()) as { token: string };
  const machineId = s.db.select().from(machineTable).limit(1).all()[0]!.id;
  s.db.update(machineTable).set({ online: true }).where(eq(machineTable.id, machineId)).run();
  const route = primary ?? {
    provider: providers[0]!.providerId,
    modelId: providers[0]!.models[0]!,
  };
  seedRoute(s, 'coordinator', {
    provider: route.provider,
    modelId: route.modelId,
    machineId,
    fallbackModels,
  });
  let threadId: string | null = null;
  return {
    s,
    teamId,
    async send(content: string, projectId?: string) {
      const res =
        threadId === null
          ? await call(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, {
              body: projectId === undefined ? { content } : { content, projectId },
            })
          : await call(s.app, 'POST', `/api/conversations/${threadId}/messages`, {
              body: { content },
            });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { thread: { id: string } };
      threadId = body.thread.id;
    },
    async claim() {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
      const body = (await res.json()) as { step: unknown };
      return body.step ? claimedStepSchema.parse(body.step) : null;
    },
    async done(stepId: string, body: Record<string, unknown>) {
      const res = await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
        cred: token,
        body: { generation: claimedGeneration(s.db, stepId), ...body },
      });
      expect(res.status).toBe(200);
    },
    messages() {
      return s.db
        .select()
        .from(chiefMessage)
        .where(eq(chiefMessage.threadId, threadId ?? ''))
        .all();
    },
    stepRow(id: string) {
      return s.db.select().from(stepTable).where(eq(stepTable.id, id)).get();
    },
    async envelope() {
      const res = await call(s.app, 'GET', `/api/teams/${teamId}/chief`);
      return (await res.json()) as { outage?: { reason: string } | null };
    },
  };
}

function switches(w: World) {
  return w
    .messages()
    .filter((m) => m.role === 'system')
    .map((m) => JSON.parse(m.content as string) as Record<string, unknown>)
    .filter(
      (c) =>
        (c.kind === 'chief_model_fallback' && c.announced === true) ||
        c.kind === 'chief_model_restored',
    );
}

describe('the Coordinator falls back to another connected model', () => {
  test('an auth failure of the main model retries the same turn on the next connected model', async () => {
    const w = await setupWorld([
      { providerId: 'relay-a', models: ['model-a'] },
      { providerId: 'relay-b', models: ['model-b'] },
    ]);
    await w.send('第一句');
    const running = await w.claim();
    expect(running).not.toBeNull();
    await w.done(running!.step.id, { status: 'failed', errorMessage: AUTH_ERROR });

    expect((await w.envelope()).outage ?? null).toBeNull();
    const retried = await w.claim();
    expect(retried?.step.id).toBe(running!.step.id);
    expect(retried?.agent?.provider).toBe('relay-b');
    expect(retried?.agent?.modelId).toBe('model-b');
    const note = w.messages().find((m) => m.id.startsWith('chief-fallback-'));
    expect(JSON.parse(note!.content as string)).toEqual({
      kind: 'chief_model_fallback',
      from: 'relay-a/model-a',
      to: 'relay-b/model-b',
      stepId: running!.step.id,
      reason: 'auth',
      announced: true,
    });
    expect(w.messages().some((m) => m.id === `chief-err-${running!.step.id}`)).toBe(false);
  });

  test('a provider-wide failure skips a sibling model of the same provider', async () => {
    const w = await setupWorld([
      { providerId: 'relay-a', models: ['model-a', 'model-a-small'] },
      { providerId: 'relay-b', models: ['model-b'] },
    ]);
    await w.send('第一句');
    const running = await w.claim();
    await w.done(running!.step.id, { status: 'failed', errorMessage: AUTH_ERROR });
    const retried = await w.claim();
    expect(retried?.agent?.provider).toBe('relay-b');
    expect(switches(w)).toEqual([
      expect.objectContaining({
        kind: 'chief_model_fallback',
        from: 'relay-a/model-a',
        to: 'relay-b/model-b',
      }),
    ]);
  });

  test('a per-model capacity failure may use a sibling model of the same provider', async () => {
    const w = await setupWorld([
      { providerId: 'relay-a', models: ['model-a', 'model-a-small'] },
      { providerId: 'relay-b', models: ['model-b'] },
    ]);
    await w.send('第一句');
    const running = await w.claim();
    await w.done(running!.step.id, { status: 'failed', errorMessage: CAPACITY_ERROR });
    const retried = await w.claim();
    expect(retried?.agent?.provider).toBe('relay-a');
    expect(retried?.agent?.modelId).toBe('model-a-small');
  });

  test('with only one connected model the turn ends as it does today, with no divider line', async () => {
    const w = await setupWorld([{ providerId: 'relay-a', models: ['model-a'] }]);
    await w.send('第一句');
    const running = await w.claim();
    await w.done(running!.step.id, { status: 'failed', errorMessage: AUTH_ERROR });
    expect(w.stepRow(running!.step.id)?.status).toBe('failed');
    expect(w.messages().some((m) => m.id.startsWith('chief-fallback-'))).toBe(false);
    expect(w.messages().some((m) => m.id === `chief-err-${running!.step.id}`)).toBe(true);
  });

  test('when the backup fails too the next candidate answers the same turn', async () => {
    const w = await setupWorld([
      { providerId: 'relay-a', models: ['model-a'] },
      { providerId: 'relay-b', models: ['model-b'] },
      { providerId: 'relay-c', models: ['model-c'] },
    ]);
    await w.send('第一句');
    const first = await w.claim();
    await w.done(first!.step.id, { status: 'failed', errorMessage: AUTH_ERROR });
    const second = await w.claim();
    expect(second?.agent?.provider).toBe('relay-b');
    await w.done(second!.step.id, { status: 'failed', errorMessage: OUTAGE_ERROR });
    const third = await w.claim();
    expect(third?.step.id).toBe(first!.step.id);
    expect(third?.agent?.provider).toBe('relay-c');
    await w.done(third!.step.id, { status: 'success' });
    expect(w.stepRow(first!.step.id)?.status).toBe('done');
  });

  test('the next turn tries the main model again and says when it is back', async () => {
    const w = await setupWorld([
      { providerId: 'relay-a', models: ['model-a'] },
      { providerId: 'relay-b', models: ['model-b'] },
    ]);
    await w.send('第一句');
    const failing = await w.claim();
    await w.done(failing!.step.id, { status: 'failed', errorMessage: AUTH_ERROR });
    const backup = await w.claim();
    expect(backup?.agent?.provider).toBe('relay-b');
    await w.done(backup!.step.id, { status: 'success' });

    await w.send('第二句');
    const next = await w.claim();
    expect(next?.agent?.provider).toBe('relay-a');
    expect(next?.agent?.modelId).toBe('model-a');
    await w.done(next!.step.id, { status: 'success' });
    expect(switches(w)).toEqual([
      expect.objectContaining({ kind: 'chief_model_fallback', to: 'relay-b/model-b' }),
      expect.objectContaining({ kind: 'chief_model_restored', model: 'relay-a/model-a' }),
    ]);
  });

  test('failed turns inside the quiet window add no second line for the same backup', async () => {
    const w = await setupWorld([
      { providerId: 'relay-a', models: ['model-a'] },
      { providerId: 'relay-b', models: ['model-b'] },
    ]);
    const turn = async () => {
      await w.send(`turn ${w.messages().length}`);
      const failing = await w.claim();
      await w.done(failing!.step.id, { status: 'failed', errorMessage: AUTH_ERROR });
      const backup = await w.claim();
      await w.done(backup!.step.id, { status: 'success' });
    };
    await turn();
    await turn();
    expect(switches(w)).toEqual([
      expect.objectContaining({ kind: 'chief_model_fallback', to: 'relay-b/model-b' }),
    ]);
  });

  test('when the main provider is no longer connected the other providers are still candidates', async () => {
    const w = await setupWorld([{ providerId: 'relay-b', models: ['model-b'] }], null, {
      provider: 'openai',
      modelId: 'model-a',
    });
    await w.send('第一句');
    const running = await w.claim();
    await w.done(running!.step.id, { status: 'failed', errorMessage: AUTH_ERROR });
    const retried = await w.claim();
    expect(retried?.agent?.provider).toBe('relay-b');
    expect(retried?.agent?.modelId).toBe('model-b');
  });

  test('an explicit empty backup list keeps the turn on the main model', async () => {
    const w = await setupWorld(
      [
        { providerId: 'relay-a', models: ['model-a'] },
        { providerId: 'relay-b', models: ['model-b'] },
      ],
      [],
    );
    await w.send('第一句');
    const running = await w.claim();
    await w.done(running!.step.id, { status: 'failed', errorMessage: AUTH_ERROR });
    expect(w.stepRow(running!.step.id)?.status).toBe('failed');
    expect(w.messages().some((m) => m.id.startsWith('chief-fallback-'))).toBe(false);
    expect(await w.claim()).toBeNull();
  });

  test('a project thread gets the backup and the line stays in that project', async () => {
    const w = await setupWorld([
      { providerId: 'relay-a', models: ['model-a'] },
      { providerId: 'relay-b', models: ['model-b'] },
    ]);
    const created = await call(w.s.app, 'POST', '/api/projects', { body: { name: 'c2-project' } });
    const projectId = ((await created.json()) as { id: string }).id;
    await w.send('这个项目是做什么的？', projectId);
    const running = await w.claim();
    await w.done(running!.step.id, { status: 'failed', errorMessage: AUTH_ERROR });
    const note = w.messages().find((m) => m.id.startsWith('chief-fallback-'));
    expect(note?.projectId).toBe(projectId);
    expect((await w.claim())?.agent?.provider).toBe('relay-b');
  });

  test('with every backup rejected the turn ends as it does today, with no divider line', async () => {
    const w = await setupWorld([
      { providerId: 'relay-a', models: ['model-a'] },
      { providerId: 'relay-b', models: ['model-b'] },
    ]);
    for (let i = 0; i < 5; i += 1) providerHealth.recordFailure(`${w.teamId}/relay-b`);
    await w.send('第一句');
    const running = await w.claim();
    await w.done(running!.step.id, { status: 'failed', errorMessage: AUTH_ERROR });
    expect(w.messages().some((m) => m.id.startsWith('chief-fallback-'))).toBe(false);
    expect(w.stepRow(running!.step.id)?.status).toBe('failed');
    expect(await w.claim()).toBeNull();
  });
});

describe('a configured task rule skips its own provider when the failure is provider-wide', () => {
  const taskWorld = async () => {
    const s = bootServer({ claimHoldMs: 100, pingIntervalMs: 3_600_000 });
    disposables.push(() => s.dispose());
    for (const providerId of ['relay-a', 'relay-b']) {
      s.db
        .insert(providerTable)
        .values({
          id: `prov-${providerId}`,
          teamId: s.team.id,
          kind: 'custom',
          providerId,
          label: providerId,
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
    const key = await issueApiKey(s);
    const enrolled = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: readyMachine({ teamId: s.team.id, name: 'task-box', cliVersion: '0.1.0' }),
    });
    expect(enrolled.status).toBe(200);
    return s;
  };

  const planFor = (
    s: TestServer,
    errorMessage: string,
    fallbackModels: { provider: string; modelId: string }[],
    quotaBlock?: { kind: 'quota' | 'capacity'; providerId: string; reason: string },
  ) =>
    planModelFallback(
      { db: s.db },
      {
        kind: 'session',
        fallback: null,
        ranModel: null,
      } as unknown as Parameters<typeof planModelFallback>[1],
      {
        teamId: s.team.id,
        machineId: null,
        provider: 'relay-a',
        modelId: 'model-a',
        fallbackModels,
      },
      {
        status: 'failed',
        errorMessage,
        ...(quotaBlock === undefined ? {} : { quotaBlock }),
      },
    );

  test.each([AUTH_ERROR, OUTAGE_ERROR])(
    'a task step does not burn a turn on a sibling of the failed provider (%s)',
    async (errorMessage) => {
      const s = await taskWorld();
      const plan = planFor(s, errorMessage, [
        { provider: 'relay-a', modelId: 'model-a-small' },
        { provider: 'relay-b', modelId: 'model-b' },
      ]);
      expect(plan?.to).toEqual({ provider: 'relay-b', modelId: 'model-b' });
    },
  );

  test('a task step keeps the sibling model when the failure is per-model capacity', async () => {
    const s = await taskWorld();
    const plan = planFor(s, CAPACITY_ERROR, [
      { provider: 'relay-a', modelId: 'model-a-small' },
      { provider: 'relay-b', modelId: 'model-b' },
    ]);
    expect(plan?.to).toEqual({ provider: 'relay-a', modelId: 'model-a-small' });
  });

  test('a task step skips the sibling when quota is read from the error text', async () => {
    const s = await taskWorld();
    const plan = planFor(s, '402: {"message":"insufficient quota: usage limit reached"}', [
      { provider: 'relay-a', modelId: 'model-a-small' },
      { provider: 'relay-b', modelId: 'model-b' },
    ]);
    expect(plan?.trigger).toBe('quota');
    expect(plan?.to).toEqual({ provider: 'relay-b', modelId: 'model-b' });
  });

  test('a quota block that reports capacity still uses the sibling model', async () => {
    const s = await taskWorld();
    const plan = planFor(
      s,
      '429: overloaded',
      [
        { provider: 'relay-a', modelId: 'model-a-small' },
        { provider: 'relay-b', modelId: 'model-b' },
      ],
      { kind: 'capacity', providerId: 'relay-a', reason: 'overloaded' },
    );
    expect(plan?.trigger).toBe('capacity');
    expect(plan?.to).toEqual({ provider: 'relay-a', modelId: 'model-a-small' });
  });
});
