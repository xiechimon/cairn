import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { build, step, todo } from '../src/db/schema.js';
import {
  applyStepFailure,
  applyStoppedStep,
  completeStep,
  enqueueStep,
} from '../src/services/builds.js';
import { H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

function seedTodo(over: Partial<typeof todo.$inferInsert> = {}) {
  const id = over.id ?? `todo-${Math.random().toString(36).slice(2, 8)}`;
  H.s.db
    .insert(todo)
    .values({
      id,
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Confine the sandbox',
      spec: 'Confine it.',
      phase: 'todo',
      phaseAt: 1,
      seqNum: 139,
      ...over,
    })
    .run();
  return id;
}

async function openThread() {
  const todoId = seedTodo();
  const out = (await relay('open_thread', { todoId })) as { buildId: string };
  return { todoId, buildId: out.buildId };
}

function buildStop(buildId: string) {
  return H.s.db.select().from(build).where(eq(build.id, buildId)).get()?.stop ?? null;
}

describe('a stop records who stopped the work and why (task stall S8)', () => {
  test('stop_thread without a reason is rejected and stops nothing', async () => {
    const { todoId, buildId } = await openThread();
    await expect(relay('stop_thread', { todoId })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/reason/),
    });
    expect(H.s.db.select().from(step).where(eq(step.buildId, buildId)).get()?.status).toBe(
      'pending',
    );
    expect(buildStop(buildId)).toBeNull();
  });

  test('stop_thread records the Coordinator as actor with its reason', async () => {
    const { todoId, buildId } = await openThread();
    await relay('stop_thread', { todoId, reason: 'priority: finish #131 first' });
    expect(buildStop(buildId)).toMatchObject({
      actor: 'coordinator',
      reason: 'priority: finish #131 first',
    });
  });

  test('the threads view shows a stopped thread with who stopped it, so a later turn cannot call it open', async () => {
    const { todoId } = await openThread();
    await relay('stop_thread', { todoId, reason: 'priority: finish #131 first' });
    expect(H.s.db.select().from(todo).where(eq(todo.id, todoId)).get()?.phase).toBe('todo');
    const out = (await relay('threads', {})) as {
      threads: { id: string; stopped: { actor: string; reason: string } | null }[];
    };
    const row = out.threads.find((t) => t.id === todoId);
    expect(row?.stopped).toMatchObject({
      actor: 'coordinator',
      reason: 'priority: finish #131 first',
    });
  });

  test('cancel_builds needs a reason and records it', async () => {
    const { buildId } = await openThread();
    await expect(relay('cancel_builds', { buildIds: [buildId] })).rejects.toMatchObject({
      status: 400,
    });
    await relay('cancel_builds', { buildIds: [buildId], reason: 'duplicate of #140' });
    expect(buildStop(buildId)).toMatchObject({ actor: 'coordinator', reason: 'duplicate of #140' });
  });

  test.each(['plan', 'review', 'verify', 'merge'] as const)(
    'a %s step that resumes a stopped build clears the stop attribution',
    async (kind) => {
      const { todoId, buildId } = await openThread();
      await relay('stop_thread', { todoId, reason: 'priority: finish #131 first' });
      expect(buildStop(buildId)).not.toBeNull();
      enqueueStep(toolDeps(), buildId, kind, H.teamId, undefined, undefined, true);
      expect(buildStop(buildId)).toBeNull();
    },
  );

  test.each([
    ['completes', (stepId: string) => completeStep(toolDeps(), stepId, { hasChanges: false })],
    [
      'fails',
      (stepId: string) => {
        const row = H.s.db.select().from(step).where(eq(step.id, stepId)).get();
        if (!row) throw new Error('step missing');
        applyStepFailure(toolDeps(), row, 'agent exited with code 1');
      },
    ],
  ] as const)(
    'a claimed step that %s before the stop lands leaves no stop attribution',
    async (_label, finish) => {
      const { todoId, buildId } = await openThread();
      const stepRow = H.s.db.select().from(step).where(eq(step.buildId, buildId)).get();
      if (!stepRow) throw new Error('step missing');
      H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
      await relay('stop_thread', { todoId, reason: 'priority: finish #131 first' });
      expect(buildStop(buildId)).not.toBeNull();
      finish(stepRow.id);
      expect(buildStop(buildId)).toBeNull();
    },
  );

  test('a claimed step the daemon reports stopped keeps the stop attribution', async () => {
    const { todoId, buildId } = await openThread();
    const stepRow = H.s.db.select().from(step).where(eq(step.buildId, buildId)).get();
    if (!stepRow) throw new Error('step missing');
    H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
    await relay('stop_thread', { todoId, reason: 'priority: finish #131 first' });
    applyStoppedStep(toolDeps(), stepRow.id);
    expect(buildStop(buildId)).toMatchObject({ actor: 'coordinator' });
  });

  test('a stop from the task page records a person as actor', async () => {
    const { buildId } = await openThread();
    const res = await req(H.s.app, 'POST', `/api/builds/${buildId}/stop`, { discard: false });
    expect(res.status).toBeLessThan(300);
    expect(buildStop(buildId)).toMatchObject({ actor: 'person' });
    expect(buildStop(buildId)?.reason).not.toBe('');
  });
});
