import {
  claimedStepSchema,
  DONE_ANNOUNCEMENT,
  type PersonaRole,
  parseReviewPromptMeta,
  REVIEW_ANNOUNCEMENT,
  SPLIT_ANNOUNCEMENT,
  VERIFY_ANNOUNCEMENT,
  VERIFY_VERDICT_KIND,
  verifyVerdictSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  message as messageTable,
  plan as planTable,
  project as projectTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import {
  advanceSplitWaves,
  dispatchSplitChildren,
  maybeEnqueueVerifyStep,
} from '../src/services/builds.js';
import { agentIdForStep, unassignedStepReason } from '../src/services/dispatch-eligibility.js';
import { ensurePersonasSeeded } from '../src/services/personas.js';
import { createSplitTodo } from '../src/services/todo-split.js';
import type { TestServer } from './helpers.js';
import { bindAllAgents, bootServer, insertMachine, issueApiKey, postProject } from './helpers.js';

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
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    }),
  );
}

interface World {
  s: TestServer;
  machineToken: string;
  projectId: string;
  todoId: string;
  startBuild(assignment: Record<string, unknown>, withPlan?: boolean): Promise<string>;
  claim(): Promise<{ stepId: string; kind: string }>;
  done(stepId: string, body: Record<string, unknown>): Promise<void>;
  todoRow(): ReturnType<typeof loadTodoRow>;
  stepsOf(buildId: string): ReturnType<typeof loadStepsOf>;
  messagesOf(buildId: string): ReturnType<typeof loadMessagesOf>;
  planContent(buildId: string): string;
}

function loadTodoRow(s: TestServer, todoId: string) {
  return s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
}
function loadStepsOf(s: TestServer, buildId: string) {
  return s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
}
function loadMessagesOf(s: TestServer, buildId: string) {
  return s.db.select().from(messageTable).where(eq(messageTable.conversationId, buildId)).all();
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 200, pingIntervalMs: 3_600_000 });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-split',
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
  ensurePersonasSeeded(s.db, s.team.id);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'split-mbp', cliVersion: '0.1.0' },
  });
  expect(enrollRes.status).toBe(200);
  const { token: machineToken } = (await enrollRes.json()) as { token: string };
  bindAllAgents(s);
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '流水线探针', spec: '验证 #1250 的层 1 流水线' },
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };

  async function startBuild(assignment: Record<string, unknown>, withPlan = false) {
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: { todoIds: [todoId], assignment, withPlan },
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id;
  }
  async function claim() {
    const res = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: machineToken,
      body: {},
    });
    const body = (await res.json()) as { step?: unknown };
    if (!body.step) throw new Error('claim returned no step');
    const parsed = claimedStepSchema.parse(body.step);
    return { stepId: parsed.step.id, kind: parsed.step.kind };
  }
  async function done(stepId: string, body: Record<string, unknown>) {
    const res = await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
      cred: machineToken,
      body,
    });
    expect(res.status).toBe(200);
  }
  return {
    s,
    machineToken,
    projectId,
    todoId,
    startBuild,
    claim,
    done,
    todoRow: () => loadTodoRow(s, todoId),
    stepsOf: (buildId) => loadStepsOf(s, buildId),
    messagesOf: (buildId) => loadMessagesOf(s, buildId),
    planContent: (buildId) =>
      s.db
        .select()
        .from(planTable)
        .where(eq(planTable.buildId, buildId))
        .all()
        .map((r) => r.content)
        .join('\n'),
  };
}

function personaAgentId(s: TestServer, role: PersonaRole): string {
  return (
    s.db.select({ id: agentTable.id }).from(agentTable).where(eq(agentTable.persona, role)).get()
      ?.id ?? ''
  );
}

describe('#1250 persona seeding', () => {
  test('failure mode 1: six members stored, persona slots / tiers / contract texts all in place; models take the claimable values of the current list', () => {
    const s = bootServer({});
    s.db
      .insert(providerTable)
      .values({
        id: 'prov-seed',
        teamId: s.team.id,
        kind: 'custom',
        providerId: 'stub-gw',
        label: 'Stub',
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
    const inserted = ensurePersonasSeeded(s.db, s.team.id);
    expect(inserted).toBe(6);
    const rows = s.db.select().from(agentTable).where(eq(agentTable.teamId, s.team.id)).all();
    const byRole = new Map(rows.map((r) => [r.persona, r]));
    const roles: readonly PersonaRole[] = [
      'planner',
      'implementer',
      'code_reviewer',
      'security_auditor',
      'test_engineer',
      'verifier',
    ];
    for (const role of roles) {
      const row = byRole.get(role);
      expect(row, role).toBeDefined();
      expect(row!.description, role).toContain('Composition');
      expect(row!.provider, role).toBe('stub-gw');
      expect(row!.modelId, role).toBe('stub-model');
    }
    expect(byRole.get('planner')!.thinkingLevel).toBe('xhigh');
    expect(byRole.get('implementer')!.thinkingLevel).toBe('high');
    expect(byRole.get('code_reviewer')!.thinkingLevel).toBe('medium');
    expect(byRole.get('verifier')!.thinkingLevel).toBe('medium');
  });

  test('failure mode 2: idempotent = fill gaps without overwriting (zero inserts the second time, edits kept, null models filled at boot, deleted rows revived)', () => {
    const s = bootServer({});
    ensurePersonasSeeded(s.db, s.team.id);
    const before = s.db.select().from(agentTable).where(eq(agentTable.persona, 'planner')).get()!;
    expect(before.modelId).toBeNull();
    s.db
      .insert(providerTable)
      .values({
        id: 'prov-late',
        teamId: s.team.id,
        kind: 'custom',
        providerId: 'late-gw',
        label: 'Late',
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions',
        authHeader: true,
        compat: { supportsDeveloperRole: false },
        models: [{ id: 'late-model', name: 'late-model' }],
        createdBy: s.user.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
    expect(ensurePersonasSeeded(s.db, s.team.id)).toBe(0);
    const filled = s.db.select().from(agentTable).where(eq(agentTable.persona, 'planner')).get()!;
    expect(filled.modelId).toBe('late-model');
    s.db
      .update(agentTable)
      .set({ description: '自定义职责', modelId: 'glm-5.3' })
      .where(eq(agentTable.persona, 'planner'))
      .run();
    ensurePersonasSeeded(s.db, s.team.id);
    const edited = s.db.select().from(agentTable).where(eq(agentTable.persona, 'planner')).get()!;
    expect(edited.description).toBe('自定义职责');
    expect(edited.modelId).toBe('glm-5.3');
    s.db.delete(agentTable).where(eq(agentTable.persona, 'verifier')).run();
    expect(ensurePersonasSeeded(s.db, s.team.id)).toBe(1);
  });
});

describe('#1250 the verify step (layer 1)', () => {
  test('failure mode 3: the review gate reached and the verify slot filled -> the verify step queued + an announcement row; empty slot, no action', async () => {
    const w = await setupWorld();
    const verifierId = personaAgentId(w.s, 'verifier');
    const buildId = await w.startBuild({
      plan: { agentId: personaAgentId(w.s, 'implementer') },
      build: { agentId: personaAgentId(w.s, 'implementer') },
      verify: { agentId: verifierId },
    });
    const claimed = await w.claim();
    expect(claimed.kind).toBe('build');
    await w.done(claimed.stepId, { status: 'success', hasChanges: true });
    expect(w.todoRow().phase).toBe('review');
    const verifySteps = w.stepsOf(buildId).filter((r) => r.kind === 'verify');
    expect(verifySteps).toHaveLength(1);
    expect(verifySteps[0]!.status).toBe('pending');
    expect(verifySteps[0]!.prompt).toContain('docs/verify/');
    expect(w.messagesOf(buildId).some((m) => m.content === VERIFY_ANNOUNCEMENT)).toBe(true);
    const todoRes2 = await call(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
      body: { title: '无槽探针', spec: 'x' },
    });
    const { id: todo2 } = (await todoRes2.json()) as { id: string };
    const row2 = loadTodoRow(w.s, todo2);
    maybeEnqueueVerifyStep(
      { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub, user: w.s.user },
      row2,
      buildId,
    );
    expect(w.stepsOf(buildId).filter((r) => r.kind === 'verify')).toHaveLength(1);
  });

  test('failure mode 4: the verify step finishes -> the VERIFY_VERDICT message lands, the phase unchanged, the agent takes the verify slot', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    const verifierId = personaAgentId(w.s, 'verifier');
    const buildId = await w.startBuild({
      plan: { agentId: implementerId },
      build: { agentId: implementerId },
      verify: { agentId: verifierId },
    });
    const claimed = await w.claim();
    await w.done(claimed.stepId, { status: 'success', hasChanges: true });
    const verifyStep = w.stepsOf(buildId).find((r) => r.kind === 'verify')!;
    expect(agentIdForStep(w.todoRow(), 'verify', verifyStep.prompt)).toBe(verifierId);
    const verifyClaimed = await w.claim();
    expect(verifyClaimed.kind).toBe('verify');
    await w.done(verifyClaimed.stepId, {
      status: 'success',
      verifyVerdict: { passed: true, conclusion: 'e2e 全绿', evidence: [] },
    });
    const verdictMsg = w
      .messagesOf(buildId)
      .map((m) => m.content)
      .find((c) => typeof c === 'string' && c.includes(VERIFY_VERDICT_KIND));
    expect(verdictMsg).toBeDefined();
    const parsed = verifyVerdictSchema.parse(
      JSON.parse(verdictMsg as string).verdict satisfies unknown,
    );
    expect(parsed.passed).toBe(true);
    expect(w.todoRow().phase).toBe('review');
  });

  test('failure mode 5: empty verify slot -> the ownerless-step failure text names the verify slot (the agentForStep null patch)', async () => {
    const s = bootServer({});
    ensurePersonasSeeded(s.db, s.team.id);
    const projectId = await postProject(s.app);
    const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: 't', spec: 's' },
    });
    const { id: todoId } = (await todoRes.json()) as { id: string };
    const row = s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
    expect(agentIdForStep(row, 'verify', null)).toBeNull();
    expect(unassignedStepReason(row, 'verify', null)).toContain('verify 槽');
    const verifierId = s.db
      .select({ id: agentTable.id })
      .from(agentTable)
      .where(eq(agentTable.persona, 'verifier'))
      .get()!.id;
    s.db
      .update(todoTable)
      .set({ assignment: { plan: null, build: null, verify: { agentId: verifierId } } })
      .where(eq(todoTable.id, todoId))
      .run();
    const updated = s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
    expect(agentIdForStep(updated, 'verify', null)).toBe(verifierId);
  });
});

describe('#1250 review fan-out, three perspectives', () => {
  test('failure mode 6: agentId absent -> three review steps each attached to a persona agent (meta header) + one announcement row', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    const buildId = await w.startBuild({
      plan: { agentId: implementerId },
      build: { agentId: implementerId },
    });
    const claimed = await w.claim();
    await w.done(claimed.stepId, { status: 'success', hasChanges: true });
    const res = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'review' },
    });
    expect(res.status).toBe(202);
    const reviewSteps = w.stepsOf(buildId).filter((r) => r.kind === 'review');
    expect(reviewSteps).toHaveLength(3);
    const metaAgentIds = reviewSteps.map((r) => parseReviewPromptMeta(r.prompt)?.agentId);
    const expected = [
      personaAgentId(w.s, 'code_reviewer'),
      personaAgentId(w.s, 'security_auditor'),
      personaAgentId(w.s, 'test_engineer'),
    ].sort();
    expect([...metaAgentIds].sort()).toEqual(expected);
    expect(reviewSteps.some((r) => r.prompt!.includes('五轴 review'))).toBe(true);
    expect(reviewSteps.some((r) => r.prompt!.includes('安全审计'))).toBe(true);
    expect(reviewSteps.some((r) => r.prompt!.includes('测试覆盖缺口'))).toBe(true);
    expect(w.messagesOf(buildId).filter((m) => m.content === REVIEW_ANNOUNCEMENT).length).toBe(1);
  });

  test('failure mode 7: personas all deleted with the review slot filled -> falls back to a single step; both missing -> 400', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    const buildId = await w.startBuild({
      plan: { agentId: implementerId },
      build: { agentId: implementerId },
    });
    const claimed = await w.claim();
    await w.done(claimed.stepId, { status: 'success', hasChanges: true });
    w.s.db.delete(agentTable).where(eq(agentTable.persona, 'code_reviewer')).run();
    w.s.db.delete(agentTable).where(eq(agentTable.persona, 'security_auditor')).run();
    w.s.db.delete(agentTable).where(eq(agentTable.persona, 'test_engineer')).run();
    const res = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'review' },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('assignment.review');
    w.s.db
      .update(todoTable)
      .set({
        assignment: {
          plan: null,
          build: { agentId: implementerId },
          review: { agentId: implementerId },
        },
      })
      .where(eq(todoTable.id, w.todoId))
      .run();
    const res2 = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'review' },
    });
    expect(res2.status).toBe(202);
    expect(w.stepsOf(buildId).filter((r) => r.kind === 'review')).toHaveLength(1);
  });

  test('failure mode 8: two blocking verdicts from the fan-out -> only one revision step queued (dedupe gate)', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    const buildId = await w.startBuild({
      plan: { agentId: implementerId },
      build: { agentId: implementerId },
    });
    const claimed = await w.claim();
    await w.done(claimed.stepId, { status: 'success', hasChanges: true });
    await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'review' },
    });
    const blockingVerdict = {
      conclusion: '有 blocking',
      findings: [{ id: '1', severity: 'blocking', summary: 's1' }],
    };
    const claimedReviews = [await w.claim(), await w.claim()];
    expect(claimedReviews.every((c) => c.kind === 'review')).toBe(true);
    await w.done(claimedReviews[0]!.stepId, { status: 'success', findings: blockingVerdict });
    await w.done(claimedReviews[1]!.stepId, { status: 'success', findings: blockingVerdict });
    const planSteps = w
      .stepsOf(buildId)
      .filter((r) => r.kind === 'plan' && (r.status === 'pending' || r.status === 'claimed'));
    expect(planSteps).toHaveLength(1);
    expect(w.todoRow().phase).toBe('planning');
  });
});

describe('#1250 split_todo (layer 2)', () => {
  test('failure mode 9: the validation family -- phase not todo 409 / double split 409 / fewer than two 400 / index out of range 400 / cycle 400 / agent from another team 404', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    const deps = {
      db: w.s.db,
      hub: w.s.hub,
      machineHub: w.s.machineHub,
      user: w.s.user,
    };
    const ctx = {
      parentId: w.todoId,
      chiefAgentId: null,
      chiefId: 'chief-test',
      threadId: 'chief-thread-1',
      actorName: 'Chief',
    };
    const two = [
      { title: 'a', spec: 'sa', agentId: implementerId },
      { title: 'b', spec: 'sb', agentId: implementerId, blockedBy: [1] },
    ];
    expect(() => createSplitTodo(deps, { ...ctx, subtodos: [two[0]!] })).toThrowError(/至少两张/);
    expect(() =>
      createSplitTodo(deps, {
        ...ctx,
        subtodos: [two[0]!, { ...two[1]!, blockedBy: [5] }],
      }),
    ).toThrowError(/越界/);
    expect(() =>
      createSplitTodo(deps, {
        ...ctx,
        subtodos: [two[0]!, { ...two[1]!, blockedBy: [2] }],
      }),
    ).toThrowError(/自指/);
    expect(() =>
      createSplitTodo(deps, {
        ...ctx,
        subtodos: [
          { ...two[0]!, blockedBy: [2] },
          { ...two[1]!, blockedBy: [1] },
        ],
      }),
    ).toThrowError(/成环/);
    expect(() =>
      createSplitTodo(deps, {
        ...ctx,
        subtodos: [two[0]!, { ...two[1]!, agentId: 'ghost-agent' }],
      }),
    ).toThrowError(/ghost-agent/);
    createSplitTodo(deps, { ...ctx, subtodos: two });
    expect(() => createSplitTodo(deps, { ...ctx, subtodos: two })).toThrowError(
      /仅适用于未开工任务（当前相位 confirm）/,
    );
    const todoRes = await call(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
      body: { title: '跑起来的卡', spec: 'x' },
    });
    const { id: other } = (await todoRes.json()) as { id: string };
    await call(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
      body: {
        todoIds: [other],
        assignment: { plan: { agentId: implementerId }, build: { agentId: implementerId } },
        withPlan: false,
      },
    });
    expect(() => createSplitTodo(deps, { ...ctx, parentId: other, subtodos: two })).toThrowError(
      /仅适用于未开工/,
    );
  });

  test('failure mode 10: happy path -- child cards / dependency edges / the parent plan doc / the parent stopped at confirm / an announcement row', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    const deps = {
      db: w.s.db,
      hub: w.s.hub,
      machineHub: w.s.machineHub,
      user: w.s.user,
    };
    const result = createSplitTodo(deps, {
      parentId: w.todoId,
      subtodos: [
        { title: '子卡 A', spec: '独立执行 A', agentId: implementerId },
        { title: '子卡 B', spec: '依赖 A', agentId: implementerId, blockedBy: [1] },
      ],
      chiefAgentId: null,
      chiefId: 'chief-test',
      threadId: 'chief-thread-1',
      actorName: 'Chief',
    });
    expect(result.children).toHaveLength(2);
    const parent = w.todoRow();
    expect(parent.phase).toBe('confirm');
    expect(parent.hasPlan).toBe(true);
    expect(parent.latestBuildId).toBe(result.parentBuildId);
    const childA = w.s.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.id, result.children[0]!.id))
      .get()!;
    const childB = w.s.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.id, result.children[1]!.id))
      .get()!;
    expect(childA.sourceTodo).toBe(w.todoId);
    expect(childB.sourceTodo).toBe(w.todoId);
    expect(childA.blockedBy).toBeNull();
    expect(childB.blockedBy).toEqual([childA.id]);
    expect(childA.assignment).toEqual({ plan: null, build: { agentId: implementerId } });
    expect(childA.phase).toBe('todo');
    const plan = w.planContent(result.parentBuildId);
    expect(plan).toContain('拆解方案');
    expect(plan).toContain('子卡 A');
    expect(plan).toContain('依赖：子卡 1');
    expect(plan).toContain('Implementer');
    expect(w.messagesOf(result.parentBuildId).some((m) => m.content === SPLIT_ANNOUNCEMENT)).toBe(
      true,
    );
  });

  test('auto 策略检查器通过后直接派发无阻塞子卡并记录结果', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    w.s.db
      .update(projectTable)
      .set({ splitPolicy: 'auto' })
      .where(eq(projectTable.id, w.projectId))
      .run();
    w.s.db.update(machineTable).set({ online: true }).run();
    const result = createSplitTodo(
      { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub, user: w.s.user },
      {
        parentId: w.todoId,
        subtodos: [
          { title: 'A', spec: 'a', agentId: implementerId },
          { title: 'B', spec: 'b', agentId: implementerId, blockedBy: [1] },
        ],
        chiefAgentId: null,
        chiefId: 'chief-test',
        threadId: 'chief-thread-1',
        actorName: 'Chief',
      },
    );
    dispatchSplitChildren(
      { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub, user: w.s.user },
      w.todoId,
    );
    expect(w.todoRow().phase).toBe('building');
    expect(
      w.s.db.select().from(todoTable).where(eq(todoTable.id, result.children[0]!.id)).get()!.phase,
    ).toBe('queued');
    expect(
      w.messagesOf(result.parentBuildId).some((m) => m.content === '检查器结果：已自动开跑'),
    ).toBe(true);
  });

  test('shadow 策略只记录检查器结果并保留 confirm', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    w.s.db
      .update(projectTable)
      .set({ splitPolicy: 'shadow' })
      .where(eq(projectTable.id, w.projectId))
      .run();
    w.s.db.update(machineTable).set({ online: true }).run();
    const result = createSplitTodo(
      { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub, user: w.s.user },
      {
        parentId: w.todoId,
        subtodos: [
          { title: 'A', spec: 'a', agentId: implementerId },
          { title: 'B', spec: 'b', agentId: implementerId, blockedBy: [1] },
        ],
        chiefAgentId: null,
        chiefId: 'chief-test',
        threadId: 'chief-thread-1',
        actorName: 'Chief',
      },
    );
    expect(w.todoRow().phase).toBe('confirm');
    expect(
      w
        .messagesOf(result.parentBuildId)
        .some((m) => m.content === '检查器结果：若自动会开跑（shadow）'),
    ).toBe(true);
  });

  test('failure mode 11: the parent confirms -> unblocked children dispatched (direct execution) + the parent enters building; blocked children untouched', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    const deps = {
      db: w.s.db,
      hub: w.s.hub,
      machineHub: w.s.machineHub,
      user: w.s.user,
    };
    const result = createSplitTodo(deps, {
      parentId: w.todoId,
      subtodos: [
        { title: 'A', spec: 'a', agentId: implementerId },
        { title: 'B', spec: 'b', agentId: implementerId, blockedBy: [1] },
      ],
      chiefAgentId: null,
      chiefId: 'chief-test',
      threadId: 'chief-thread-1',
      actorName: 'Chief',
    });
    const confirmRes = await call(w.s.app, 'POST', `/api/builds/${result.parentBuildId}/steps`, {
      body: { action: 'confirm' },
    });
    expect(confirmRes.status).toBe(202);
    expect(w.todoRow().phase).toBe('building');
    const childA = w.s.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.id, result.children[0]!.id))
      .get()!;
    const childB = w.s.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.id, result.children[1]!.id))
      .get()!;
    expect(childA.phase).toBe('queued');
    expect(childB.phase).toBe('todo');
    const aBuild = w.s.db.select().from(buildTable).where(eq(buildTable.todoId, childA.id)).get();
    expect(aBuild).toBeDefined();
    expect(w.stepsOf(aBuild!.id).some((r) => r.kind === 'build' && r.status === 'pending')).toBe(
      true,
    );
  });

  test('failure mode 12: a child done -> wave advance (B auto-dispatched) + the parent auto-closed once all are done', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    const deps = {
      db: w.s.db,
      hub: w.s.hub,
      machineHub: w.s.machineHub,
      user: w.s.user,
    };
    const result = createSplitTodo(deps, {
      parentId: w.todoId,
      subtodos: [
        { title: 'A', spec: 'a', agentId: implementerId },
        { title: 'B', spec: 'b', agentId: implementerId, blockedBy: [1] },
      ],
      chiefAgentId: null,
      chiefId: 'chief-test',
      threadId: 'chief-thread-1',
      actorName: 'Chief',
    });
    await call(w.s.app, 'POST', `/api/builds/${result.parentBuildId}/steps`, {
      body: { action: 'confirm' },
    });
    const { setTodoPhase } = await import('../src/services/todos.js');
    const childA = result.children[0]!.id;
    const childB = result.children[1]!.id;
    setTodoPhase(deps, childA, 'building');
    setTodoPhase(deps, childA, 'done');
    expect(w.todoRow().phase).toBe('building');
    advanceSplitWaves(deps, childA);
    expect(w.s.db.select().from(todoTable).where(eq(todoTable.id, childB)).get()!.phase).toBe(
      'queued',
    );
    setTodoPhase(deps, childB, 'building');
    setTodoPhase(deps, childB, 'done');
    expect(w.todoRow().phase).toBe('done');
    expect(w.messagesOf(result.parentBuildId).some((m) => m.content === DONE_ANNOUNCEMENT)).toBe(
      true,
    );
  });

  test('failed child manual done does not start the next wave (#1247)', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    const result = createSplitTodo(
      { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub, user: w.s.user },
      {
        parentId: w.todoId,
        subtodos: [
          { title: 'A', spec: 'a', agentId: implementerId },
          { title: 'B', spec: 'b', agentId: implementerId, blockedBy: [1] },
        ],
        chiefAgentId: null,
        chiefId: 'chief-test',
        threadId: 'chief-thread-1',
        actorName: 'Chief',
      },
    );
    await call(w.s.app, 'POST', `/api/builds/${result.parentBuildId}/steps`, {
      body: { action: 'confirm' },
    });
    const childA = result.children[0]!.id;
    const childB = result.children[1]!.id;
    w.s.db.update(todoTable).set({ phase: 'failed' }).where(eq(todoTable.id, childA)).run();
    const res = await call(w.s.app, 'PATCH', `/api/todos/${childA}`, { body: { phase: 'done' } });
    expect(res.status).toBe(200);
    expect(w.s.db.select().from(todoTable).where(eq(todoTable.id, childA)).get()!.phase).toBe(
      'done',
    );
    expect(w.s.db.select().from(todoTable).where(eq(todoTable.id, childB)).get()!.phase).toBe(
      'todo',
    );
    expect(
      w.s.db.select().from(buildTable).where(eq(buildTable.todoId, childB)).all(),
    ).toHaveLength(0);
    expect(w.todoRow().phase).toBe('building');
  });

  test('failed child manual done still closes the parent when every sibling is done (#1247)', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    const result = createSplitTodo(
      { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub, user: w.s.user },
      {
        parentId: w.todoId,
        subtodos: [
          { title: 'A', spec: 'a', agentId: implementerId },
          { title: 'B', spec: 'b', agentId: implementerId, blockedBy: [1] },
        ],
        chiefAgentId: null,
        chiefId: 'chief-test',
        threadId: 'chief-thread-1',
        actorName: 'Chief',
      },
    );
    await call(w.s.app, 'POST', `/api/builds/${result.parentBuildId}/steps`, {
      body: { action: 'confirm' },
    });
    const childA = result.children[0]!.id;
    const childB = result.children[1]!.id;
    w.s.db.update(todoTable).set({ phase: 'done' }).where(eq(todoTable.id, childB)).run();
    w.s.db.update(todoTable).set({ phase: 'failed' }).where(eq(todoTable.id, childA)).run();
    const res = await call(w.s.app, 'PATCH', `/api/todos/${childA}`, { body: { phase: 'done' } });
    expect(res.status).toBe(200);
    expect(w.todoRow().phase).toBe('done');
  });

  test('review child manual done still starts the next wave (#1247)', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    const result = createSplitTodo(
      { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub, user: w.s.user },
      {
        parentId: w.todoId,
        subtodos: [
          { title: 'A', spec: 'a', agentId: implementerId },
          { title: 'B', spec: 'b', agentId: implementerId, blockedBy: [1] },
        ],
        chiefAgentId: null,
        chiefId: 'chief-test',
        threadId: 'chief-thread-1',
        actorName: 'Chief',
      },
    );
    await call(w.s.app, 'POST', `/api/builds/${result.parentBuildId}/steps`, {
      body: { action: 'confirm' },
    });
    const childA = result.children[0]!.id;
    const childB = result.children[1]!.id;
    w.s.db.update(todoTable).set({ phase: 'review' }).where(eq(todoTable.id, childA)).run();
    const res = await call(w.s.app, 'PATCH', `/api/todos/${childA}`, { body: { phase: 'done' } });
    expect(res.status).toBe(200);
    expect(w.s.db.select().from(todoTable).where(eq(todoTable.id, childB)).get()!.phase).toBe(
      'queued',
    );
  });

  test('manual done stops the pending step (#1247, #1451)', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    const buildId = await w.startBuild({ plan: null, build: { agentId: implementerId } });
    const res = await call(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { body: { phase: 'done' } });
    expect(res.status).toBe(200);
    expect(w.todoRow().phase).toBe('done');
    const build = w.stepsOf(buildId).filter((s) => s.kind === 'build');
    expect(build.map((s) => s.status)).toEqual(['stopped']);
  });
});

describe('#1259 the persona attribution machine (seeding x bound-model bridging)', () => {
  test('no machine seeding -> null; seeding with mea present -> bound to mea; backfill never overwrites a user rebinding', async () => {
    const s = bootServer({});
    ensurePersonasSeeded(s.db, s.team.id);
    const homeless = s.db.select().from(agentTable).where(eq(agentTable.persona, 'planner')).get()!;
    expect(homeless.machineId).toBeNull();
    const otherMachine = insertMachine(s, { name: 'user-mac' });
    s.db
      .update(agentTable)
      .set({ machineId: otherMachine })
      .where(eq(agentTable.id, homeless.id))
      .run();
    const meaMachine = insertMachine(s, { name: 'mea-wsl' });
    ensurePersonasSeeded(s.db, s.team.id);
    const planner = s.db.select().from(agentTable).where(eq(agentTable.persona, 'planner')).get()!;
    expect(planner.machineId).toBe(otherMachine);
    const implementer = s.db
      .select()
      .from(agentTable)
      .where(eq(agentTable.persona, 'implementer'))
      .get()!;
    expect(implementer.machineId).toBe(meaMachine);
  });
});

describe('#1492 the verify step issues verdicts by checklist', () => {
  test('the plan carries Verification -> confirm -> the verify material lists the checklist; missing evidence -> passed=false naming it', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    const verifierId = personaAgentId(w.s, 'verifier');
    const buildId = await w.startBuild(
      {
        plan: { agentId: implementerId },
        build: { agentId: implementerId },
        verify: { agentId: verifierId },
      },
      true,
    );
    const planClaimed = await w.claim();
    expect(planClaimed.kind).toBe('plan');
    w.s.db
      .insert(planTable)
      .values({
        id: 'plan-1492',
        buildId,
        version: 1,
        content:
          '## Context\n探针\n\n## Verification\n- `pnpm lint` 通过\n- apps/server/test/x.test.ts 全绿\n',
        stepId: planClaimed.stepId,
        createdAt: Date.now(),
      })
      .run();
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');
    const confirm = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'confirm' },
    });
    expect(confirm.status).toBe(202);
    const buildClaimed = await w.claim();
    expect(buildClaimed.kind).toBe('build');
    await w.done(buildClaimed.stepId, { status: 'success', hasChanges: true });
    expect(w.todoRow().phase).toBe('review');
    const verifyStep = w.stepsOf(buildId).find((r) => r.kind === 'verify')!;
    expect(verifyStep.prompt).toContain('## 验证清单');
    expect(verifyStep.prompt).toContain('1. `pnpm lint` 通过');
    expect(verifyStep.prompt).toContain('2. apps/server/test/x.test.ts 全绿');
    const verifyClaimed = await w.claim();
    expect(verifyClaimed.kind).toBe('verify');
    await w.done(verifyClaimed.stepId, {
      status: 'success',
      verifyVerdict: {
        passed: true,
        conclusion: 'lint 过了',
        evidence: [{ path: 'docs/verify/1492/lint.txt', item: 1 }],
      },
    });
    const verdictMsg = w
      .messagesOf(buildId)
      .map((m) => m.content)
      .find((c) => typeof c === 'string' && c.includes(VERIFY_VERDICT_KIND));
    const parsed = verifyVerdictSchema.parse(JSON.parse(verdictMsg as string).verdict);
    expect(parsed.passed).toBe(false);
    expect(parsed.conclusion).toContain('清单第 2 项无证据');
    expect(parsed.evidence[0]?.item).toBe(1);
  });
});
