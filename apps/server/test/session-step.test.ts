import { SESSION_BRIEF } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { build, machine, step, todo } from '../src/db/schema.js';
import { completeStep, listSteps, startBuilds } from '../src/services/builds.js';
import { countMarkedRounds } from '../src/services/ci-loop.js';
import { priorSessionOf } from '../src/services/machine-routing.js';
import { messageThreadAsUser } from '../src/services/thread-message.js';
import { getTodo } from '../src/services/todos.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { insertMachine } from './helpers.js';

registerChiefHarness();

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

function startSession() {
  if (
    H.s.db.select({ id: machine.id }).from(machine).where(eq(machine.teamId, H.teamId)).get() ===
    undefined
  ) {
    insertMachine(H.s);
  }
  const todoId = seedTodo();
  const [started] = startBuilds(deps(), {
    projectId: H.projectId,
    todoIds: [todoId],
  });
  const stepRow = H.s.db.select().from(step).where(eq(step.buildId, started!.id)).get()!;
  return { todoId, buildId: started!.id, stepRow };
}

describe('session step kind', () => {
  test('startBuilds enqueues one session step carrying the brief and no plan', () => {
    const { buildId, stepRow } = startSession();
    const steps = H.s.db.select().from(step).where(eq(step.buildId, buildId)).all();
    expect(steps).toHaveLength(1);
    expect(stepRow.kind).toBe('session');
    expect(stepRow.prompt).toContain(SESSION_BRIEF);
    expect(H.s.db.select().from(build).where(eq(build.id, buildId)).get()!.withPlan).toBe(false);
  });

  test('rework at review continues the same session as a session step, not a plan', async () => {
    const { todoId, buildId, stepRow } = startSession();
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
    expect(next.promptOrigin).toEqual({ kind: 'rework' });
    expect(listSteps(deps(), buildId).find((r) => r.id === next.id)?.promptOrigin).toEqual({
      kind: 'rework',
    });
    expect(listSteps(deps(), buildId).find((r) => r.id === stepRow.id)).not.toHaveProperty(
      'promptOrigin',
    );
    expect(getTodo(deps(), todoId)!.phase).toBe('queued');
  });
});

describe('session steps share the build-step paths', () => {
  function claim(stepId: string) {
    H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepId)).run();
    return H.s.db.select().from(step).where(eq(step.id, stepId)).get()!;
  }

  test('a session turn with no changes and no question asks the Coordinator instead of failing', () => {
    const { todoId, stepRow } = startSession();
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    claim(stepRow.id);
    completeStep(deps(), stepRow.id, { hasChanges: false });
    expect(getTodo(deps(), todoId)!.phase).toBe('needs_input');
  });

  test('session steps count toward the marked repair rounds', () => {
    const { buildId } = startSession();
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
    const { todoId, buildId, stepRow } = startSession();
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
    const { todoId, buildId, stepRow } = startSession();
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

  test('a build step enqueued inside a session build resumes the session step', async () => {
    const { buildId, stepRow } = startSession();
    H.s.db
      .update(step)
      .set({ status: 'done', sessionId: 'impl-session', createdAt: 1 })
      .where(eq(step.id, stepRow.id))
      .run();
    H.s.db
      .insert(step)
      .values({ id: 'fb-build', buildId, kind: 'build', status: 'pending', createdAt: 2 })
      .run();
    H.s.db.update(build).set({ prevPhase: 'review' }).where(eq(build.id, buildId)).run();
    const buildRow = H.s.db.select().from(build).where(eq(build.id, buildId)).get()!;
    const next = H.s.db.select().from(step).where(eq(step.id, 'fb-build')).get()!;
    expect(priorSessionOf(H.s.db, next, buildRow).priorSessionId).toBe('impl-session');
  });

  test('idle building continuation skips a later reviewer session', async () => {
    const { buildId, stepRow } = startSession();
    H.s.db
      .update(step)
      .set({ status: 'done', sessionId: 'impl-session', createdAt: 1 })
      .where(eq(step.id, stepRow.id))
      .run();
    H.s.db
      .insert(step)
      .values({
        id: 'later-review',
        buildId,
        kind: 'review',
        status: 'done',
        sessionId: 'review-session',
        createdAt: 2,
      })
      .run();
    H.s.db
      .insert(step)
      .values({
        id: 'idle-building-next',
        buildId,
        kind: 'session',
        status: 'pending',
        createdAt: 3,
      })
      .run();
    H.s.db.update(build).set({ prevPhase: 'building' }).where(eq(build.id, buildId)).run();
    const buildRow = H.s.db.select().from(build).where(eq(build.id, buildId)).get()!;
    const next = H.s.db.select().from(step).where(eq(step.id, 'idle-building-next')).get()!;
    expect(priorSessionOf(H.s.db, next, buildRow).priorSessionId).toBe('impl-session');
  });
});
