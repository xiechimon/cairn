import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newUuidv7, nowMs } from '../src/lib/ids.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { createScheduler } from '../src/services/scheduler.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  postProject,
  req,
  type TestServer,
} from './helpers.js';

const AGENT_ID = 'agent-unassigned-1';

const servers: TestServer[] = [];
afterAll(() => {
  for (const s of servers) s.dispose();
});

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

interface World {
  s: TestServer;
  tokenA: string;
  projectId: string;
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 50 });
  servers.push(s);
  const key = await issueApiKey(s);
  const res = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'unassigned-mbp', cliVersion: '0.1.0' },
  });
  expect(res.status).toBe(200);
  const token = ((await res.json()) as { token: string }).token;
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: AGENT_ID,
      modelId: 'stub-model',
    })
    .run();
  bindAllAgents(s);

  const projectId = await postProject(s.app, 'unassigned-proj');
  return { s, tokenA: token, projectId };
}

async function createTodo(w: World): Promise<string> {
  const res = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
    title: '',
    spec: 'unassigned probe',
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function startBuild(
  w: World,
  todoId: string,
  assignment: unknown,
  withPlan: boolean,
): Promise<string> {
  const res = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
    todoIds: [todoId],
    assignment,
    withPlan,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id;
}

async function claim(w: World): Promise<ClaimedStep | null> {
  const res = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
    cred: w.tokenA,
    body: {},
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { step: ClaimedStep | null };
  return body.step === null ? null : claimedStepSchema.parse(body.step);
}

function stepRowOf(s: TestServer, buildId: string) {
  return s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).get()!;
}

function expectFailedFunnel(s: TestServer, buildId: string, todoId: string, rootNeedle: string) {
  const stepRow = stepRowOf(s, buildId);
  expect(stepRow.status).toBe('failed');
  const buildRow = s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
  expect(buildRow.errorMessage).toContain(rootNeedle);
  const todoRow = s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
  expect(todoRow.phase).toBe('failed');
}

describe('#1104 A: chief run_builds without an assignment -> 400 rejection', () => {
  test('failure mode 1: the whole argument missing / an empty object / both slots empty -> 400; succeeds once supplied', async () => {
    const w = await setupWorld();
    const chiefId = `chief-${w.s.user.id}-${w.s.team.id}`;
    w.s.db
      .insert(chiefTable)
      .values({
        id: chiefId,
        userId: w.s.user.id,
        teamId: w.s.team.id,
        agentId: AGENT_ID,
        charter: '',
        createdAt: nowMs(),
      })
      .run();
    const threadId = `chief-${newUuidv7()}`;
    w.s.db
      .insert(chiefThreadTable)
      .values({
        id: threadId,
        chiefId,
        userId: w.s.user.id,
        teamId: w.s.team.id,
        title: 'unassigned relay',
        createdAt: nowMs(),
        updatedAt: nowMs(),
        sessionRuntime: 'pi',
        sessionId: '',
        sessionOpenedAt: nowMs(),
        toolDefHashes: {},
        toolResultHashes: {},
      })
      .run();
    const relay = (params: Record<string, unknown>) =>
      executeChiefTool(
        {
          db: w.s.db,
          hub: w.s.hub,
          machineHub: w.s.machineHub,
          box: w.s.secretBox,
          user: w.s.user,
          reposDir: w.s.reposDir,
          attachmentsDir: w.s.attachmentsDir,
          skillsDir: w.s.skillsDir,
        },
        {
          teamId: w.s.team.id,
          userId: w.s.user.id,
          chiefId,
          threadId,
          chiefAgentId: AGENT_ID,
          conversationId: threadId,
        },
        'run_builds',
        params,
      );

    const todoId = await createTodo(w);
    await expect(relay({ todoIds: [todoId] })).rejects.toThrow(/两槽全空/);
    await expect(relay({ todoIds: [todoId], assignment: {} })).rejects.toThrow(/两槽全空/);
    await expect(
      relay({ todoIds: [todoId], assignment: { plan: null, build: null } }),
    ).rejects.toThrow(/两槽全空/);
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
    expect(todoRow.phase).toBe('todo');
    const out = JSON.parse(
      await relay({
        todoIds: [todoId],
        assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      }),
    ) as { builds: { id: string }[] };
    expect(out.builds).toHaveLength(1);
    const todoAfter = w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
    expect(todoAfter.phase).toBe('queued');
  });
});

describe('#1104 B: an ownerless step ends failed at the claim surface (the single criterion agentForStep)', () => {
  test('failure mode 2: REST with an empty assignment -> 201 queued; ends failed after claim; legitimate steps are not blocked', async () => {
    const w = await setupWorld();
    const unassignedId = await createTodo(w);
    const buildId = await startBuild(w, unassignedId, { plan: null, build: null }, false);
    const validId = await createTodo(w);
    await startBuild(w, validId, { plan: null, build: { agentId: AGENT_ID } }, false);

    const claimed = await claim(w);
    expect(claimed?.step.kind).toBe('build');
    expectFailedFunnel(w.s, buildId, unassignedId, '无指派 Agent');
  });

  test('failure mode 3: a scheduled trigger of an unassigned todo -> the same funnel', async () => {
    const w = await setupWorld();
    const todoId = await createTodo(w);
    const scheduler = createScheduler(w.s.svc, { tickMs: 60_000 });
    scheduler.start();
    try {
      const at = new Date('2026-10-01T00:00:00+08:00').getTime();
      const res = await req(w.s.app, 'POST', '/api/schedules', { todoId, kind: 'once', at });
      expect(res.status).toBe(201);
      scheduler.tick();
      const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.todoId, todoId)).get()!;
      expect(buildRow.triggerSource).toBe('schedule');

      await claim(w);
      expectFailedFunnel(w.s, buildRow.id, todoId, '无指派 Agent');
    } finally {
      scheduler.stop();
    }
  });

  test('failure mode 4: fully-assigned paths behave unchanged (both slots withPlan / build-only direct execution)', async () => {
    const w = await setupWorld();
    const dualId = await createTodo(w);
    await startBuild(
      w,
      dualId,
      { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      true,
    );
    const claimed1 = await claim(w);
    expect(claimed1?.step.kind).toBe('plan');

    const directId = await createTodo(w);
    await startBuild(w, directId, { plan: null, build: { agentId: AGENT_ID } }, false);
    const claimed2 = await claim(w);
    expect(claimed2?.step.kind).toBe('build');
  });

  test('failure mode 5: a slot pointing at a deleted agent -> the same funnel, the text names the agentId', async () => {
    const w = await setupWorld();
    const todoId = await createTodo(w);
    const buildId = await startBuild(
      w,
      todoId,
      { plan: null, build: { agentId: 'agent-gone' } },
      false,
    );
    await claim(w);
    expectFailedFunnel(w.s, buildId, todoId, 'agent-gone');
  });
});
