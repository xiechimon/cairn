import { CONFIRM_ANNOUNCEMENT } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  build as buildTable,
  message as messageTable,
  plan as planTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { applyBuildConfirm } from '../src/services/build-confirm.js';
import { completeStep } from '../src/services/builds.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, postProject, req, startLegacyBuild, type TestServer } from './helpers.js';

async function todoAtConfirm(s: TestServer) {
  const projectId = await postProject(s.app);
  const todoDoc = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: '原子收尾',
      spec: '',
    })
  ).json()) as { id: string };
  const buildId = startLegacyBuild(s, todoDoc.id, { withPlan: true });
  setTodoPhase(s.svc, todoDoc.id, 'planning');
  const steps = (await (await req(s.app, 'GET', `/api/builds/${buildId}/steps`)).json()) as {
    id: string;
    kind: string;
  }[];
  s.db
    .insert(planTable)
    .values({ id: 'plan-atomic', buildId, version: 1, content: '# 方案', createdAt: Date.now() })
    .run();
  completeStep(s.svc, steps[0]?.id ?? '');
  return { projectId, todoId: todoDoc.id, buildId };
}

function phaseOf(s: TestServer, todoId: string) {
  return s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.phase;
}

describe('settle atomicity (effect-paths-audit rows 2 and 3)', () => {
  test('confirm: enqueueStep throwing after the phase write leaves the whole settle uncommitted', async () => {
    const s = bootServer({});
    const { todoId, buildId } = await todoAtConfirm(s);
    expect(phaseOf(s, todoId)).toBe('confirm');

    s.db
      .update(buildTable)
      .set({ errorMessage: 'Task parked (quota)' })
      .where(eq(buildTable.id, buildId))
      .run();

    expect(() => applyBuildConfirm(s.svc, buildId, 'server', false)).toThrow();

    expect(phaseOf(s, todoId)).toBe('confirm');
    const buildSteps = s.db
      .select()
      .from(stepTable)
      .where(and(eq(stepTable.buildId, buildId), eq(stepTable.kind, 'build')))
      .all();
    expect(buildSteps).toHaveLength(0);
    const announcements = s.db
      .select()
      .from(messageTable)
      .where(
        and(
          eq(messageTable.conversationId, buildId),
          eq(messageTable.content, CONFIRM_ANNOUNCEMENT),
        ),
      )
      .all();
    expect(announcements).toHaveLength(0);
  });

  test('completeStep: a mid-settle failure leaves the step and the phase uncommitted', async () => {
    const s = bootServer({});
    const { todoId, buildId } = await todoAtConfirm(s);
    applyBuildConfirm(s.svc, buildId, 'server', false);
    const steps = (await (await req(s.app, 'GET', `/api/builds/${buildId}/steps`)).json()) as {
      id: string;
      kind: string;
      status: string;
    }[];
    const buildStep = steps.find((r) => r.kind === 'build');
    expect(buildStep?.status).toBe('pending');

    const hub = s.hub as { publishTodoDoc: unknown };
    const original = hub.publishTodoDoc;
    hub.publishTodoDoc = () => {
      throw new Error('simulated kill between step done and phase done');
    };
    try {
      expect(() => completeStep(s.svc, buildStep?.id ?? '')).toThrow('simulated kill');
    } finally {
      hub.publishTodoDoc = original;
    }

    const settled = s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, buildStep?.id ?? ''))
      .get();
    expect(settled?.status).not.toBe('done');
    expect(phaseOf(s, todoId)).toBe('building');

    expect(() => completeStep(s.svc, buildStep?.id ?? '')).not.toThrow();
    expect(phaseOf(s, todoId)).toBe('done');
  });
});
