import { type ClaimedStep, claimedStepSchema, DEFAULT_AUTONOMY_SETTINGS } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  agent as agentTable,
  autonomousMergeAdmission,
  build,
  message,
  project,
  provider as providerTable,
  steerPending,
  step,
  todo,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { enqueueStep } from '../src/services/builds.js';
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

async function setupWorld(
  opts: { claimHoldMs?: number; githubFetch?: FetchLike } = {},
): Promise<World> {
  const s = bootServer({
    ...opts,
    claimHoldMs: opts.claimHoldMs ?? 250,
    pingIntervalMs: 3_600_000,
  });
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

async function finishBuild(w: World): Promise<string> {
  const { buildId } = await w.startBuild(false);
  const { step: claimed } = await w.claim();
  expect(claimed).not.toBeNull();
  const done = await call(w.s.app, 'POST', `/api/machine/done/${claimed?.step.id}`, {
    cred: w.token,
    body: { status: 'success', sessionId: 'previous-session' },
  });
  expect(done.status).toBe(200);
  const finished = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase: 'done' });
  expect(finished.status).toBe(200);
  return buildId;
}

describe('the steer server write surface (W3 #278)', () => {
  let w: World;
  beforeEach(async () => {
    w = await setupWorld();
  });

  test.each(['merged', 'closed', 'open', 'none', 'unreadable'] as const)(
    'done task with %s PR chooses a deliverable continuation',
    async (state) => {
      const githubFetch: FetchLike = async () =>
        state === 'unreadable'
          ? new Response('', { status: 503 })
          : Response.json({
              state: state === 'open' ? 'open' : 'closed',
              merged: state === 'merged',
            });
      w = await setupWorld({ githubFetch });
      const buildId = await finishBuild(w);
      const task = w.s.db.select().from(todo).where(eq(todo.id, w.todoId)).get()!;
      w.s.db
        .update(project)
        .set({ repoKind: 'github', githubRepo: 'demo-owner/demo-repo' })
        .where(eq(project.id, task.projectId))
        .run();
      if (state !== 'none') {
        w.s.db
          .update(build)
          .set({ prNumber: 43, prUrl: 'https://github.com/demo-owner/demo-repo/pull/43' })
          .where(eq(build.id, buildId))
          .run();
      }
      const published = vi.spyOn(w.s.convHub, 'publishMessage');
      const response = await req(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, {
        content: 'Continue delivery',
      });
      if (state === 'unreadable') {
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          error: expect.stringMatching(/read.*PR.*retry/i),
        });
        expect(w.s.db.select().from(step).where(eq(step.buildId, buildId)).all()).toHaveLength(1);
        return;
      }
      if (state === 'merged') {
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          error: expect.stringMatching(/merged.*new task/i),
        });
        expect(w.s.db.select().from(todo).where(eq(todo.id, w.todoId)).get()?.phase).toBe('done');
        expect(w.s.db.select().from(step).where(eq(step.buildId, buildId)).all()).toHaveLength(1);
        return;
      }
      expect(response.status).toBe(201);
      const reply = (await response.json()) as { conversationId: string };
      const current = w.s.db.select().from(todo).where(eq(todo.id, w.todoId)).get()!;
      expect(current.phase).toBe('queued');
      if (state === 'closed') expect(current.latestBuildId).not.toBe(buildId);
      else expect(current.latestBuildId).toBe(buildId);
      const target = w.s.db.select().from(build).where(eq(build.id, current.latestBuildId!)).get()!;
      expect(reply.conversationId).toBe(target.id);
      expect(
        published.mock.calls
          .filter(([, row]) => row.content === 'Continue delivery')
          .map(([id]) => id),
      ).toEqual([target.id]);
      expect(target).toMatchObject({
        errorMessage: null,
        prevPhase: 'done',
        prNumber: state === 'open' ? 43 : null,
      });
      const pending = w.s.db
        .select()
        .from(step)
        .where(eq(step.buildId, target.id))
        .all()
        .filter((row) => row.status === 'pending');
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ kind: 'build', prompt: 'Continue delivery' });
      const transcript = await req(w.s.app, 'GET', `/api/conversations/${target.id}/messages`);
      expect(await transcript.json()).toMatchObject({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Continue delivery' }),
        ]),
      });
    },
  );

  test.each(['autonomous', 'human'] as const)(
    'a locally merged %s build continues on a new branch',
    async (policy) => {
      const buildId = await finishBuild(w);
      const task = w.s.db.select().from(todo).where(eq(todo.id, w.todoId)).get()!;
      w.s.db
        .update(project)
        .set({
          repoKind: 'local',
          localPath: '/tmp/continue-local',
          autonomy: { ...DEFAULT_AUTONOMY_SETTINGS, mergePolicy: policy },
        })
        .where(eq(project.id, task.projectId))
        .run();
      if (policy === 'autonomous') {
        w.s.db
          .insert(autonomousMergeAdmission)
          .values({ buildId, teamId: w.s.team.id, state: 'merged', createdAt: 1, landedAt: 2 })
          .run();
      } else {
        w.s.db
          .insert(step)
          .values({
            id: 'landed-merge',
            buildId,
            kind: 'merge',
            status: 'done',
            checkpointCommit: 'a'.repeat(40),
            createdAt: 1,
            finishedAt: 2,
          })
          .run();
      }
      const response = await req(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, {
        content: 'Continue after local landing',
      });
      expect(response.status).toBe(201);
      const current = w.s.db.select().from(todo).where(eq(todo.id, w.todoId)).get()!;
      expect(current.latestBuildId).not.toBe(buildId);
      expect(current.phase).toBe('queued');
      const next = await w.claim();
      expect(next.step).toMatchObject({
        conversationId: current.latestBuildId,
        session: { action: 'new', sessionId: null },
        instruction: 'Continue after local landing',
      });
      expect(
        w.s.db
          .select()
          .from(autonomousMergeAdmission)
          .where(eq(autonomousMergeAdmission.buildId, current.latestBuildId!))
          .all(),
      ).toEqual([]);
    },
  );

  test('a CI-fix build step after reopening resumes the builder instead of the reviewer', async () => {
    const buildId = await finishBuild(w);
    w.s.db.update(build).set({ prevPhase: 'done' }).where(eq(build.id, buildId)).run();
    w.s.db
      .insert(step)
      .values({
        id: 'ci-review-session',
        buildId,
        kind: 'review',
        status: 'done',
        sessionId: 'review-session',
        machineId: w.machineId,
        createdAt: Date.now() + 1,
      })
      .run();
    w.s.db.update(todo).set({ phase: 'queued' }).where(eq(todo.id, w.todoId)).run();
    enqueueStep(w.s.svc, buildId, 'build', w.s.team.id, 'Fix the failing CI check');
    const next = await w.claim();
    expect(next.step).toMatchObject({
      instruction: 'Fix the failing CI check',
      session: { action: 'continue', sessionId: 'previous-session' },
    });
  });

  test('continuation resets build metadata and resumes the builder instead of the later reviewer', async () => {
    const buildId = await finishBuild(w);
    w.s.db
      .update(build)
      .set({ errorMessage: 'Previous failure', prevPhase: 'failed' })
      .where(eq(build.id, buildId))
      .run();
    w.s.db
      .insert(step)
      .values({
        id: 'review-session-step',
        buildId,
        kind: 'review',
        status: 'done',
        sessionId: 'review-session',
        machineId: w.machineId,
        createdAt: Date.now() + 1,
      })
      .run();
    const response = await req(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, {
      content: 'Resume the builder',
    });
    expect(response.status).toBe(201);
    const claimed = await w.claim();
    expect(claimed.step?.session).toMatchObject({
      action: 'continue',
      sessionId: 'previous-session',
    });
    expect(w.s.db.select().from(build).where(eq(build.id, buildId)).get()).toMatchObject({
      errorMessage: null,
      prevPhase: 'done',
    });
  });

  test('done thread continues on the same build with one step and moves through queued to building', async () => {
    const buildId = await finishBuild(w);
    const before = w.s.db.select().from(step).where(eq(step.buildId, buildId)).all();
    const wakeBefore = w.s.machineHub.wakeSeq(w.s.team.id);
    const res = await req(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, {
      content: 'Add a regression test for the completed task',
    });
    expect(res.status).toBe(201);
    const sent = (await res.json()) as { message: { id: string; content: string } };
    expect(
      w.s.db.select().from(message).where(eq(message.id, sent.message.id)).get(),
    ).toMatchObject({
      conversationId: buildId,
      role: 'user',
      content: sent.message.content,
    });
    const queued = w.s.db.select().from(todo).where(eq(todo.id, w.todoId)).get();
    expect(queued).toMatchObject({ phase: 'queued', latestBuildId: buildId });
    const steps = w.s.db.select().from(step).where(eq(step.buildId, buildId)).all();
    expect(steps).toHaveLength(before.length + 1);
    expect(steps.find((row) => !before.some((old) => old.id === row.id))).toMatchObject({
      kind: 'build',
      status: 'pending',
      prompt: sent.message.content,
      freshSession: false,
    });
    expect(w.s.db.select().from(build).where(eq(build.todoId, w.todoId)).all()).toHaveLength(1);
    expect(w.s.db.select().from(steerPending).all()).toEqual([]);
    expect(w.s.machineHub.wakeSeq(w.s.team.id)).toBeGreaterThan(wakeBefore);
    const { step: claimed } = await w.claim();
    expect(claimed).toMatchObject({
      conversationId: buildId,
      step: { kind: 'build', buildId },
      session: { action: 'continue', sessionId: 'previous-session' },
      instruction: sent.message.content,
    });
    expect(w.s.db.select().from(todo).where(eq(todo.id, w.todoId)).get()?.phase).toBe('building');
  });

  test('a second send before claim cannot enqueue a duplicate continuation or persist a rejected message', async () => {
    const buildId = await finishBuild(w);
    const responses = await Promise.all([
      req(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, { content: 'Continue once' }),
      req(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, { content: 'Continue twice' }),
    ]);
    expect(responses.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(w.s.db.select().from(step).where(eq(step.buildId, buildId)).all()).toHaveLength(2);
    const users = w.s.db.select().from(message).where(eq(message.role, 'user')).all();
    expect(
      users.filter((row) => typeof row.content === 'string' && row.content.startsWith('Continue')),
    ).toHaveLength(1);
  });

  test.each(['closed', 'todo', 'done'] as const)(
    'a %s task cannot continue an obsolete build',
    async (phase) => {
      const buildId = await finishBuild(w);
      w.s.db
        .insert(build)
        .values({
          id: 'newer-build',
          todoId: w.todoId,
          withPlan: false,
          triggerSource: 'user',
          createdAt: Date.now(),
        })
        .run();
      w.s.db
        .update(todo)
        .set({ phase, latestBuildId: 'newer-build' })
        .where(eq(todo.id, w.todoId))
        .run();
      const res = await req(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, {
        content: 'Obsolete',
      });
      expect(res.status).toBe(409);
      expect(w.s.db.select().from(step).where(eq(step.buildId, buildId)).all()).toHaveLength(1);
      expect(w.s.db.select().from(message).where(eq(message.content, 'Obsolete')).all()).toEqual(
        [],
      );
    },
  );

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
