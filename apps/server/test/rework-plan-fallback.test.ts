// #1204 返工回路两修（server 面）：
//  A（缺陷一）：返工回 plan 步时 assignment.plan 为空 → 回落 build 槽 agent
//    接管，不再 failed。票面实锤（卡 #25）：assignment {plan:null, build:{…}}
//    在 review 收「请求修改」→ 重规划步无人可领 → todo failed 终态，恢复只能
//    整卡重跑。
//  B（缺陷二）：continue 意图的返工步 claim 载荷携带降级上下文 reworkContext
//    （最新方案全文 + 会话内真实用户行）——daemon 续接失败回退新会话时注入
//    （daemon 侧收尾见 apps/daemon/test/runner-rework-context.test.ts）。
// 失败方式（先于实现固化，仓测试纪律）：
//  A1. plan 槽空（build 槽在）+ review 收请求修改 → 重规划步由 build agent
//      认领，不再 failed（回落生效）。
//  A2. 两槽皆空的返工步 → 仍失败收尾（回落已试，文案点名两槽）。
//  A3. 首轮规划步（无 prompt）plan 槽空 → 仍按 #1104 B 失败收尾——回落只作用
//      于带续轮指令的返工步，首跑语义是回归红线（chief 400 自纠回路不摘）。
//  A4. plan 槽在位的返工步 → plan agent 认领（现状行为不变，卡 #24 形）。
//  B1. continue 步的 claim 载荷含 reworkContext：planText = 最新版方案全文；
//      feedbacks = 真实用户行（合成模板行与关卡宣告行滤除）。
//  B2. 首轮步（session new）不携带 reworkContext（空手不增重）。

import type { ClaimedStep } from '@pacman/shared';
import { claimedStepSchema } from '@pacman/shared';
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
import { bootServer, issueApiKey, postProject, req, type TestServer } from './helpers.js';

const AGENT_PLAN = 'agent-rw-plan';
const AGENT_BUILD = 'agent-rw-build';

const servers: TestServer[] = [];
afterAll(() => {
  for (const s of servers) s.dispose();
});

/** machine wire 面裸请求（helpers.req 不带鉴权头，unassigned-build 同律）。 */
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

/** 新 todo → 首跑全链（plan 步成 → confirm → build 步成）→ review 静息态。
 *  assignment 由入参钉（A 组的落差全在 plan 槽）；首跑步用 completeStep 直驱
 *  （claim 面归 A 组断言，wire.test 同口径）。 */
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
  completeStep(w.s.svc, (await stepsOf())[0]!.id); // plan 步成 → confirm
  await req(w.s.app, 'POST', `/api/builds/${buildId}/steps`, { action: 'confirm' });
  const steps = await stepsOf();
  const buildStep = steps[steps.length - 1]!;
  // 降级注入面的前置：prior session 在位（B1 的 continue 判定吃 step.sessionId）。
  w.s.db
    .update(stepTable)
    .set({ sessionId: 'sess-first-build' })
    .where(eq(stepTable.id, buildStep.id))
    .run();
  completeStep(w.s.svc, buildStep.id); // build 步成 → review
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

describe('#1204 A：返工回 plan 步的槽位回落（agentForStep）', () => {
  test('A1：plan 槽空（build 槽在）+ review 请求修改 → build agent 认领重规划步，不再 failed', async () => {
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
    // 回落判据：认领者 = build 槽 agent（plan 槽空，无人可从 plan 槽解出）。
    expect(claimed?.agent?.id).toBe(AGENT_BUILD);
    // 步被认领而非失败收尾（票面原文：改前 todo failed 终态）。
    const stepRow = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, claimed!.step.id))
      .get()!;
    expect(stepRow.status).toBe('claimed');
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, rw.todoId)).get()!;
    expect(todoRow.phase).toBe('planning');
  });

  test('A2：两槽皆空的返工步 → 仍失败收尾，文案点名两槽', async () => {
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
    // 回落已试、两槽皆空：根因文案点名两槽（#1104 B 漏斗的 build.errorMessage）。
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, rw.buildId)).get()!;
    expect(buildRow.errorMessage).toContain('plan 槽与 build 槽均为空');
  });

  test('A3（回归红线）：首轮规划步（无 prompt）plan 槽空 → 仍按 #1104 B 失败收尾', async () => {
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

  test('A4（回归）：plan 槽在位的返工步 → plan agent 认领（现状不变）', async () => {
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

describe('#1204 B：返工降级上下文（claim 载荷 reworkContext）', () => {
  test('B1：continue 返工步携带 reworkContext（方案全文 + 真实用户行；宣告/合成行滤除）', async () => {
    const w = await setupWorld();
    const rw = await worldInReview(w, {
      plan: null,
      build: { agentId: AGENT_BUILD },
    });
    await rejectInReview(rw);

    const claimed = await claim(w);
    expect(claimed?.step.kind).toBe('plan');
    // continue 步（prior session 在位）→ 载荷带降级上下文。
    expect(claimed?.session.action).toBe('continue');
    // planText = 最新版方案全文。
    expect(claimed?.reworkContext?.planText).toBe('# 方案 v1');
    // feedbacks = 真实用户行；confirm 关卡宣告（「通过了确认」）与合成模板行
    // （CONTINUE_PROMPTS）不进意见清单。
    expect(claimed?.reworkContext?.feedbacks).toEqual([REJECT_BODY.feedback]);
  });

  test('B2：首轮步（session new）不携带 reworkContext', async () => {
    const w = await setupWorld();
    const todoRes = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
      title: 'fresh probe',
      spec: 'body',
    });
    const todoId = ((await todoRes.json()) as { id: string }).id;
    await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
      todoIds: [todoId],
      assignment: { plan: { agentId: AGENT_PLAN }, build: { agentId: AGENT_BUILD } },
      withPlan: true,
    });

    const claimed = await claim(w);
    expect(claimed?.step.kind).toBe('plan');
    expect(claimed?.session.action).toBe('new');
    expect(claimed?.reworkContext).toBeUndefined();
  });
});
