import { SESSION_BRIEF } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { build, step, todo } from '../src/db/schema.js';
import { completeStep, maybeEnqueueVerifyStep, startBuilds } from '../src/services/builds.js';
import { countMarkedRounds } from '../src/services/ci-loop.js';
import { priorSessionOf } from '../src/services/machine-routing.js';
import { setRoutingRulesEnabled } from '../src/services/routing-rules.js';
import { messageThreadAsUser } from '../src/services/thread-message.js';
import { getTodo } from '../src/services/todos.js';
import { AGENT_ID, H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();
beforeEach(() => setRoutingRulesEnabled(true));
afterEach(() => setRoutingRulesEnabled(false));

function deps() {
  return {
    db: H.s.db,
    hub: H.s.hub,
    convHub: H.s.convHub,
    machineHub: H.s.machineHub,
    user: H.s.user,
  };
}

function seedTodo(id = 'session-todo') {
  H.s.db
    .insert(todo)
    .values({
      id,
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Export the board',
      spec: 'Add an export.',
      phase: 'todo',
      phaseAt: 1,
      seqNum: 3,
    })
    .run();
  return id;
}

function startSession(withPlan = true) {
  const todoId = seedTodo();
  const [started] = startBuilds(deps(), {
    projectId: H.projectId,
    todoIds: [todoId],
    assignment: { plan: null, build: { agentId: AGENT_ID } },
    withPlan,
  });
  const stepRow = H.s.db.select().from(step).where(eq(step.buildId, started!.id)).get()!;
  return { todoId, buildId: started!.id, stepRow };
}

describe('session step kind (flag on)', () => {
  test('startBuilds enqueues one session step carrying the brief, even when a plan was requested', () => {
    const { buildId, stepRow } = startSession(true);
    const steps = H.s.db.select().from(step).where(eq(step.buildId, buildId)).all();
    expect(steps).toHaveLength(1);
    expect(stepRow.kind).toBe('session');
    expect(stepRow.prompt).toContain(SESSION_BRIEF);
    expect(H.s.db.select().from(build).where(eq(build.id, buildId)).get()!.withPlan).toBe(false);
  });

  test('flag off keeps the plan step', () => {
    setRoutingRulesEnabled(false);
    const { stepRow } = startSession(true);
    expect(stepRow.kind).toBe('plan');
  });

  test('a finished session build with a verifier assigned still gets a verify step', () => {
    const { todoId, buildId } = startSession(false);
    H.s.db
      .update(todo)
      .set({
        assignment: { plan: null, build: { agentId: AGENT_ID }, verify: { agentId: AGENT_ID } },
      })
      .where(eq(todo.id, todoId))
      .run();
    const row = H.s.db.select().from(todo).where(eq(todo.id, todoId)).get();
    if (row === undefined) throw new Error('todo missing');
    maybeEnqueueVerifyStep(deps(), row, buildId);
    expect(
      H.s.db
        .select()
        .from(step)
        .where(eq(step.buildId, buildId))
        .all()
        .map((r) => r.kind)
        .sort(),
    ).toEqual(['session', 'verify']);
  });

  test('rework at review continues the same session as a session step, not a plan', async () => {
    const { todoId, buildId, stepRow } = startSession(false);
    H.s.db
      .update(step)
      .set({ status: 'done', sessionId: 'sess-1' })
      .where(eq(step.id, stepRow.id))
      .run();
    H.s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, todoId)).run();
    const sent = await messageThreadAsUser(deps(), H.teamId, todoId, {
      content: 'Also cover the empty board',
      clientMessageId: 'c-1',
    });
    expect(sent.delivered).toBe('revision');
    const next = H.s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .find((r) => r.status === 'pending')!;
    expect(next.kind).toBe('session');
    expect(next.prompt).toContain('Also cover the empty board');
    expect(getTodo(deps(), todoId)!.phase).toBe('queued');
  });
});

describe('session steps share the build-step paths', () => {
  function claim(stepId: string) {
    H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepId)).run();
    return H.s.db.select().from(step).where(eq(step.id, stepId)).get()!;
  }

  test('a session turn with no changes and no question still fails the artifact gate', () => {
    const { todoId, stepRow } = startSession(false);
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    claim(stepRow.id);
    completeStep(deps(), stepRow.id, { hasChanges: false });
    expect(getTodo(deps(), todoId)!.phase).toBe('failed');
  });

  test('session steps count toward the marked repair rounds', () => {
    const { buildId } = startSession(false);
    H.s.db
      .insert(step)
      .values({
        id: 'repair-1',
        buildId,
        kind: 'session',
        status: 'done',
        prompt: '[ci-fix] round 1',
        createdAt: 5,
      })
      .run();
    expect(countMarkedRounds(H.s.db, buildId, '[ci-fix]')).toBe(1);
  });

  test('restart reuses the build when a failed session step preserved a checkpoint', async () => {
    const { todoId, buildId, stepRow } = startSession(false);
    H.s.db
      .update(step)
      .set({ status: 'failed', checkpointCommit: 'c'.repeat(40) })
      .where(eq(step.id, stepRow.id))
      .run();
    H.s.db.update(todo).set({ phase: 'failed' }).where(eq(todo.id, todoId)).run();
    const sent = await messageThreadAsUser(deps(), H.teamId, todoId, {
      content: 'Continue from the checkpoint',
      clientMessageId: 'c-r',
    });
    expect(sent.delivered).toBe('restart');
    expect(sent.conversationId).toBe(buildId);
  });

  test('rework from review resumes the implementation session, not a reviewer or verifier session', async () => {
    const { todoId, buildId, stepRow } = startSession(false);
    H.s.db
      .update(step)
      .set({ status: 'done', sessionId: 'impl-session', createdAt: 1 })
      .where(eq(step.id, stepRow.id))
      .run();
    H.s.db
      .insert(step)
      .values({
        id: 'verifier-step',
        buildId,
        kind: 'verify',
        status: 'done',
        sessionId: 'verify-session',
        createdAt: 2,
      })
      .run();
    H.s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, todoId)).run();
    await messageThreadAsUser(deps(), H.teamId, todoId, {
      content: 'Cover the empty board',
      clientMessageId: 'c-prior',
    });
    const buildRow = H.s.db.select().from(build).where(eq(build.id, buildId)).get()!;
    const next = H.s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .find((r) => r.status === 'pending')!;
    expect(priorSessionOf(H.s.db, next, buildRow).priorSessionId).toBe('impl-session');
  });
});
