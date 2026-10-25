import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  plan as planTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { completeStep } from '../src/services/builds.js';
import { setTodoPhase } from '../src/services/todos.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  postProject,
  req,
  type TestServer,
} from './helpers.js';

const AGENT_PLAN = 'agent-rw-plan';
const AGENT_BUILD = 'agent-rw-build';

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
    body: { teamId: s.team.id, name: 'rework-mbp', cliVersion: '0.1.0' },
  });
  expect(res.status).toBe(200);
  const token = ((await res.json()) as { token: string }).token;
  for (const id of [AGENT_PLAN, AGENT_BUILD]) {
    s.db
      .insert(agentTable)
      .values({ id, teamId: s.team.id, displayName: id, modelId: 'stub-model' })
      .run();
  }
  bindAllAgents(s);
  const projectId = await postProject(s.app, 'rework-proj');
  return { s, tokenA: token, projectId };
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

interface ReviewWorld {
  w: World;
  todoId: string;
  buildId: string;
  stepsOf: () => Promise<{ id: string; kind: string; status: string }[]>;
  phaseOf: () => Promise<string>;
}

async function worldInReview(
  w: World,
  assignment: { plan: { agentId: string } | null; build: { agentId: string } | null },
): Promise<ReviewWorld> {
  const todoRes = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
    title: 'rework probe',
    spec: 'probe body',
  });
  expect(todoRes.status).toBe(201);
  const todoId = ((await todoRes.json()) as { id: string }).id;
  const started = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
    todoIds: [todoId],
    assignment,
    withPlan: true,
  });
  expect(started.status).toBe(201);
  const buildId = ((await started.json()) as { builds: { id: string }[] }).builds[0]!.id;
  const stepsOf = async () =>
    ((await (await req(w.s.app, 'GET', `/api/builds/${buildId}/steps`)).json()) as unknown[]).map(
      (r) => r as { id: string; kind: string; status: string },
    );
  const phaseOf = async () =>
    ((await (await req(w.s.app, 'GET', `/api/todos/${todoId}`)).json()) as { phase: string }).phase;
  setTodoPhase(w.s.svc, todoId, 'planning');
  w.s.db
    .insert(planTable)
    .values({
      id: `plan-rw-${buildId.slice(0, 8)}`,
      buildId,
      version: 1,
      content: '# 方案 v1',
      createdAt: 1,
    })
    .run();
  completeStep(w.s.svc, (await stepsOf())[0]!.id);
  await req(w.s.app, 'POST', `/api/builds/${buildId}/steps`, { action: 'confirm' });
  const steps = await stepsOf();
  const buildStep = steps[steps.length - 1]!;
  w.s.db
    .update(stepTable)
    .set({ sessionId: 'sess-first-build' })
    .where(eq(stepTable.id, buildStep.id))
    .run();
  completeStep(w.s.svc, buildStep.id);
  return { w, todoId, buildId, stepsOf, phaseOf };
}

const REJECT_BODY = {
  action: 'revision',
  side: 'plan',
  feedback: '把确认按钮的文案改掉，其余不动',
  clientMessageId: '3f9a0c2e-0000-4000-8000-000000001204',
} as const;

async function rejectInReview(rw: ReviewWorld): Promise<void> {
  const res = await req(rw.w.s.app, 'POST', `/api/builds/${rw.buildId}/steps`, REJECT_BODY);
  expect(res.status).toBe(202);
}

describe('#1204 A: the slot fallback when rework returns to a plan step (agentForStep)', () => {
  test('A1: an empty plan slot (build slot filled) + review requests changes -> the build agent claims the replan step, no longer failed', async () => {
    const w = await setupWorld();
    const rw = await worldInReview(w, {
      plan: null,
      build: { agentId: AGENT_BUILD },
    });
    expect(await rw.phaseOf()).toBe('review');
    await rejectInReview(rw);
    expect(await rw.phaseOf()).toBe('planning');

    const claimed = await claim(w);
    expect(claimed).not.toBeNull();
    expect(claimed?.step.kind).toBe('plan');
    expect(claimed?.agent?.id).toBe(AGENT_BUILD);
    const stepRow = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, claimed!.step.id))
      .get()!;
    expect(stepRow.status).toBe('claimed');
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, rw.todoId)).get()!;
    expect(todoRow.phase).toBe('planning');
  });

  test('A2: a rework step with both slots empty -> still ends failed, the text names both slots', async () => {
    const w = await setupWorld();
    const rw = await worldInReview(w, { plan: null, build: null });
    await rejectInReview(rw);

    await claim(w);
    const steps = await rw.stepsOf();
    const last = steps[steps.length - 1]!;
    expect(last.kind).toBe('plan');
    expect(last.status).toBe('failed');
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, rw.todoId)).get()!;
    expect(todoRow.phase).toBe('failed');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, rw.buildId)).get()!;
    expect(buildRow.errorMessage).toContain('plan 槽与 build 槽均为空');
  });

  test('A3 (regression red line): a first-round plan step (no prompt) with an empty plan slot -> still ends failed per #1104 B', async () => {
    const w = await setupWorld();
    const todoRes = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
      title: 'first-run probe',
      spec: 'body',
    });
    const todoId = ((await todoRes.json()) as { id: string }).id;
    const started = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
      todoIds: [todoId],
      assignment: { plan: null, build: { agentId: AGENT_BUILD } },
      withPlan: true,
    });
    const buildId = ((await started.json()) as { builds: { id: string }[] }).builds[0]!.id;

    await claim(w);
    const stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).get()!;
    expect(stepRow.kind).toBe('plan');
    expect(stepRow.status).toBe('failed');
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
    expect(todoRow.phase).toBe('failed');
  });

  test('A4 (regression): a rework step with the plan slot filled -> the plan agent claims it (status quo unchanged)', async () => {
    const w = await setupWorld();
    const rw = await worldInReview(w, {
      plan: { agentId: AGENT_PLAN },
      build: { agentId: AGENT_BUILD },
    });
    await rejectInReview(rw);

    const claimed = await claim(w);
    expect(claimed?.step.kind).toBe('plan');
    expect(claimed?.agent?.id).toBe(AGENT_PLAN);
  });
});
