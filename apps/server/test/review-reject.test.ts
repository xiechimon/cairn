// #701 (B-C12): review 关口人肉打回——review→planning 边的第二触发器。
// 边已在流转表里（#330 blocking verdict 自动回流在用），本票把「人在审核
// 关口请求修改」接到同一条边上：形状 = confirm 关口驳回（r5 §4）复用到
// review 相位，走服务端动作面（POST /builds/{id}/steps revision），不挂
// 「活跃会话」前提（review 静息态 steer 消息面 409，票面失败方式 1）。
//
// 钉住的四条失败方式（票面原文序）：
//  1. 无会话时消息通道 409 → 打回走动作面照常工作（本文件 test 1/2）；
//  2. 输入框可填不可发 → web 面，归 apps/web/e2e/review-reject.spec.ts；
//  3. 打回后产物孤儿化 → 不删 plan/消息/步、不换 build（test 3）；
//  4. 相位机被旁路 → confirm/review 之外一律 409 且不落任何行（test 4/5）。

import {
  buildRecordSchema,
  buildReplanPrompt,
  buildReviewRejectPrompt,
  conversationMessagesResponseSchema,
  todoRecordSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { plan as planTable, step as stepTable } from '../src/db/schema.js';
import { completeStep } from '../src/services/builds.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

interface StepRow {
  id: string;
  kind: string;
  status: string;
}

/** 把一个新 todo 驱到 review 静息态（主时序全链的前半，wire.test 同款驱动：
 *  queued→planning→(plan 产物)→confirm→confirm 动作→building→(build 步成)→
 *  review；无 claimed 步 = 静息）。 */
async function worldInReview(): Promise<{
  s: TestServer;
  todoId: string;
  buildId: string;
  stepsOf: () => Promise<StepRow[]>;
  phaseOf: () => Promise<string>;
  messagesOf: () => Promise<{ role: string; content: unknown }[]>;
}> {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const todoDoc = todoRecordSchema.parse(
    await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'gate', spec: 'body' })
    ).json(),
  );
  const started = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todoDoc.id],
    assignment: { plan: null, build: null },
    withPlan: true,
  });
  const b = buildRecordSchema.parse(((await started.json()) as { builds: unknown[] }).builds[0]);
  const stepsOf = async () =>
    ((await (await req(s.app, 'GET', `/api/builds/${b.id}/steps`)).json()) as unknown[]).map(
      (r) => r as StepRow,
    );
  const phaseOf = async () =>
    todoRecordSchema.parse(await (await req(s.app, 'GET', `/api/todos/${todoDoc.id}`)).json())
      .phase;
  const messagesOf = async () =>
    conversationMessagesResponseSchema
      .parse(await (await req(s.app, 'GET', `/api/conversations/${b.id}/messages`)).json())
      .messages.map((m) => ({ role: m.role, content: m.content }));

  // 机器领规划步等价直驱（claim/journal 面归 M3；wire.test 同口径）。
  setTodoPhase(s.svc, todoDoc.id, 'planning');
  s.db
    .insert(planTable)
    .values({ id: 'plan-rj-1', buildId: b.id, version: 1, content: '# 方案 v1', createdAt: 1 })
    .run();
  completeStep(s.svc, (await stepsOf())[0]!.id); // plan 步成 → confirm
  await req(s.app, 'POST', `/api/builds/${b.id}/steps`, { action: 'confirm' });
  const steps = await stepsOf();
  completeStep(s.svc, steps[steps.length - 1]!.id); // build 步成 → review
  return { s, todoId: todoDoc.id, buildId: b.id, stepsOf, phaseOf, messagesOf };
}

const REJECT_BODY = {
  action: 'revision',
  side: 'plan',
  feedback: '关闭按钮挪到左边，文案改成「返回」',
  clientMessageId: '3f9a0c2e-0000-4000-8000-000000000701',
} as const;

describe('#701 review 关口人肉打回（revision 动作面复用 review→planning 边）', () => {
  test('FM1：静息 review（steer 面 409 无会话）打回照常——202 → planning + 重规划步入队（review 模板 prompt）+ feedback 行落时间线', async () => {
    const w = await worldInReview();
    try {
      expect(await w.phaseOf()).toBe('review');
      // 失败方式 1 的现状半边：消息面在静息 review 恒 409（无 claimed 步）。
      const steer = await req(w.s.app, 'POST', `/api/conversations/${w.buildId}/messages`, {
        content: REJECT_BODY.feedback,
      });
      expect(steer.status).toBe(409);
      // 动作面不挂会话前提：同一客户端状态，revision 直接受理。
      const res = await req(w.s.app, 'POST', `/api/builds/${w.buildId}/steps`, REJECT_BODY);
      expect(res.status).toBe(202);
      expect(await w.phaseOf()).toBe('planning');
      // 重规划步入队（pending，同 build 同 conv continue session 语义归 M3）。
      const steps = await w.stepsOf();
      const last = steps[steps.length - 1]!;
      expect(last.kind).toBe('plan');
      expect(last.status).toBe('pending');
      // prompt = review 关口打回模板（与 confirm 驳回模板分词——审核关口的
      // 事实是「改动已产出」，shared buildReviewRejectPrompt 单源）。
      const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, last.id)).get();
      expect(row?.prompt).toBe(buildReviewRejectPrompt(REJECT_BODY.feedback));
      // 用户 feedback 行进时间线（role user，r5 §4 呈现律）。
      const msgs = await w.messagesOf();
      expect(msgs).toContainEqual({ role: 'user', content: REJECT_BODY.feedback });
    } finally {
      w.s.dispose();
    }
  });

  test('FM1 对照：steer 409 不落任何行——打回动作面是唯一入口，消息面死路保持死路', async () => {
    const w = await worldInReview();
    try {
      const before = await w.messagesOf();
      const steer = await req(w.s.app, 'POST', `/api/conversations/${w.buildId}/messages`, {
        content: '这句话不该落库',
      });
      expect(steer.status).toBe(409);
      expect(await w.messagesOf()).toEqual(before);
      expect(await w.phaseOf()).toBe('review');
    } finally {
      w.s.dispose();
    }
  });

  test('FM3：打回不删产物、不孤儿化——plan/消息/步全保留，latestBuildId 不换 build', async () => {
    const w = await worldInReview();
    try {
      const stepsBefore = await w.stepsOf();
      const res = await req(w.s.app, 'POST', `/api/builds/${w.buildId}/steps`, REJECT_BODY);
      expect(res.status).toBe(202);
      // plan v1 仍在读面（打回 ≠ 丢方案）。
      const plans = (await (
        await req(w.s.app, 'GET', `/api/builds/${w.buildId}/plans`)
      ).json()) as { version: number; content: string }[];
      expect(plans.some((p) => p.version === 1 && p.content === '# 方案 v1')).toBe(true);
      // 既有步全保留（打回是追加回流步，不是清历史）。
      const stepsAfter = await w.stepsOf();
      expect(stepsAfter.slice(0, stepsBefore.length)).toEqual(stepsBefore);
      expect(stepsAfter).toHaveLength(stepsBefore.length + 1);
      // 同一个 build：latestBuildId 不漂移（分支 = conversationBranch(buildId)，
      // 换 build 才会孤儿化分支）。
      const t = todoRecordSchema.parse(
        await (await req(w.s.app, 'GET', `/api/todos/${w.todoId}`)).json(),
      );
      expect(t.latestBuildId).toBe(w.buildId);
      const b = buildRecordSchema.parse(
        await (await req(w.s.app, 'GET', `/api/builds/${w.buildId}`)).json(),
      );
      expect(b.todoId).toBe(w.todoId);
    } finally {
      w.s.dispose();
    }
  });

  test('FM4：planning 相位 revision → 409 且不落 feedback 行（门在 confirm/review 两关口；planning 补话走 steer 面）', async () => {
    const w = await worldInReview();
    try {
      // review→planning 是合法边（#330 回流同边），直驱造出「重规划在途」态。
      setTodoPhase(w.s.svc, w.todoId, 'planning');
      expect(await w.phaseOf()).toBe('planning');
      // 无显式门时此发会 202：setTodoPhase 同相位幂等 no-op 吞掉断言，
      // feedback 行落库 + 第二个 plan 步叠进队列——门必须先于一切写面。
      const res = await req(w.s.app, 'POST', `/api/builds/${w.buildId}/steps`, REJECT_BODY);
      expect(res.status).toBe(409);
      const msgs = await w.messagesOf();
      expect(msgs.filter((m) => m.content === REJECT_BODY.feedback)).toHaveLength(0);
      const steps = await w.stepsOf();
      expect(steps.filter((st) => st.kind === 'plan' && st.status === 'pending')).toHaveLength(0);
    } finally {
      w.s.dispose();
    }
  });

  test('FM4：planning/building/done/queued 各相位 revision → 409 {error} 形状', async () => {
    const w = await worldInReview();
    try {
      // review → done（merge 链）后打回必须被拒（done→planning 无边）。
      const merge = await req(w.s.app, 'POST', `/api/builds/${w.buildId}/merge`);
      expect(merge.status).toBe(202);
      const steps = await w.stepsOf();
      completeStep(w.s.svc, steps[steps.length - 1]!.id); // merge 步成 → done
      expect(await w.phaseOf()).toBe('done');
      const res = await req(w.s.app, 'POST', `/api/builds/${w.buildId}/steps`, REJECT_BODY);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toBeTruthy();
      expect(await w.phaseOf()).toBe('done');
      const msgs = await w.messagesOf();
      expect(msgs.filter((m) => m.content === REJECT_BODY.feedback)).toHaveLength(0);
    } finally {
      w.s.dispose();
    }
  });

  test('回归：confirm 关口驳回语义不变——同动作同 body，prompt 仍是 buildReplanPrompt', async () => {
    const s = bootServer();
    try {
      const projectId = await postProject(s.app);
      const todoDoc = todoRecordSchema.parse(
        await (
          await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
            title: 'confirm-gate',
            spec: '',
          })
        ).json(),
      );
      const started = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
        todoIds: [todoDoc.id],
        assignment: { plan: null, build: null },
        withPlan: true,
      });
      const b = buildRecordSchema.parse(
        ((await started.json()) as { builds: unknown[] }).builds[0],
      );
      const stepsOf = async () =>
        ((await (await req(s.app, 'GET', `/api/builds/${b.id}/steps`)).json()) as unknown[]).map(
          (r) => r as StepRow,
        );
      setTodoPhase(s.svc, todoDoc.id, 'planning');
      s.db
        .insert(planTable)
        .values({ id: 'plan-rj-2', buildId: b.id, version: 1, content: '# v1', createdAt: 1 })
        .run();
      completeStep(s.svc, (await stepsOf())[0]!.id); // → confirm
      const res = await req(s.app, 'POST', `/api/builds/${b.id}/steps`, REJECT_BODY);
      expect(res.status).toBe(202);
      const steps = await stepsOf();
      const last = steps[steps.length - 1]!;
      expect(last.kind).toBe('plan');
      const row = s.db.select().from(stepTable).where(eq(stepTable.id, last.id)).get();
      expect(row?.prompt).toBe(buildReplanPrompt(REJECT_BODY.feedback));
    } finally {
      s.dispose();
    }
  });
});
