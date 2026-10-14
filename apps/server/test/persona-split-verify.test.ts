// #1250 / ADR 0018 层 1+2 服务面测试：persona seeding、verify 步（入队/
// 收尾）、review fan-out 三视角、chief split_todo（拆卡/依赖边/波次/自动收口）。
// 失败方式枚举先于验收固化（AGENTS.md 测试规则 3）——每条 test 标题即失败
// 方式。全程 bootServer 走真 REST + machine 端点（claim/done 语义与产线同缝，
// 不 mock 服务内部）。

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
} from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  message as messageTable,
  plan as planTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { advanceSplitWaves, maybeEnqueueVerifyStep } from '../src/services/builds.js';
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

/** 世界装置：机器 enrolled + persona 已播种 + 任务建好。 */
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
  // 模型真值先行（provider 行 = seed 面的模型清单；claim 闸要求 modelId 非空，
  // persona seeding 的可领值从这取）。
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
  // persona 六员播种（被测服务本体——不走 index.ts 启动位；此刻模型清单
  // 已有值 → 落库即带可领 provider/modelId）。
  ensurePersonasSeeded(s.db, s.team.id);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'split-mbp', cliVersion: '0.1.0' },
  });
  expect(enrollRes.status).toBe(200);
  const { token: machineToken } = (await enrollRes.json()) as { token: string };
  // #1259：认领机 = 全部 agent 的归属机（persona 播种在 enroll 前、彼时无
  // 机器可绑——补值路径的机器侧真值归 personas.test；本文件钉派发行为）。
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
    // wire 形 = {step: {step: {...}, agent, session}} 双层包装（claimedStepSchema
    // 单源解析，review.test 同款）。
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

/** persona agent id 查找（世界内）。 */
function personaAgentId(s: TestServer, role: PersonaRole): string {
  return (
    s.db.select({ id: agentTable.id }).from(agentTable).where(eq(agentTable.persona, role)).get()
      ?.id ?? ''
  );
}

describe('#1250 persona seeding', () => {
  test('失败方式 1：六员落库、persona 位/档位/契约全文各就各位；模型取当时清单可领值', () => {
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
      // claim 闸要求的可领二元组（无模型位 = 永远 pending 的死步）。
      expect(row!.provider, role).toBe('stub-gw');
      expect(row!.modelId, role).toBe('stub-model');
    }
    expect(byRole.get('planner')!.thinkingLevel).toBe('xhigh');
    expect(byRole.get('implementer')!.thinkingLevel).toBe('high');
    expect(byRole.get('code_reviewer')!.thinkingLevel).toBe('medium');
    expect(byRole.get('verifier')!.thinkingLevel).toBe('medium');
  });

  test('失败方式 2：幂等 = 补缺不覆盖（二次零插入、编辑保留、null 模型启动补值、删行复活）', () => {
    const s = bootServer({});
    // 先seed（无 provider → 模型 null）；后配 provider 再补齐 → null 被填。
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
    // 用户编辑保留（模型非 null 不覆盖；description 永不动）。
    s.db
      .update(agentTable)
      .set({ description: '自定义职责', modelId: 'glm-5.3' })
      .where(eq(agentTable.persona, 'planner'))
      .run();
    ensurePersonasSeeded(s.db, s.team.id);
    const edited = s.db.select().from(agentTable).where(eq(agentTable.persona, 'planner')).get()!;
    expect(edited.description).toBe('自定义职责');
    expect(edited.modelId).toBe('glm-5.3');
    // 删行复活（seedFixedTags 同语义；永久摘角 = PATCH persona null，不删行）。
    s.db.delete(agentTable).where(eq(agentTable.persona, 'verifier')).run();
    expect(ensurePersonasSeeded(s.db, s.team.id)).toBe(1);
  });
});

describe('#1250 verify 步（层 1）', () => {
  test('失败方式 3：review 关口抵达且 verify 槽在位 → verify 步入队 + 宣告行；槽空零动作', async () => {
    const w = await setupWorld();
    const verifierId = personaAgentId(w.s, 'verifier');
    const buildId = await w.startBuild({
      plan: { agentId: personaAgentId(w.s, 'implementer') },
      build: { agentId: personaAgentId(w.s, 'implementer') },
      verify: { agentId: verifierId },
    });
    const claimed = await w.claim(); // build 步
    expect(claimed.kind).toBe('build');
    await w.done(claimed.stepId, { status: 'success', hasChanges: true });
    // review 相位 + verify 步已入队（build 相抵达 = review 关口）。
    expect(w.todoRow().phase).toBe('review');
    const verifySteps = w.stepsOf(buildId).filter((r) => r.kind === 'verify');
    expect(verifySteps).toHaveLength(1);
    expect(verifySteps[0]!.status).toBe('pending');
    expect(verifySteps[0]!.prompt).toContain('docs/verify/');
    expect(w.messagesOf(buildId).some((m) => m.content === VERIFY_ANNOUNCEMENT)).toBe(true);
    // 槽空（另一任务）：零 verify 步——回归红线（存量行为不变）。
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

  test('失败方式 4：verify 步收尾 → VERIFY_VERDICT 消息落地、phase 不动、agent 走 verify 槽', async () => {
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
    // claim 载荷 agent = verify 槽 persona（agentIdForStep 单源解析）。
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
    // 额外 agent 步不推进主时序：仍停 review 关口。
    expect(w.todoRow().phase).toBe('review');
  });

  test('失败方式 5：verify 槽空 → 无主步失败文案点名 verify 槽（agentForStep null 的补法）', async () => {
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
    // 槽在位 → 指到 persona agent（review fan-out 的解析同源）。
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

describe('#1250 review fan-out 三视角', () => {
  test('失败方式 6：agentId 缺省 → 三条 review 步各挂 persona agent（meta header）+ 单条宣告行', async () => {
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
    // 各视角 prompt 带视角重点文案。
    expect(reviewSteps.some((r) => r.prompt!.includes('五轴 review'))).toBe(true);
    expect(reviewSteps.some((r) => r.prompt!.includes('安全审计'))).toBe(true);
    expect(reviewSteps.some((r) => r.prompt!.includes('测试覆盖缺口'))).toBe(true);
    // 宣告行单条（不是三条）。
    expect(w.messagesOf(buildId).filter((m) => m.content === REVIEW_ANNOUNCEMENT).length).toBe(1);
  });

  test('失败方式 7：persona 删净 + review 槽在位 → 回落单步；两者皆缺 → 400', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    const buildId = await w.startBuild({
      plan: { agentId: implementerId },
      build: { agentId: implementerId },
    });
    const claimed = await w.claim();
    await w.done(claimed.stepId, { status: 'success', hasChanges: true });
    // 删净三视角 persona。
    w.s.db.delete(agentTable).where(eq(agentTable.persona, 'code_reviewer')).run();
    w.s.db.delete(agentTable).where(eq(agentTable.persona, 'security_auditor')).run();
    w.s.db.delete(agentTable).where(eq(agentTable.persona, 'test_engineer')).run();
    const res = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'review' },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('assignment.review');
    // review 槽在位 → 回落单步。
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

  test('失败方式 8：fan-out 两份 blocking verdict → 只入队一条修订步（去重闸）', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    const buildId = await w.startBuild({
      plan: { agentId: implementerId },
      build: { agentId: implementerId },
    });
    // withPlan=false 直接 build → review 关口。
    const claimed = await w.claim();
    await w.done(claimed.stepId, { status: 'success', hasChanges: true });
    await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'review' },
    });
    // 依次收尾两条 review 步（claim → done——done 面要求步已被本机认领），
    // 各带 blocking。
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

describe('#1250 split_todo（层 2）', () => {
  test('失败方式 9：校验族——相位非 todo 409 / 双拆 409 / 少于两张 400 / 索引越界 400 / 环 400 / agent 越队 404', async () => {
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
    // 少于两张。
    expect(() => createSplitTodo(deps, { ...ctx, subtodos: [two[0]!] })).toThrowError(/至少两张/);
    // 索引越界。
    expect(() =>
      createSplitTodo(deps, {
        ...ctx,
        subtodos: [two[0]!, { ...two[1]!, blockedBy: [5] }],
      }),
    ).toThrowError(/越界/);
    // 自指。
    expect(() =>
      createSplitTodo(deps, {
        ...ctx,
        subtodos: [two[0]!, { ...two[1]!, blockedBy: [2] }],
      }),
    ).toThrowError(/自指/);
    // 环。
    expect(() =>
      createSplitTodo(deps, {
        ...ctx,
        subtodos: [
          { ...two[0]!, blockedBy: [2] },
          { ...two[1]!, blockedBy: [1] },
        ],
      }),
    ).toThrowError(/成环/);
    // agent 越队（不存在）。
    expect(() =>
      createSplitTodo(deps, {
        ...ctx,
        subtodos: [two[0]!, { ...two[1]!, agentId: 'ghost-agent' }],
      }),
    ).toThrowError(/ghost-agent/);
    // happy path 落库后：再拆 = 相位闸先行（拆过的父停在 confirm，永不再
    // 是 todo——「已拆解」守卫只对 reset 回 todo 的父兜底，见下）。
    createSplitTodo(deps, { ...ctx, subtodos: two });
    expect(() => createSplitTodo(deps, { ...ctx, subtodos: two })).toThrowError(
      /仅适用于未开工任务（当前相位 confirm）/,
    );
    // 另一任务相位非 todo（建 build 推进相位）。
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

  test('失败方式 10：happy path——子卡/依赖边/父方案文档/父停 confirm/宣告行', async () => {
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
    // 子卡：sourceTodo / blockedBy / assignment.build / todo 相位。
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
    // 方案文档：子卡清单 + 依赖 + agent 名。
    const plan = w.planContent(result.parentBuildId);
    expect(plan).toContain('拆解方案');
    expect(plan).toContain('子卡 A');
    expect(plan).toContain('依赖：子卡 1');
    expect(plan).toContain('Implementer');
    // 宣告行（父会话）。
    expect(w.messagesOf(result.parentBuildId).some((m) => m.content === SPLIT_ANNOUNCEMENT)).toBe(
      true,
    );
  });

  test('失败方式 11：父 confirm → 派发无阻塞子卡（直执行）+ 父进 building；阻塞子卡不动', async () => {
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
    // 父伞进 building；A 派发（queued + build 步入队）；B 仍 todo 等波次。
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

  test('失败方式 12：子卡 done → 波次推进（B 自动派发）+ 全 done 父自动收', async () => {
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
    // A 走系统漏斗落 done（claim 语义的相位前置 + #1250 新边 building→done——
    // completeStep/transitionTodos 的同一挂接面）。
    setTodoPhase(deps, childA, 'building');
    setTodoPhase(deps, childA, 'done');
    // settle（父收口半边）：B 未 done → 父不动。
    expect(w.todoRow().phase).toBe('building');
    // advance（波次半边）：B 解锁自动派发。
    advanceSplitWaves(deps, childA);
    expect(w.s.db.select().from(todoTable).where(eq(todoTable.id, childB)).get()!.phase).toBe(
      'queued',
    );
    // B 也 done → 父自动收 + 父会话 DONE_ANNOUNCEMENT（actor = Chief）。
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
    expect(w.s.db.select().from(buildTable).where(eq(buildTable.todoId, childB)).all()).toHaveLength(
      0,
    );
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

  test('manual done leaves the pending step running (#1247)', async () => {
    const w = await setupWorld();
    const implementerId = personaAgentId(w.s, 'implementer');
    const buildId = await w.startBuild({ plan: null, build: { agentId: implementerId } });
    const res = await call(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { body: { phase: 'done' } });
    expect(res.status).toBe(200);
    expect(w.todoRow().phase).toBe('done');
    expect(w.stepsOf(buildId).some((s) => s.kind === 'build' && s.status === 'pending')).toBe(true);
  });
});

describe('#1259 persona 归属机（seeding × 绑定模型桥接）', () => {
  // 失败方式（先于实现固化）：
  // 1. 团队无机器时播种 → persona 行 machineId null（不编造机器）。
  // 2. mea 机在场时播种 → machineId = 该机（与迁移回填同口径）。
  // 3. 补值半边：先 null 后有机 → 再播种填上；用户换绑过的值（非 null）不碰。
  test('无机器播种 → null；mea 在场播种 → 绑 mea；补值不覆盖用户换绑', async () => {
    const s = bootServer({});
    // 无机器播种 → null。
    ensurePersonasSeeded(s.db, s.team.id);
    const homeless = s.db.select().from(agentTable).where(eq(agentTable.persona, 'planner')).get()!;
    expect(homeless.machineId).toBeNull();
    // 换绑标记：把 planner 钉到一台「非 mea」机器（模拟用户换绑过）。
    const otherMachine = insertMachine(s, { name: 'user-mac' });
    s.db
      .update(agentTable)
      .set({ machineId: otherMachine })
      .where(eq(agentTable.id, homeless.id))
      .run();
    // mea 机接入 → 再播种：planner 是用户值（不动），其余 null 行补到 mea。
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
