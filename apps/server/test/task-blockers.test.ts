import { and, eq, like } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { build, step, todo } from '../src/db/schema.js';
import { BLOCKED_BY_HOLD, releaseBlockedSteps } from '../src/services/blockers.js';
import { enqueueStep } from '../src/services/builds.js';
import { reconcileOwners } from '../src/services/owner.js';
import { getTodo, setTodoPhase } from '../src/services/todos.js';
import { H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';
import { req, seedSessionRoute } from './helpers.js';

registerChiefHarness();

async function create(over: Record<string, unknown> = {}): Promise<string> {
  seedSessionRoute(H.s);
  const out = (await relay('create_todo', {
    projectId: H.projectId,
    title: `Task ${Math.random().toString(36).slice(2, 6)}`,
    spec: 'Do the work.',
    ...over,
  })) as { id: string };
  return out.id;
}

function row(id: string) {
  return H.s.db.select().from(todo).where(eq(todo.id, id)).get()!;
}

function sessions(id: string) {
  const latest = row(id).latestBuildId;
  if (latest === null) return [];
  return H.s.db.select().from(step).where(eq(step.buildId, latest)).all();
}

function finish(id: string, phase: 'done' | 'failed' | 'closed'): void {
  H.s.db.update(todo).set({ phase, phaseAt: Date.now() }).where(eq(todo.id, id)).run();
}

describe('the Coordinator starts what it creates (task stall class 3)', () => {
  test('create_todo starts a thread: queued, one session, triggered by the Coordinator', async () => {
    const id = await create();
    expect(row(id).phase).toBe('queued');
    expect(sessions(id).map((s) => [s.kind, s.holdReason])).toEqual([['session', null]]);
    const buildRow = H.s.db
      .select()
      .from(build)
      .where(eq(build.id, row(id).latestBuildId!))
      .get();
    expect(buildRow?.triggerSource).toBe('chief');
  });

  test('reopen_todos starts a new build instead of parking the task in todo', async () => {
    const id = await create();
    const first = row(id).latestBuildId;
    finish(id, 'closed');
    await relay('reopen_todos', { todoIds: [id] });
    expect(row(id).phase).toBe('queued');
    expect(row(id).latestBuildId).not.toBe(first);
  });
});

describe('reopen_todos reports a task it could not start', () => {
  test('a reopened task whose start is refused is listed with the reason', async () => {
    const id = await create();
    finish(id, 'closed');
    H.s.db.update(todo).set({ archivedAt: Date.now() }).where(eq(todo.id, id)).run();
    const out = (await relay('reopen_todos', { todoIds: [id] })) as {
      transitioned: string[];
      started: string[];
      notStarted?: Record<string, string>;
    };
    expect(out.transitioned).toEqual([id]);
    expect(out.started).toEqual([]);
    expect(out.notStarted?.[id]).toMatch(/Unarchive/);
  });
});

describe('blockedBy holds a task until its blockers are satisfied', () => {
  test('a task created behind an unfinished blocker is held, and released once the blocker is done', async () => {
    const blocker = await create();
    const id = await create({ blockedBy: [blocker] });
    expect(row(id).blockedBy).toEqual([blocker]);
    expect(sessions(id)[0]?.holdReason).toBe(BLOCKED_BY_HOLD);
    releaseBlockedSteps(toolDeps());
    expect(sessions(id)[0]?.holdReason).toBe(BLOCKED_BY_HOLD);
    finish(blocker, 'done');
    releaseBlockedSteps(toolDeps());
    expect(sessions(id)[0]?.holdReason).toBeNull();
    expect(sessions(id)[0]?.holdUntil).toBeNull();
  });

  test('update_todo adds an edge and holds the pending session', async () => {
    const blocker = await create();
    const id = await create();
    await relay('update_todo', { todoId: id, blockedBy: [blocker] });
    expect(sessions(id)[0]?.holdReason).toBe(BLOCKED_BY_HOLD);
  });

  test.each(['tool', 'rest'] as const)(
    'deleting a blocker through %s keeps its dependent held and owned',
    async (route) => {
      const blocker = await create();
      const id = await create({ blockedBy: [blocker] });
      if (route === 'tool') await relay('delete_todos', { todoIds: [blocker] });
      else expect((await req(H.s.app, 'DELETE', `/api/todos/${blocker}`)).status).toBe(204);
      releaseBlockedSteps(toolDeps());
      reconcileOwners(toolDeps());
      expect(sessions(id)[0]?.holdReason).toBe(BLOCKED_BY_HOLD);
      expect(getTodo(toolDeps(), id)?.owner).toBe('coordinator');
      const record = getTodo(toolDeps(), id)!;
      enqueueStep(toolDeps(), record.latestBuildId!, 'session', H.teamId, 'Continue.');
      expect(sessions(id).every((entry) => entry.holdReason === BLOCKED_BY_HOLD)).toBe(true);
      await relay('update_todo', { todoId: id, blockedBy: [] });
      releaseBlockedSteps(toolDeps());
      expect(sessions(id).every((entry) => entry.holdReason === null)).toBe(true);
    },
  );

  test('a blocker-only update publishes the new dependency with an increased version', async () => {
    const blocker = await create();
    const id = await create();
    const before = row(id).v;
    const publish = vi.spyOn(H.s.hub, 'publishTodoDoc');
    await relay('update_todo', { todoId: id, blockedBy: [blocker] });
    expect(row(id).v).toBeGreaterThan(before);
    expect(publish).toHaveBeenCalledWith(
      H.teamId,
      expect.objectContaining({ id, blockedBy: [blocker], v: row(id).v }),
    );
  });

  test('a step enqueued later on a blocked task is held at insert', async () => {
    const blocker = await create();
    const id = await create({ blockedBy: [blocker] });
    const record = getTodo(toolDeps(), id)!;
    enqueueStep(toolDeps(), record.latestBuildId!, 'session', H.teamId, 'Continue.');
    expect(sessions(id).every((s) => s.holdReason === BLOCKED_BY_HOLD)).toBe(true);
  });

  test.each([
    ['an unknown id', () => ['missing-task']],
    ['the task itself', (self: string) => [self]],
  ])('blockedBy naming %s is refused', async (_name, ids) => {
    const id = await create();
    await expect(relay('update_todo', { todoId: id, blockedBy: ids(id) })).rejects.toMatchObject({
      status: 400,
    });
    expect(row(id).blockedBy ?? []).toEqual([]);
  });

  test('create_todo with an invalid blockedBy creates nothing', async () => {
    const before = H.s.db.select().from(todo).all().length;
    await expect(create({ blockedBy: ['missing-task'] })).rejects.toMatchObject({ status: 400 });
    expect(H.s.db.select().from(todo).all()).toHaveLength(before);
    expect(H.s.db.select().from(build).all()).toHaveLength(0);
  });

  test('update_todo that fails on another field leaves blockedBy unchanged', async () => {
    const blocker = await create();
    const id = await create();
    await expect(
      relay('update_todo', { todoId: id, blockedBy: [blocker], projectId: 'missing-project' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(row(id).blockedBy ?? []).toEqual([]);
    expect(sessions(id)[0]?.holdReason).toBeNull();
  });

  test('a blocker cannot be added under a running session', async () => {
    const blocker = await create();
    const id = await create();
    const [session] = sessions(id);
    H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, session!.id)).run();
    await expect(relay('update_todo', { todoId: id, blockedBy: [blocker] })).rejects.toMatchObject({
      status: 409,
    });
    expect(row(id).blockedBy ?? []).toEqual([]);
  });

  test('a cycle is refused', async () => {
    const a = await create();
    const b = await create({ blockedBy: [a] });
    await expect(relay('update_todo', { todoId: a, blockedBy: [b] })).rejects.toMatchObject({
      status: 400,
    });
  });

  test('a failed blocker hands the held task to the Coordinator once', async () => {
    const blocker = await create();
    const id = await create({ blockedBy: [blocker] });
    finish(blocker, 'failed');
    releaseBlockedSteps(toolDeps());
    reconcileOwners(toolDeps());
    reconcileOwners(toolDeps());
    expect(getTodo(toolDeps(), id)?.owner).toBe('coordinator');
    expect(sessions(id)[0]?.holdReason).toBe(BLOCKED_BY_HOLD);
    const wakes = H.s.db
      .select()
      .from(step)
      .where(and(eq(step.kind, 'chief'), like(step.prompt, `%watch:${id}%`)))
      .all();
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.prompt).toContain(`#${row(blocker).seqNum}`);
  });

  test('the Coordinator dropping the edge releases the task', async () => {
    const blocker = await create();
    const id = await create({ blockedBy: [blocker] });
    finish(blocker, 'failed');
    await relay('update_todo', { todoId: id, blockedBy: [] });
    releaseBlockedSteps(toolDeps());
    expect(sessions(id)[0]?.holdReason).toBeNull();
    setTodoPhase(toolDeps(), id, 'building');
    expect(getTodo(toolDeps(), id)?.owner).toBeNull();
  });
});
