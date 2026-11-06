import {
  claimedStepSchema,
  parseVerifyPromptMeta,
  VERIFY_ANNOUNCEMENT,
  VERIFY_VERDICT_KIND,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterEach, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  gateVerdict,
  message as messageTable,
  plan as planTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { completeStep, flushVerdictDigests } from '../src/services/builds.js';
import {
  bootServer,
  issueApiKey,
  postProject,
  seedRoute,
  seedSessionRoute,
  withVerification,
} from './helpers.js';

const HEAD = 'ab'.repeat(20);
const FIX_HEAD = 'cd'.repeat(20);

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

async function setup(opts: { withVerifierRoute?: boolean } = {}) {
  const s = bootServer({ claimHoldMs: 200, pingIntervalMs: 3_600_000 });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-verify-dispatch',
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
  if (opts.withVerifierRoute !== false) {
    seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model' });
    seedRoute(s, 'review', { provider: 'stub-gw', modelId: 'stub-model' });
  }
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'verify-mbp', cliVersion: '0.1.0' },
  });
  expect(enrollRes.status).toBe(200);
  const { token: machineToken } = (await enrollRes.json()) as { token: string };
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: 'verify dispatch probe', spec: 'S1' },
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };
  return {
    s,
    todoId,
    async startBuild() {
      const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
        body: { todoIds: [todoId] },
      });
      expect(res.status).toBe(201);
      const buildId = ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id;
      s.db
        .insert(planTable)
        .values({
          id: `plan-${buildId}`,
          buildId,
          version: 1,
          content: withVerification('## Changes\n- touch a.ts'),
          createdAt: Date.now(),
        })
        .run();
      return buildId;
    },
    async claim() {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', {
        cred: machineToken,
        body: {},
      });
      const body = (await res.json()) as { step?: unknown };
      if (!body.step) throw new Error('claim returned no step');
      const parsed = claimedStepSchema.parse(body.step);
      return { stepId: parsed.step.id, kind: parsed.step.kind };
    },
    async done(stepId: string, body: Record<string, unknown>) {
      const res = await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
        cred: machineToken,
        body,
      });
      expect(res.status).toBe(200);
    },
    stepsOf: (buildId: string) =>
      s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all(),
    todoRow: () => s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!,
  };
}

type World = Awaited<ReturnType<typeof setup>>;

let world: World | undefined;
afterEach(async () => {
  await flushVerdictDigests();
  world?.s.dispose();
  world = undefined;
});

describe('verification dispatch driven by the routing rules', () => {
  test('a delivered build queues one verify step bound to its head; the verifier claims it and the verdict lands', async () => {
    world = await setup();
    const w = world;
    const buildId = await w.startBuild();
    const author = await w.claim();
    expect(author.kind).toBe('session');
    await w.done(author.stepId, { status: 'success', hasChanges: true, commit: HEAD });

    expect(w.todoRow().phase).toBe('review');
    const queued = w.stepsOf(buildId).filter((row) => row.kind === 'verify');
    expect(queued).toHaveLength(1);
    expect(queued[0]?.status).toBe('pending');
    expect(parseVerifyPromptMeta(queued[0]?.prompt ?? null)?.expectedHeadSha).toBe(HEAD);
    expect(
      w.s.db
        .select()
        .from(messageTable)
        .where(eq(messageTable.conversationId, buildId))
        .all()
        .some((row) => row.content === VERIFY_ANNOUNCEMENT),
    ).toBe(true);

    const verifier = await w.claim();
    expect(verifier.kind).toBe('verify');
    await w.done(verifier.stepId, {
      status: 'success',
      verifyVerdict: { passed: true, conclusion: 'all green', evidence: [] },
    });

    const verdict = w.s.db
      .select()
      .from(gateVerdict)
      .where(eq(gateVerdict.stepId, verifier.stepId))
      .get();
    expect(verdict?.kind).toBe('verify');
    expect(verdict?.outcome).toBe('pass');
    expect(verdict?.expectedHeadSha).toBe(HEAD);
    expect(
      w.s.db
        .select()
        .from(messageTable)
        .where(eq(messageTable.conversationId, buildId))
        .all()
        .some(
          (row) => typeof row.content === 'string' && row.content.includes(VERIFY_VERDICT_KIND),
        ),
    ).toBe(true);
    expect(w.stepsOf(buildId).filter((row) => row.kind === 'verify')).toHaveLength(1);
  });

  test('a delivery without a code head queues no verify step', async () => {
    world = await setup();
    const w = world;
    const buildId = await w.startBuild();
    const author = await w.claim();
    await w.done(author.stepId, { status: 'success', hasChanges: true });
    expect(w.todoRow().phase).toBe('review');
    expect(w.stepsOf(buildId).filter((row) => row.kind === 'verify')).toHaveLength(0);
  });

  test('a team with no session rule queues no verify step', async () => {
    world = await setup({ withVerifierRoute: false });
    const w = world;
    const buildId = 'build-no-route';
    w.s.db
      .insert(buildTable)
      .values({
        id: buildId,
        todoId: w.todoId,
        withPlan: false,
        triggerSource: 'user',
        createdAt: Date.now(),
      })
      .run();
    w.s.db
      .insert(stepTable)
      .values({
        id: 'step-no-route',
        buildId,
        kind: 'session',
        status: 'claimed',
        checkpointCommit: HEAD,
        createdAt: Date.now(),
      })
      .run();
    w.s.db
      .update(todoTable)
      .set({ latestBuildId: buildId })
      .where(eq(todoTable.id, w.todoId))
      .run();
    completeStep(w.s.svc, 'step-no-route', { hasChanges: true });
    expect(w.stepsOf(buildId).filter((row) => row.kind === 'verify')).toHaveLength(0);
  });

  test('a later delivery in a new round is verified again on its own head', async () => {
    world = await setup();
    const w = world;
    const buildId = await w.startBuild();
    const first = await w.claim();
    await w.done(first.stepId, { status: 'success', hasChanges: true, commit: HEAD });
    const verifier = await w.claim();
    await w.done(verifier.stepId, {
      status: 'success',
      verifyVerdict: { passed: true, conclusion: 'ok', evidence: [] },
    });

    const fixId = 'step-second-round';
    w.s.db
      .insert(stepTable)
      .values({
        id: fixId,
        buildId,
        kind: 'session',
        status: 'claimed',
        checkpointCommit: FIX_HEAD,
        createdAt: Date.now() + 5_000,
      })
      .run();
    completeStep(w.s.svc, fixId, { hasChanges: true });
    const verifies = w.stepsOf(buildId).filter((row) => row.kind === 'verify');
    expect(verifies).toHaveLength(2);
    const heads = verifies.map((row) => parseVerifyPromptMeta(row.prompt)?.expectedHeadSha);
    expect(heads).toEqual(expect.arrayContaining([HEAD, FIX_HEAD]));
  });
});
