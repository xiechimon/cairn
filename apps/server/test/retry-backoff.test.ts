import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  chiefMessage,
  message,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId, newUuidv7, nowMs } from '../src/lib/ids.js';
import { sweepStalledRunningTodos } from '../src/services/build-stalled-sweep.js';
import {
  applyBuildStepAction,
  applyStepFailure,
  type BuildDeps,
  sendBuildSteer,
  startBuilds,
} from '../src/services/builds.js';
import { sweepFailedRetries } from '../src/services/needs-you.js';
import { getTodo } from '../src/services/todos.js';
import { bootServer, insertMachine, seedSessionRoute, type TestServer } from './helpers.js';

const RETRY_BASE_MS = 60_000;
const RETRY_LIMIT = 3;

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

function openWorld(): World {
  const s = bootServer();
  disposables.push(() => s.dispose());
  seedSessionRoute(s);
  insertMachine(s);
  const suffix = newRecordId(8);
  const projectId = `proj-${suffix}`;
  const todoId = `todo-${suffix}`;
  const buildId = newUuidv7();
  const stepId = newRecordId();
  s.db
    .insert(projectTable)
    .values({ id: projectId, name: `retry-backoff-${suffix}`, teamId: s.team.id })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: `Task ${suffix}`,
      spec: 'Do the work.',
      phase: 'building',
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
      kind: 'session',
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

function latestBuild(w: World) {
  const latestId = w.s.db
    .select()
    .from(todoTable)
    .where(eq(todoTable.id, w.todoId))
    .get()?.latestBuildId;
  return w.s.db
    .select()
    .from(buildTable)
    .where(eq(buildTable.id, latestId ?? ''))
    .get();
}

function agePhase(w: World, phaseAt: number): void {
  w.s.db.update(todoTable).set({ phaseAt }).where(eq(todoTable.id, w.todoId)).run();
}

function failStep(w: World, stepId: string, error = 'connection reset by peer'): void {
  const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get();
  if (row === undefined) throw new Error(`missing step ${stepId}`);
  applyStepFailure(w.deps, row, error);
}

function pendingStep(w: World, buildId: string) {
  const row = w.s.db
    .select()
    .from(stepTable)
    .where(eq(stepTable.buildId, buildId))
    .all()
    .find((s) => s.status === 'pending' && s.kind === 'session');
  if (row === undefined) throw new Error(`missing pending session step on ${buildId}`);
  return row;
}

async function failThenRetry(w: World, stepId: string, waitMs: number): Promise<string> {
  failStep(w, stepId, 'connection reset by peer');
  const failedId = getTodo(w.deps, w.todoId)?.latestBuildId;
  agePhase(w, nowMs() - waitMs - 1);
  await sweepFailedRetries(w.deps);
  const retryId = getTodo(w.deps, w.todoId)?.latestBuildId;
  expect(retryId).not.toBe(failedId);
  return retryId ?? '';
}

describe('automatic retry backoff and cap', () => {
  test('a transient failure waits out a 60s backoff before retrying', async () => {
    const w = openWorld();
    failStep(w, w.stepId);
    expect(phaseOf(w)).toBe('failed');

    await sweepFailedRetries(w.deps);
    expect(phaseOf(w)).toBe('failed');
    expect(buildCount(w)).toBe(1);
    expect(getTodo(w.deps, w.todoId)?.owner).toBeNull();

    agePhase(w, nowMs() - RETRY_BASE_MS - 1);
    await sweepFailedRetries(w.deps);
    expect(phaseOf(w)).toBe('queued');
    expect(buildCount(w)).toBe(2);
    expect(latestBuild(w)?.triggerSource).toBe('retry');
    expect(latestBuild(w)?.retryAttempt).toBe(1);
    expect(
      w.s.db
        .select()
        .from(message)
        .where(eq(message.conversationId, latestBuild(w)?.id ?? ''))
        .all()
        .some((m) => String(m.content).includes(`Automatic retry 1/${RETRY_LIMIT}`)),
    ).toBe(true);
  });

  test('the backoff doubles between automatic retries', async () => {
    const w = openWorld();
    const retry1Id = await failThenRetry(w, w.stepId, RETRY_BASE_MS);
    expect(latestBuild(w)?.retryAttempt).toBe(1);

    failStep(w, pendingStep(w, retry1Id).id);
    await sweepFailedRetries(w.deps);
    expect(phaseOf(w)).toBe('failed');
    expect(buildCount(w)).toBe(2);

    agePhase(w, nowMs() - RETRY_BASE_MS - 1);
    await sweepFailedRetries(w.deps);
    expect(phaseOf(w)).toBe('failed');

    agePhase(w, nowMs() - 2 * RETRY_BASE_MS - 1);
    await sweepFailedRetries(w.deps);
    expect(phaseOf(w)).toBe('queued');
    expect(buildCount(w)).toBe(3);
    expect(latestBuild(w)?.retryAttempt).toBe(2);
  });

  test('the third retry failure parks the task and notifies the Coordinator once', async () => {
    const w = openWorld();
    const retry1Id = await failThenRetry(w, w.stepId, RETRY_BASE_MS);
    const retry2Id = await failThenRetry(w, pendingStep(w, retry1Id).id, 2 * RETRY_BASE_MS);
    const retry3Id = await failThenRetry(w, pendingStep(w, retry2Id).id, 4 * RETRY_BASE_MS);
    expect(latestBuild(w)?.retryAttempt).toBe(RETRY_LIMIT);

    failStep(w, pendingStep(w, retry3Id).id);
    const reason = latestBuild(w)?.errorMessage ?? '';
    expect(reason).toContain('Task parked');
    expect(reason).toMatch(new RegExp(`automatic retries exhausted \\(${RETRY_LIMIT}\\)`));

    await sweepFailedRetries(w.deps);
    expect(phaseOf(w)).toBe('failed');
    expect(buildCount(w)).toBe(4);
    expect(getTodo(w.deps, w.todoId)?.owner).toBe('coordinator');
    const notices = w.s.db
      .select()
      .from(chiefMessage)
      .all()
      .filter((row) => row.id.startsWith(`retry-parked-${retry3Id}-`));
    expect(notices).toHaveLength(1);
    expect(String(notices[0]?.content)).toContain('automatic retries exhausted');
  });

  test('failures spaced beyond the rolling hour still park at the total cap', async () => {
    const w = openWorld();
    let stepId = w.stepId;
    let buildId = w.buildId;
    for (let k = 0; k < RETRY_LIMIT; k++) {
      failStep(w, stepId);
      w.s.db
        .update(stepTable)
        .set({ finishedAt: nowMs() - 3_700_000 })
        .where(eq(stepTable.id, stepId))
        .run();
      agePhase(w, nowMs() - 4 * RETRY_BASE_MS - 1);
      await sweepFailedRetries(w.deps);
      buildId = getTodo(w.deps, w.todoId)?.latestBuildId ?? '';
      stepId = pendingStep(w, buildId).id;
    }
    failStep(w, stepId);
    expect(phaseOf(w)).toBe('failed');
    expect(buildCount(w)).toBe(RETRY_LIMIT + 1);
    const reason = latestBuild(w)?.errorMessage ?? '';
    expect(reason).toMatch(/automatic retries exhausted/);
    expect(reason).not.toMatch(/in one hour/);
    await sweepFailedRetries(w.deps);
    expect(buildCount(w)).toBe(RETRY_LIMIT + 1);
  });

  test('software launches on a failed task skip the backoff but share the budget', async () => {
    const w = openWorld();
    failStep(w, w.stepId);
    const [started] = startBuilds(w.deps, {
      projectId: w.projectId,
      todoIds: [w.todoId],
      triggerSource: 'chief',
    });
    expect(phaseOf(w)).toBe('queued');
    expect(latestBuild(w)?.retryAttempt).toBe(1);

    failStep(w, pendingStep(w, started?.id ?? '').id);
    await applyBuildStepAction(
      w.deps,
      started?.id ?? '',
      { action: 'restart', feedback: '', clientMessageId: 'chief-early' },
      'Coordinator',
      'coordinator',
    );
    expect(phaseOf(w)).toBe('queued');
    const restartId = getTodo(w.deps, w.todoId)?.latestBuildId ?? '';
    expect(restartId).not.toBe(started?.id);
    expect(latestBuild(w)?.retryAttempt).toBe(2);

    failStep(w, pendingStep(w, restartId).id);
    await sendBuildSteer(
      w.deps,
      restartId,
      { content: 'try again' },
      { afterTurn: true, human: false },
    );
    expect(phaseOf(w)).toBe('queued');
    expect(latestBuild(w)?.retryAttempt).toBe(3);

    failStep(w, pendingStep(w, restartId).id);
    expect(latestBuild(w)?.errorMessage).toMatch(/automatic retries exhausted/);
  });

  test('coordinator restarts share the episode budget and resume a parked task with a fresh episode', async () => {
    const w = openWorld();
    let stepId = w.stepId;
    let buildId = w.buildId;
    for (let k = 0; k < RETRY_LIMIT; k++) {
      failStep(w, stepId);
      w.s.db
        .update(stepTable)
        .set({ finishedAt: nowMs() - 3_700_000 })
        .where(eq(stepTable.id, stepId))
        .run();
      await applyBuildStepAction(
        w.deps,
        buildId,
        { action: 'restart', feedback: '', clientMessageId: `chief-${k}` },
        'Coordinator',
        'coordinator',
      );
      buildId = getTodo(w.deps, w.todoId)?.latestBuildId ?? '';
      stepId = pendingStep(w, buildId).id;
    }
    failStep(w, stepId);
    expect(latestBuild(w)?.errorMessage).toMatch(/automatic retries exhausted/);
    await applyBuildStepAction(
      w.deps,
      buildId,
      { action: 'restart', feedback: '', clientMessageId: 'chief-late' },
      'Coordinator',
      'coordinator',
    );
    expect(phaseOf(w)).toBe('queued');
    expect(latestBuild(w)?.retryAttempt).toBe(0);
    expect(latestBuild(w)?.triggerSource).toBe('chief');
    expect(buildCount(w)).toBe(RETRY_LIMIT + 2);
  });

  test('a person restart is immediate and opens a fresh episode', async () => {
    const w = openWorld();
    failStep(w, w.stepId);

    await applyBuildStepAction(
      w.deps,
      w.buildId,
      { action: 'restart', feedback: 'Fixed it', clientMessageId: 'person-retry' },
      'Owner',
      'person',
    );
    expect(phaseOf(w)).toBe('queued');
    expect(latestBuild(w)?.retryAttempt).toBe(0);

    const retryId = getTodo(w.deps, w.todoId)?.latestBuildId ?? '';
    failStep(w, pendingStep(w, retryId).id);
    await sweepFailedRetries(w.deps);
    expect(phaseOf(w)).toBe('failed');
    agePhase(w, nowMs() - RETRY_BASE_MS - 1);
    await sweepFailedRetries(w.deps);
    expect(phaseOf(w)).toBe('queued');
    expect(latestBuild(w)?.retryAttempt).toBe(1);
  });

  test('a coordinator restart reuses the build and increments its depth', async () => {
    const w = openWorld();
    w.s.db
      .update(stepTable)
      .set({ checkpointCommit: 'a'.repeat(40) })
      .where(eq(stepTable.id, w.stepId))
      .run();
    failStep(w, w.stepId);
    agePhase(w, nowMs() - RETRY_BASE_MS - 1);
    await applyBuildStepAction(
      w.deps,
      w.buildId,
      { action: 'restart', feedback: 'continue', clientMessageId: 'chief-reuse' },
      'Coordinator',
      'coordinator',
    );
    expect(phaseOf(w)).toBe('queued');
    expect(getTodo(w.deps, w.todoId)?.latestBuildId).toBe(w.buildId);
    expect(latestBuild(w)?.retryAttempt).toBe(1);
  });

  test('a stalled-run settle arms the same backoff clock', async () => {
    const w = openWorld();
    w.s.db
      .update(stepTable)
      .set({ status: 'done', finishedAt: nowMs() - 300_000 })
      .where(eq(stepTable.id, w.stepId))
      .run();
    agePhase(w, nowMs() - 300_000);
    expect(sweepStalledRunningTodos(w.deps)).toBe(1);
    expect(phaseOf(w)).toBe('failed');

    await sweepFailedRetries(w.deps);
    expect(phaseOf(w)).toBe('failed');
    expect(buildCount(w)).toBe(1);

    agePhase(w, nowMs() - RETRY_BASE_MS - 1);
    await sweepFailedRetries(w.deps);
    expect(phaseOf(w)).toBe('queued');
    expect(latestBuild(w)?.retryAttempt).toBe(1);
  });
});
