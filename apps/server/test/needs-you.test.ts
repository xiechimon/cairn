import { DEFAULT_AUTONOMY_SETTINGS, needsYouQuerySchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId, newUuidv7, nowMs } from '../src/lib/ids.js';
import { applyStepFailure, type BuildDeps, completeStep } from '../src/services/builds.js';
import { listNeedsYou, NEEDS_YOU_STALE_MS, sweepFailedRetries } from '../src/services/needs-you.js';
import { createScheduler } from '../src/services/scheduler.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, req, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const dispose of disposables) dispose();
});

interface World {
  s: TestServer;
  deps: BuildDeps;
  projectId: string;
  todoId: string;
  buildId: string;
  stepId: string;
}

function openWorld(phase: 'building' | 'confirm' | 'review' = 'building'): World {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const suffix = newRecordId(8);
  const projectId = `proj-${suffix}`;
  const todoId = `todo-${suffix}`;
  const buildId = newUuidv7();
  const stepId = newRecordId();
  s.db
    .insert(projectTable)
    .values({ id: projectId, name: `needs-you-${suffix}`, teamId: s.team.id })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: `Task ${suffix}`,
      spec: 'Do the work.',
      phase,
      phaseAt: nowMs(),
      seqNum: 1,
      latestBuildId: buildId,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      prevPhase: 'todo',
      triggerSource: 'user',
      createdAt: nowMs() - 60_000,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId,
      kind: 'build',
      status: 'claimed',
      createdAt: nowMs() - 30_000,
    })
    .run();
  const deps: BuildDeps = { ...s.svc, reposDir: s.reposDir, box: s.secretBox };
  return { s, deps, projectId, todoId, buildId, stepId };
}

function phaseOf(w: World): string {
  return w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.phase ?? '';
}

function buildCount(w: World): number {
  return w.s.db.select().from(buildTable).where(eq(buildTable.todoId, w.todoId)).all().length;
}

function groups(w: World, now = nowMs()) {
  const listed = listNeedsYou(w.deps, w.s.team.id, now);
  return {
    current: listed.current.filter((entry) => entry.todo.id === w.todoId),
    stale: listed.stale.filter((entry) => entry.todo.id === w.todoId),
  };
}

function agePhase(w: World, phaseAt: number): void {
  w.s.db.update(todoTable).set({ phaseAt }).where(eq(todoTable.id, w.todoId)).run();
}

describe('needs you (#1800)', () => {
  test('a transient failure is retried once and stays out of needs you when the retry succeeds', async () => {
    const w = openWorld();
    const step = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get();
    if (step === undefined) throw new Error('missing step');
    applyStepFailure(w.deps, step, 'connection reset by peer');
    expect(phaseOf(w)).toBe('failed');
    expect(groups(w).current).toEqual([]);
    expect(groups(w).stale).toEqual([]);

    await sweepFailedRetries(w.deps);
    expect(phaseOf(w)).toBe('queued');
    expect(buildCount(w)).toBe(2);
    const retried = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.status, 'pending'))
      .all()
      .find((row) => row.kind === 'build');
    if (retried === undefined) throw new Error('missing retry step');
    setTodoPhase(w.deps, w.todoId, 'building');
    completeStep(w.deps, retried.id, { hasChanges: true });

    expect(phaseOf(w)).toBe('review');
    expect(groups(w).current).toEqual([]);
    expect(groups(w).stale).toEqual([]);
  });

  test('a second failure after the automatic retry stays failed and enters the current group', async () => {
    const w = openWorld();
    const step = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get();
    if (step === undefined) throw new Error('missing step');
    applyStepFailure(w.deps, step, 'connection reset by peer');
    await sweepFailedRetries(w.deps);
    const retried = w.s.db.select().from(stepTable).where(eq(stepTable.status, 'pending')).get();
    if (retried === undefined) throw new Error('missing retry step');
    applyStepFailure(w.deps, retried, 'connection reset by peer');
    const buildsAfterRetry = buildCount(w);
    await sweepFailedRetries(w.deps);

    expect(phaseOf(w)).toBe('failed');
    expect(buildCount(w)).toBe(buildsAfterRetry);
    expect(groups(w).current.map((entry) => entry.reason)).toEqual(['failed']);
    expect(groups(w).stale).toEqual([]);
  });

  test('a gate rejection is not retried and enters the current group', async () => {
    const w = openWorld();
    completeStep(w.deps, w.stepId, { hasChanges: false });
    const builds = buildCount(w);
    await sweepFailedRetries(w.deps);

    expect(phaseOf(w)).toBe('failed');
    expect(buildCount(w)).toBe(builds);
    expect(groups(w).current.map((entry) => entry.reason)).toEqual(['failed']);
  });

  test('a missing-credential failure is not retried and enters the current group', async () => {
    const w = openWorld();
    const step = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get();
    if (step === undefined) throw new Error('missing step');
    applyStepFailure(w.deps, step, 'invalid api key');
    const builds = buildCount(w);
    await sweepFailedRetries(w.deps);

    expect(phaseOf(w)).toBe('failed');
    expect(buildCount(w)).toBe(builds);
    expect(groups(w).current.map((entry) => entry.reason)).toEqual(['failed']);
  });

  test('plan confirmations and human reviews enter needs you; an autonomous review does not', () => {
    const confirm = openWorld('confirm');
    const humanReview = openWorld('review');
    humanReview.s.db
      .update(projectTable)
      .set({ autonomy: { ...DEFAULT_AUTONOMY_SETTINGS, mergePolicy: 'human' } })
      .where(eq(projectTable.id, humanReview.projectId))
      .run();
    const autonomousReview = openWorld('review');

    expect(groups(confirm).current.map((entry) => entry.reason)).toEqual(['confirm']);
    expect(groups(humanReview).current.map((entry) => entry.reason)).toEqual(['review']);
    expect(groups(autonomousReview).current).toEqual([]);
    expect(groups(autonomousReview).stale).toEqual([]);
  });

  test('an item older than 7 days moves to the stale group', () => {
    const fresh = openWorld('confirm');
    const aged = openWorld('confirm');
    const now = nowMs();
    agePhase(fresh, now - NEEDS_YOU_STALE_MS);
    agePhase(aged, now - NEEDS_YOU_STALE_MS - 1);

    expect(groups(fresh, now).current.map((entry) => entry.todo.id)).toEqual([fresh.todoId]);
    expect(groups(fresh, now).stale).toEqual([]);
    expect(groups(aged, now).current).toEqual([]);
    expect(groups(aged, now).stale.map((entry) => entry.todo.id)).toEqual([aged.todoId]);
  });

  test('GET /api/needs-you is the single query and folds an old confirmation into stale', async () => {
    const w = openWorld('confirm');
    const now = nowMs();
    agePhase(w, now - NEEDS_YOU_STALE_MS - 1);
    const res = await req(w.s.app, 'GET', `/api/needs-you?teamId=${w.s.team.id}`);
    expect(res.status).toBe(200);
    const body = needsYouQuerySchema.parse(await res.json());
    expect(body.current.filter((entry) => entry.todo.id === w.todoId)).toEqual([]);
    expect(
      body.stale.filter((entry) => entry.todo.id === w.todoId).map((entry) => entry.reason),
    ).toEqual(['confirm']);
  });

  test('the scheduler tick retries a transient failure', async () => {
    const w = openWorld();
    const step = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get();
    if (step === undefined) throw new Error('missing step');
    applyStepFailure(w.deps, step, 'connection reset by peer');
    const scheduler = createScheduler(w.deps, { tickMs: 60_000 });
    scheduler.tick();
    await new Promise((resolve) => setImmediate(resolve));
    expect(phaseOf(w)).toBe('queued');
    expect(buildCount(w)).toBe(2);
  });
});
