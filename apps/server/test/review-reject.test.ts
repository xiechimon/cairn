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

  setTodoPhase(s.svc, todoDoc.id, 'planning');
  s.db
    .insert(planTable)
    .values({ id: 'plan-rj-1', buildId: b.id, version: 1, content: '# 方案 v1', createdAt: 1 })
    .run();
  completeStep(s.svc, (await stepsOf())[0]!.id);
  await req(s.app, 'POST', `/api/builds/${b.id}/steps`, { action: 'confirm' });
  const steps = await stepsOf();
  completeStep(s.svc, steps[steps.length - 1]!.id);
  return { s, todoId: todoDoc.id, buildId: b.id, stepsOf, phaseOf, messagesOf };
}

const REJECT_BODY = {
  action: 'revision',
  side: 'plan',
  feedback: '关闭按钮挪到左边，文案改成「返回」',
  clientMessageId: '3f9a0c2e-0000-4000-8000-000000000701',
} as const;

describe('#701 human rejection at the review gate (the revision action surface reuses the review->planning edge)', () => {
  test('FM1: rejecting from a resting review (steer surface 409, no session) still works -- 202 -> planning + a replan step queued (review template prompt) + a feedback row on the timeline', async () => {
    const w = await worldInReview();
    try {
      expect(await w.phaseOf()).toBe('review');
      const steer = await req(w.s.app, 'POST', `/api/conversations/${w.buildId}/messages`, {
        content: REJECT_BODY.feedback,
      });
      expect(steer.status).toBe(409);
      const res = await req(w.s.app, 'POST', `/api/builds/${w.buildId}/steps`, REJECT_BODY);
      expect(res.status).toBe(202);
      expect(await w.phaseOf()).toBe('planning');
      const steps = await w.stepsOf();
      const last = steps[steps.length - 1]!;
      expect(last.kind).toBe('plan');
      expect(last.status).toBe('pending');
      const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, last.id)).get();
      expect(row?.prompt).toBe(buildReviewRejectPrompt(REJECT_BODY.feedback));
      const msgs = await w.messagesOf();
      expect(msgs).toContainEqual({ role: 'user', content: REJECT_BODY.feedback });
    } finally {
      w.s.dispose();
    }
  });

  test('FM1 control: steer 409 writes no rows -- the rejection action surface is the only entrance, the message surface stays a dead end', async () => {
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

  test('FM3: rejection deletes no deliverables and orphans nothing -- plan/messages/steps all kept, latestBuildId keeps its build', async () => {
    const w = await worldInReview();
    try {
      const stepsBefore = await w.stepsOf();
      const res = await req(w.s.app, 'POST', `/api/builds/${w.buildId}/steps`, REJECT_BODY);
      expect(res.status).toBe(202);
      const plans = (await (
        await req(w.s.app, 'GET', `/api/builds/${w.buildId}/plans`)
      ).json()) as { version: number; content: string }[];
      expect(plans.some((p) => p.version === 1 && p.content === '# 方案 v1')).toBe(true);
      const stepsAfter = await w.stepsOf();
      expect(stepsAfter.slice(0, stepsBefore.length)).toEqual(stepsBefore);
      expect(stepsAfter).toHaveLength(stepsBefore.length + 1);
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

  test('FM4: revision in the planning phase -> 409 and no feedback row (the gates sit at confirm/review; planning remarks go through the steer surface)', async () => {
    const w = await worldInReview();
    try {
      setTodoPhase(w.s.svc, w.todoId, 'planning');
      expect(await w.phaseOf()).toBe('planning');
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

  test('FM4: revision in the planning/building/done/queued phases -> the 409 {error} shape', async () => {
    const w = await worldInReview();
    try {
      const merge = await req(w.s.app, 'POST', `/api/builds/${w.buildId}/merge`);
      expect(merge.status).toBe(202);
      const steps = await w.stepsOf();
      completeStep(w.s.svc, steps[steps.length - 1]!.id);
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

  test('regression: the confirm-gate rejection semantics unchanged -- same action, same body, the prompt is still buildReplanPrompt', async () => {
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
      completeStep(s.svc, (await stepsOf())[0]!.id);
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
