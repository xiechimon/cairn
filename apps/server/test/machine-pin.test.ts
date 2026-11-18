import type { ClaimedStep } from '@cairn/shared';
import {
  claimedStepSchema,
  machineOkResponseSchema,
  machineUploadUrlsResponseSchema,
  PLAN_FILE_NAME,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  chief as chiefTable,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import {
  bootServer,
  insertClaudeSubscription,
  issueApiKey,
  postProject,
  req,
  seedRoute,
  seedSessionRoute,
  startLegacyBuild,
  subscriptionClaudeReport,
  type TestServer,
  withVerification,
} from './helpers.js';

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

async function enroll(s: TestServer, name: string): Promise<string> {
  const key = await issueApiKey(s);
  const res = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({ teamId: s.team.id, name, cliVersion: '0.1.0' }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

async function claim(app: TestServer['app'], token: string): Promise<ClaimedStep | null> {
  const res = await call(app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  const body = (await res.json()) as { step: ClaimedStep | null };
  return body.step === null ? null : claimedStepSchema.parse(body.step);
}

async function rebind(
  w: World,
  use: 'session' | 'coordinator',
  machineId: string,
): Promise<Response> {
  return req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/routing-rules/${use}`, { machineId });
}

interface World {
  s: TestServer;
  tokenA: string;
  tokenB: string;
  machineAId: string;
  machineBId: string;
  projectId: string;
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 200 });
  insertClaudeSubscription(s);
  const tokenA = await enroll(s, 'home-mbp');
  const tokenB = await enroll(s, 'home-other');
  const machineAId = s.db
    .select()
    .from(machineTable)
    .where(eq(machineTable.name, 'home-mbp'))
    .get()!.id;
  const machineBId = s.db
    .select()
    .from(machineTable)
    .where(eq(machineTable.name, 'home-other'))
    .get()!.id;
  s.db.update(machineTable).set({ online: true }).where(eq(machineTable.teamId, s.team.id)).run();
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model', machineId: machineAId });
  const projectId = await postProject(s.app, 'home-proj');
  return { s, tokenA, tokenB, machineAId, machineBId, projectId };
}

async function createTodo(s: TestServer, projectId: string): Promise<string> {
  const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: '',
    spec: '探针任务',
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function startBuild(s: TestServer, projectId: string, todoId: string): Promise<string> {
  const res = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id as string;
}

describe('#1259 worker home-machine gate', () => {
  test('pinned to A -> A claims, B comes up empty; re-pinned to B -> B claims (reassignment immediate)', async () => {
    const w = await setupWorld();
    const todoId = await createTodo(w.s, w.projectId);
    await startBuild(w.s, w.projectId, todoId);

    expect(await claim(w.s.app, w.tokenB)).toBeNull();
    const got = await claim(w.s.app, w.tokenA);
    expect(got).not.toBeNull();
    expect(got!.step.machineId).toBe(w.machineAId);

    const repin = await rebind(w, 'session', w.machineBId);
    expect(repin.status).toBe(200);
    const todoId2 = await createTodo(w.s, w.projectId);
    await startBuild(w.s, w.projectId, todoId2);
    expect(await claim(w.s.app, w.tokenA)).toBeNull();
    const got2 = await claim(w.s.app, w.tokenB);
    expect(got2).not.toBeNull();
    expect(got2!.step.machineId).toBe(w.machineBId);
  });
});

describe('#1312 other-machine mark on a resumed session', () => {
  async function finishPlan(w: World, stepId: string, sessionId: string): Promise<void> {
    const urlsRes = await call(w.s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
      cred: w.tokenA,
      body: { files: [{ name: PLAN_FILE_NAME }] },
    });
    expect(urlsRes.status).toBe(200);
    const planUpload = machineUploadUrlsResponseSchema.parse(await urlsRes.json()).uploads[0]!;
    const planPath = planUpload.url.replace(/^https?:\/\/[^/]+/, '');
    const planPut = await w.s.app.request(planPath, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${w.tokenA}`,
        'content-type': 'text/markdown',
      },
      body: withVerification('# 方案\nContext: 1312\n'),
    });
    expect(machineOkResponseSchema.parse(await planPut.json())).toEqual({ ok: true });
    const doneRes = await call(w.s.app, 'POST', `/api/machine/done/${stepId}`, {
      cred: w.tokenA,
      body: { status: 'success', sessionId, hasChanges: false },
    });
    expect(doneRes.status).toBe(200);
  }

  test('same-machine resume carries no priorMachineId; rebinding the rule does not move the session', async () => {
    const w = await setupWorld();
    const todoId = await createTodo(w.s, w.projectId);
    startLegacyBuild(w.s, todoId, { withPlan: true });
    const plan = await claim(w.s.app, w.tokenA);
    expect(plan?.step.kind).toBe('plan');
    await finishPlan(w, plan!.step.id, 'sess-home');

    const confirmRes = await req(w.s.app, 'POST', `/api/builds/${plan!.step.buildId}/steps`, {
      action: 'confirm',
    });
    expect(confirmRes.status).toBe(202);
    const sameMachine = await claim(w.s.app, w.tokenA);
    expect(sameMachine?.step.kind).toBe('build');
    expect(sameMachine?.session).toEqual({ action: 'continue', sessionId: 'sess-home' });

    const todoId2 = await createTodo(w.s, w.projectId);
    startLegacyBuild(w.s, todoId2, { withPlan: true });
    const plan2 = await claim(w.s.app, w.tokenA);
    expect(plan2?.step.kind).toBe('plan');
    await finishPlan(w, plan2!.step.id, 'sess-moved');
    const repin = await rebind(w, 'session', w.machineBId);
    expect(repin.status).toBe(200);
    const confirm2 = await req(w.s.app, 'POST', `/api/builds/${plan2!.step.buildId}/steps`, {
      action: 'confirm',
    });
    expect(confirm2.status).toBe(202);
    w.s.db
      .update(machineTable)
      .set({
        capabilities: {
          mcpServers: [],
          skills: [],
          osPlatform: 'linux',
          confinement: {
            state: 'checking',
            invocation: 'a6f64985-e79a-4c69-a840-5d8c0853188d',
            generation: 1,
            revision: 1,
          },
        },
      })
      .where(eq(machineTable.id, w.machineAId))
      .run();
    w.s.db
      .update(stepTable)
      .set({ createdAt: Date.now() - 6 * 60_000 })
      .where(eq(stepTable.status, 'pending'))
      .run();
    expect(await claim(w.s.app, w.tokenA)).toBeNull();
    expect(await claim(w.s.app, w.tokenB)).toBeNull();
  });
});

describe('#682 runtime real gate (semantics unchanged, home-machine version)', () => {
  test('a stored all-off runtime list no longer gates: the pi step claims and the switch write is refused', async () => {
    const w = await setupWorld();
    const off = await req(w.s.app, 'PATCH', `/api/machines/${w.machineAId}`, {
      enabledRuntimes: [],
    });
    expect(off.status).toBe(409);
    const todoId = await createTodo(w.s, w.projectId);
    await startBuild(w.s, w.projectId, todoId);
    expect(await claim(w.s.app, w.tokenA)).not.toBeNull();
  });

  test('a claude-code step cannot be claimed on a home machine without Claude Code; re-pin to one that has it claims', async () => {
    const w = await setupWorld();
    w.s.db
      .update(machineTable)
      .set({ claudeCodeReport: { ...subscriptionClaudeReport, installed: false } })
      .where(eq(machineTable.id, w.machineAId))
      .run();
    const todoId = await createTodo(w.s, w.projectId);
    seedSessionRoute(w.s, {
      provider: 'claude-code',
      modelId: 'stub-model',
      machineId: w.machineAId,
    });
    const res = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
      todoIds: [todoId],
    });
    expect(res.status).toBe(201);
    expect(await claim(w.s.app, w.tokenA)).toBeNull();
    w.s.db
      .update(machineTable)
      .set({
        claudeCodeReport: {
          ...subscriptionClaudeReport,
          hostname: 'home-other',
          models: [{ id: 'stub-model', name: 'stub-model', slot: 'default' }],
        },
      })
      .where(eq(machineTable.id, w.machineBId))
      .run();
    const repin = await rebind(w, 'session', w.machineBId);
    expect(repin.status).toBe(200);
    const got = await claim(w.s.app, w.tokenB);
    expect(got).not.toBeNull();
  });

  test('a home machine stored as pi-only claims a claude-code step once it reports Claude Code', async () => {
    const w = await setupWorld();
    w.s.db
      .update(machineTable)
      .set({
        claudeCodeReport: {
          ...subscriptionClaudeReport,
          hostname: 'home-mbp',
          models: [{ id: 'stub-model', name: 'stub-model', slot: 'default' }],
        },
      })
      .where(eq(machineTable.id, w.machineAId))
      .run();
    const todoId = await createTodo(w.s, w.projectId);
    seedSessionRoute(w.s, {
      provider: 'claude-code',
      modelId: 'stub-model',
      machineId: w.machineAId,
    });
    const res = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
      todoIds: [todoId],
    });
    expect(res.status).toBe(201);
    const got = await claim(w.s.app, w.tokenA);
    expect(got?.agent?.provider).toBe('claude-code');
  });
});

describe('#1260 chief step delivery = coordinator rule home machine', () => {
  function bindChief(w: World): void {
    const chiefId = `chief-${w.s.user.id}-${w.s.team.id}`;
    w.s.db
      .insert(chiefTable)
      .values({
        id: chiefId,
        userId: w.s.user.id,
        teamId: w.s.team.id,
        charter: '',
        createdAt: Date.now(),
      })
      .run();
    seedRoute(w.s, 'coordinator', {
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: w.machineAId,
    });
  }

  test('Coordinator pinned to B -> only B can claim the chief step; re-pinned to A -> A claims (reassignment immediate)', async () => {
    const w = await setupWorld();
    bindChief(w);
    const repin = await rebind(w, 'coordinator', w.machineBId);
    expect(repin.status).toBe(200);
    const todoId = await createTodo(w.s, w.projectId);
    const res = await req(w.s.app, 'POST', `/api/todos/${todoId}/orchestrate`, {});
    expect(res.status).toBe(201);
    expect(await claim(w.s.app, w.tokenA)).toBeNull();
    const got = await claim(w.s.app, w.tokenB);
    expect(got).not.toBeNull();
    expect(got!.step.kind).toBe('chief');
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, got!.step.id)).run();

    const back = await rebind(w, 'coordinator', w.machineAId);
    expect(back.status).toBe(200);
    const todoId2 = await createTodo(w.s, w.projectId);
    const res2 = await req(w.s.app, 'POST', `/api/todos/${todoId2}/orchestrate`, {});
    expect(res2.status).toBe(201);
    expect(await claim(w.s.app, w.tokenB)).toBeNull();
    const got2 = await claim(w.s.app, w.tokenA);
    expect(got2).not.toBeNull();
    expect(got2!.step.kind).toBe('chief');
  });
});

describe('#895 GET /chief orchestration envelope (#1260 re-source)', () => {
  interface OrchestrationBlock {
    orchestration: {
      homeMachineId: string | null;
      activity: { machineId: string; running: number; waiting: number }[];
    };
  }

  async function getEnvelope(w: World): Promise<OrchestrationBlock> {
    const res = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/chief`);
    expect(res.status).toBe(200);
    return (await res.json()) as OrchestrationBlock;
  }

  function setChiefStep(
    s: TestServer,
    threadId: string,
    opts: { status: 'claimed' | 'pending'; machineId?: string | null },
  ): void {
    const row = s.db.select().from(stepTable).where(eq(stepTable.buildId, threadId)).get()!;
    s.db
      .update(stepTable)
      .set({ status: opts.status, machineId: opts.machineId ?? null })
      .where(eq(stepTable.id, row.id))
      .run();
  }

  test('failure mode G: projection -- homeMachineId + running (claimed) / waiting (pending not executable by its home machine) counts', async () => {
    const w = await setupWorld();
    seedRoute(w.s, 'coordinator', {
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: w.machineAId,
    });
    const t1 = await req(w.s.app, 'POST', `/api/teams/${w.s.team.id}/chief/threads`, {
      content: '回合一',
    });
    const thread1 = ((await t1.json()) as { thread: { id: string } }).thread.id;
    setChiefStep(w.s, thread1, { status: 'claimed', machineId: w.machineAId });
    w.s.db
      .update(machineTable)
      .set({ online: false })
      .where(eq(machineTable.id, w.machineAId))
      .run();
    await req(w.s.app, 'POST', `/api/teams/${w.s.team.id}/chief/threads`, {
      content: '回合二',
    });

    const body = await getEnvelope(w);
    expect(body.orchestration.homeMachineId).toBe(w.machineAId);
    const activityA = body.orchestration.activity.find((a) => a.machineId === w.machineAId);
    expect(activityA?.running).toBe(1);
    expect(activityA?.waiting).toBe(1);
  });

  test('failure mode H: waiting criterion -- home machine online but without the Coordinator runtime also counts (T3 gap visibility)', async () => {
    const w = await setupWorld();
    seedRoute(w.s, 'coordinator', {
      provider: 'claude-code',
      modelId: 'stub-model',
      machineId: w.machineBId,
    });
    w.s.db
      .update(machineTable)
      .set({ online: true })
      .where(eq(machineTable.id, w.machineBId))
      .run();
    await req(w.s.app, 'POST', `/api/teams/${w.s.team.id}/chief/threads`, {
      content: '回合',
    });

    const body = await getEnvelope(w);
    expect(body.orchestration.homeMachineId).toBe(w.machineBId);
    const activityB = body.orchestration.activity.find((a) => a.machineId === w.machineBId);
    expect(activityB?.waiting).toBe(1);
  });

  test('regression red line: chief with no coordinator rule + no chief step -> homeMachineId null + activity empty', async () => {
    const w = await setupWorld();
    const body = await getEnvelope(w);
    expect(body.orchestration.homeMachineId).toBeNull();
    expect(body.orchestration.activity).toEqual([]);
  });
});
