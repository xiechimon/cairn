import {
  chiefNoticeContentSchema,
  DEFAULT_AUTONOMY_SETTINGS,
  needsYouQuerySchema,
} from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  claudeCodeAuthFailureMessage,
  claudeCodeTeamSubscriptionAuthFailureMessage,
} from '../../daemon/src/claude-code-auth.js';
import {
  build as buildTable,
  chiefMessage,
  message,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId, newUuidv7, nowMs } from '../src/lib/ids.js';
import {
  applyBuildStepAction,
  applyStepFailure,
  applyStoppedStep,
  type BuildDeps,
  completeStep,
  enqueueStep,
  sendBuildSteer,
  startBuilds,
} from '../src/services/builds.js';
import { addChiefWatch, coordinatorThreadRow, ensureChief } from '../src/services/chief.js';
import {
  failureNeedsHuman,
  listNeedsYou,
  NEEDS_YOU_STALE_MS,
  sweepFailedRetries,
} from '../src/services/needs-you.js';
import { parkFailedBuild } from '../src/services/retry-parking.js';
import { createScheduler } from '../src/services/scheduler.js';
import {
  drainTaskMessageQueue,
  queueTaskMessage,
  readQueuedMessages,
} from '../src/services/task-message-queue.js';
import { getTodo, setTodoPhase } from '../src/services/todos.js';
import { bootServer, insertMachine, req, seedSessionRoute, type TestServer } from './helpers.js';

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
  seedSessionRoute(s);
  insertMachine(s);
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
  test('a missing model parks on its first failure across sweep, dispatch and continuation', async () => {
    const w = openWorld();
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    applyStepFailure(
      w.deps,
      row,
      '404: {"message":"Model \\"glm-5.3\\" is not supported by any configured account in this group","type":"model_not_found"}',
    );
    await sweepFailedRetries(w.deps);
    expect(phaseOf(w)).toBe('failed');
    expect(buildCount(w)).toBe(1);
    expect(
      w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()?.errorMessage,
    ).toBe('Task parked: model unavailable (glm-5.3). Update model routing before retrying.');
    expect(getTodo(w.deps, w.todoId)?.owner).toBe('coordinator');
    expect(
      w.s.db
        .select()
        .from(chiefMessage)
        .all()
        .some((notice) => String(notice.content).includes('glm-5.3')),
    ).toBe(true);
    expect(() =>
      startBuilds(w.deps, { projectId: w.projectId, todoIds: [w.todoId], triggerSource: 'chief' }),
    ).toThrow(/parked/i);
    await expect(
      sendBuildSteer(w.deps, w.buildId, { content: 'retry' }, { afterTurn: true, human: false }),
    ).rejects.toThrow(/parked/i);
    await expect(
      applyBuildStepAction(
        w.deps,
        w.buildId,
        { action: 'restart', feedback: '', clientMessageId: 'retry' },
        'cairn',
        'automatic',
      ),
    ).rejects.toThrow(/parked/i);
    expect(buildCount(w)).toBe(1);
  });

  test('parking a watched model rejection emits a notice and exactly one Coordinator failure wake', () => {
    const w = openWorld();
    const thread = coordinatorThreadRow(w.deps, ensureChief(w.deps, w.s.team.id));
    addChiefWatch(w.deps, {
      teamId: w.s.team.id,
      todo: getTodo(w.deps, w.todoId)!,
      projectName: 'Test project',
      threadId: thread.id,
    });
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    applyStepFailure(w.deps, row, 'model_not_found: glm-5.3');
    const wakes = w.s.db.select().from(stepTable).where(eq(stepTable.buildId, thread.id)).all();
    expect(wakes.map((wake) => wake.prompt?.split(']')[0])).toEqual(['[wake:failed']);
    expect(
      w.s.db
        .select()
        .from(chiefMessage)
        .where(eq(chiefMessage.threadId, thread.id))
        .all()
        .some((notice) => String(notice.content).includes('glm-5.3')),
    ).toBe(true);
  });

  test('automatic queued-message delivery cannot reopen a parked build after pending peers stop', async () => {
    const w = openWorld();
    await queueTaskMessage(w.deps, w.buildId, 'Continue after stop', true);
    w.s.db
      .insert(stepTable)
      .values({
        id: 'pending-peer',
        buildId: w.buildId,
        kind: 'review',
        status: 'pending',
        createdAt: nowMs(),
      })
      .run();
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    applyStepFailure(w.deps, row, 'model_not_found: glm-5.3');
    await drainTaskMessageQueue(w.deps, w.buildId);
    expect(phaseOf(w)).toBe('failed');
    expect(
      w.s.db.select().from(stepTable).where(eq(stepTable.buildId, w.buildId)).all(),
    ).toHaveLength(2);
    const reason = w.s.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.id, w.buildId))
      .get()?.errorMessage;
    expect(reason).toContain('Task parked');
    expect(readQueuedMessages(w.s.db, w.buildId)[0]?.error).toBe(reason);
  });

  test.each(['failure', 'success', 'stop'] as const)(
    'a claimed sibling %s cannot replace parking or advance the task',
    async (outcome) => {
      const w = openWorld();
      w.s.db
        .insert(stepTable)
        .values({
          id: 'claimed-sibling',
          buildId: w.buildId,
          kind: 'session',
          status: 'claimed',
          createdAt: nowMs(),
        })
        .run();
      const first = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
      applyStepFailure(w.deps, first, 'model_not_found: glm-5.3');
      const reason = w.s.db
        .select()
        .from(buildTable)
        .where(eq(buildTable.id, w.buildId))
        .get()?.errorMessage;
      const sibling = w.s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.id, 'claimed-sibling'))
        .get()!;
      if (outcome === 'failure') applyStepFailure(w.deps, sibling, 'connection reset');
      else if (outcome === 'success') completeStep(w.deps, sibling.id, { hasChanges: true });
      else applyStoppedStep(w.deps, sibling.id);
      await sweepFailedRetries(w.deps);
      expect(phaseOf(w)).toBe('failed');
      expect(buildCount(w)).toBe(1);
      expect(
        w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()?.errorMessage,
      ).toBe(reason);
    },
  );

  test.each(['restart', 'continuation'] as const)(
    'a human %s waits for claimed siblings before reusing a parked build',
    async (action) => {
      const w = openWorld();
      w.s.db
        .insert(stepTable)
        .values({
          id: 'old-claimed-sibling',
          buildId: w.buildId,
          kind: 'session',
          status: 'claimed',
          createdAt: nowMs(),
        })
        .run();
      w.s.db
        .update(stepTable)
        .set({ checkpointCommit: 'a'.repeat(40) })
        .where(eq(stepTable.id, w.stepId))
        .run();
      const first = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
      applyStepFailure(w.deps, first, 'model_not_found: glm-5.3');
      const retry = () =>
        action === 'restart'
          ? applyBuildStepAction(
              w.deps,
              w.buildId,
              { action: 'restart', feedback: 'Routing repaired', clientMessageId: 'person-retry' },
              'Owner',
              'person',
            )
          : sendBuildSteer(
              w.deps,
              w.buildId,
              { content: 'Routing repaired', clientMessageId: 'person-continue' },
              { human: true, afterTurn: true },
            );
      await expect(retry()).rejects.toThrow(/active steps/i);
      expect(phaseOf(w)).toBe('failed');
      expect(
        w.s.db.select().from(stepTable).where(eq(stepTable.buildId, w.buildId)).all(),
      ).toHaveLength(2);
      const sibling = w.s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.id, 'old-claimed-sibling'))
        .get()!;
      applyStepFailure(w.deps, sibling, 'connection reset');
      await retry();
      expect(phaseOf(w)).toBe('queued');
      expect(
        w.s.db.select().from(stepTable).where(eq(stepTable.buildId, w.buildId)).all(),
      ).toHaveLength(3);
      expect(
        w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()?.errorMessage,
      ).toBeNull();
    },
  );

  test('human recovery checks the actual older PR build before reusing it', async () => {
    const w = openWorld();
    w.s.db.update(buildTable).set({ prNumber: 42 }).where(eq(buildTable.id, w.buildId)).run();
    w.s.db
      .insert(stepTable)
      .values({
        id: 'older-pr-sibling',
        buildId: w.buildId,
        kind: 'session',
        status: 'claimed',
        createdAt: nowMs(),
      })
      .run();
    const first = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    applyStepFailure(w.deps, first, 'model_not_found: glm-5.3');
    const [next] = startBuilds(w.deps, {
      projectId: w.projectId,
      todoIds: [w.todoId],
      triggerSource: 'user',
    });
    const nextStep = w.s.db.select().from(stepTable).where(eq(stepTable.buildId, next!.id)).get()!;
    applyStepFailure(w.deps, nextStep, 'model_not_found: glm-5.3');
    await expect(
      applyBuildStepAction(
        w.deps,
        next!.id,
        { action: 'restart', feedback: 'Routing repaired', clientMessageId: 'older-pr-retry' },
        'Owner',
        'person',
      ),
    ).rejects.toThrow(/active steps/i);
    expect(
      w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.latestBuildId,
    ).toBe(next!.id);
    expect(
      w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()?.errorMessage,
    ).toContain('Task parked');
  });

  test('concurrent human recoveries create one worker on a reused build', async () => {
    const w = openWorld();
    w.s.db
      .update(stepTable)
      .set({ checkpointCommit: 'a'.repeat(40) })
      .where(eq(stepTable.id, w.stepId))
      .run();
    const first = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    applyStepFailure(w.deps, first, 'model_not_found: glm-5.3');
    const outcomes = await Promise.allSettled(
      ['one', 'two'].map((id) =>
        applyBuildStepAction(
          w.deps,
          w.buildId,
          { action: 'restart', feedback: 'Routing repaired', clientMessageId: `concurrent-${id}` },
          'Owner',
          'person',
        ),
      ),
    );
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      w.s.db.select().from(stepTable).where(eq(stepTable.buildId, w.buildId)).all(),
    ).toHaveLength(2);
    expect(phaseOf(w)).toBe('queued');
  });

  test('an automatic same-build enqueue cannot bypass model parking', () => {
    const w = openWorld();
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    applyStepFailure(w.deps, row, 'model_not_found: glm-5.3');
    expect(() => enqueueStep(w.deps, w.buildId, 'session', w.s.team.id, 'retry')).toThrow(
      /parked/i,
    );
    expect(
      w.s.db.select().from(stepTable).where(eq(stepTable.buildId, w.buildId)).all(),
    ).toHaveLength(1);
  });

  test('four failed builds in a rolling hour park further automatic dispatch', async () => {
    const w = openWorld();
    const at = nowMs();
    for (let i = 0; i < 3; i++) {
      w.s.db
        .insert(buildTable)
        .values({
          id: `prior-${i}`,
          todoId: w.todoId,
          withPlan: false,
          triggerSource: 'user',
          createdAt: at - 1000 * (i + 1),
          errorMessage: 'connection reset',
        })
        .run();
      w.s.db
        .insert(stepTable)
        .values({
          id: `prior-step-${i}`,
          buildId: `prior-${i}`,
          kind: 'session',
          status: 'failed',
          finishedAt: at - 1000 * (i + 1),
          createdAt: at - 1000 * (i + 1),
        })
        .run();
    }
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    applyStepFailure(w.deps, row, 'connection reset');
    const reason = w.s.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.id, w.buildId))
      .get()?.errorMessage;
    expect(reason).toMatch(/parked.*4 failed builds/i);
    parkFailedBuild(w.deps, w.buildId);
    parkFailedBuild(w.deps, w.buildId);
    expect(
      w.s.db
        .select()
        .from(message)
        .where(eq(message.id, `retry-parked-${w.buildId}`))
        .all(),
    ).toHaveLength(1);
    const notices = w.s.db
      .select()
      .from(chiefMessage)
      .all()
      .filter((notice) => notice.id.startsWith(`retry-parked-${w.buildId}-`));
    expect(notices).toHaveLength(1);
    expect(notices[0]?.content).toContain('4 failed builds');
    expect(
      chiefNoticeContentSchema.parse(JSON.parse(String(notices[0]?.content))).message,
    ).toContain('4 failed builds');
    await sweepFailedRetries(w.deps);
    expect(buildCount(w)).toBe(4);
    expect(getTodo(w.deps, w.todoId)?.owner).toBe('coordinator');
    expect(() =>
      startBuilds(w.deps, { projectId: w.projectId, todoIds: [w.todoId], triggerSource: 'chief' }),
    ).toThrow(/parked/i);
  });
  test('a failed Coordinator notice write rolls back the parking receipt so it can be retried', () => {
    const w = openWorld();
    w.s.db
      .update(buildTable)
      .set({ errorMessage: 'model_not_found: glm-5.3' })
      .where(eq(buildTable.id, w.buildId))
      .run();
    w.s.db.run(
      sql.raw(
        "CREATE TRIGGER reject_retry_notice BEFORE INSERT ON chief_message BEGIN SELECT RAISE(ABORT, 'synthetic notice write failure'); END",
      ),
    );
    expect(() => parkFailedBuild(w.deps, w.buildId)).toThrow('synthetic notice write failure');
    expect(
      w.s.db
        .select()
        .from(message)
        .where(eq(message.id, `retry-parked-${w.buildId}`))
        .all(),
    ).toHaveLength(0);
    w.s.db.run(sql.raw('DROP TRIGGER reject_retry_notice'));
    expect(parkFailedBuild(w.deps, w.buildId)).toBe(true);
    expect(w.s.db.select().from(chiefMessage).all()).toHaveLength(1);
  });

  test('legacy failed steps without finishedAt still count toward the breaker', () => {
    const w = openWorld();
    const now = nowMs();
    w.s.db
      .update(buildTable)
      .set({ errorMessage: 'connection reset' })
      .where(eq(buildTable.id, w.buildId))
      .run();
    w.s.db.update(stepTable).set({ status: 'failed' }).where(eq(stepTable.id, w.stepId)).run();
    for (let i = 0; i < 3; i++) {
      w.s.db
        .insert(buildTable)
        .values({
          id: `legacy-${i}`,
          todoId: w.todoId,
          withPlan: false,
          triggerSource: 'user',
          errorMessage: 'connection reset',
          createdAt: now - 1000,
        })
        .run();
      w.s.db
        .insert(stepTable)
        .values({
          id: `legacy-step-${i}`,
          buildId: `legacy-${i}`,
          kind: 'session',
          status: 'failed',
          createdAt: now - 1000,
        })
        .run();
    }
    expect(parkFailedBuild(w.deps, w.buildId, now)).toBe(true);
  });

  test.each([2, 3, 4])(
    'rolling-hour breaker counts distinct failed builds, not steps: %s',
    (count) => {
      const w = openWorld();
      const now = nowMs();
      w.s.db
        .update(buildTable)
        .set({ errorMessage: 'connection reset' })
        .where(eq(buildTable.id, w.buildId))
        .run();
      w.s.db
        .update(stepTable)
        .set({ status: 'failed', finishedAt: now })
        .where(eq(stepTable.id, w.stepId))
        .run();
      for (let i = 1; i < count; i++) {
        w.s.db
          .insert(buildTable)
          .values({
            id: `window-${i}`,
            todoId: w.todoId,
            withPlan: false,
            triggerSource: 'user',
            errorMessage: 'connection reset',
            createdAt: now - i,
          })
          .run();
        w.s.db
          .insert(stepTable)
          .values({
            id: `window-step-${i}`,
            buildId: `window-${i}`,
            kind: 'session',
            status: 'failed',
            finishedAt: now - i,
            createdAt: now - i,
          })
          .run();
      }
      w.s.db
        .insert(stepTable)
        .values({
          id: 'same-build',
          buildId: w.buildId,
          kind: 'build',
          status: 'failed',
          finishedAt: now,
          createdAt: now,
        })
        .run();
      w.s.db
        .insert(buildTable)
        .values({
          id: 'expired-build',
          todoId: w.todoId,
          withPlan: false,
          triggerSource: 'user',
          errorMessage: 'connection reset',
          createdAt: now - 3_600_000,
        })
        .run();
      w.s.db
        .insert(stepTable)
        .values({
          id: 'expired-step',
          buildId: 'expired-build',
          kind: 'session',
          status: 'failed',
          finishedAt: now - 3_600_000,
          createdAt: now - 3_600_000,
        })
        .run();
      expect(parkFailedBuild(w.deps, w.buildId, now)).toBe(count > 3);
      expect(parkFailedBuild(w.deps, w.buildId, now + 3_600_001)).toBe(count > 3);
    },
  );

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
      .find((row) => row.kind === 'session');
    if (retried === undefined) throw new Error('missing retry step');
    expect(retried.byPerson).toBe(false);
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
    expect(getTodo(w.deps, w.todoId)?.owner).toBe('coordinator');
    expect(groups(w).stale).toEqual([]);
  });

  test('a gate rejection is not retried and enters the current group', async () => {
    const w = openWorld();
    completeStep(w.deps, w.stepId, {
      hasChanges: true,
      workBranchDrift: { expected: 'cairn/conv-1', actual: 'main' },
    });
    const builds = buildCount(w);
    await sweepFailedRetries(w.deps);

    expect(phaseOf(w)).toBe('failed');
    expect(buildCount(w)).toBe(builds);
    expect(getTodo(w.deps, w.todoId)?.owner).toBe('coordinator');
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
    expect(getTodo(w.deps, w.todoId)?.owner).toBe('coordinator');
  });

  test.each([
    ['machine login', claudeCodeAuthFailureMessage('daemon-test')],
    ['team subscription', claudeCodeTeamSubscriptionAuthFailureMessage('credential rejected')],
    ['raw CLI', 'Failed to authenticate: OAuth token revoked'],
    ['ordinary failure', 'build failed: test assertion failed'],
  ])('the retry sweep only restarts ordinary failures: %s', async (kind, errorMessage) => {
    const w = openWorld();
    const step = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get();
    if (step === undefined) throw new Error('missing step');
    applyStepFailure(w.deps, step, errorMessage);
    expect(phaseOf(w)).toBe('failed');
    expect(
      w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()?.errorMessage,
    ).toBe(errorMessage);
    const needsHuman = kind !== 'ordinary failure';

    await sweepFailedRetries(w.deps);

    expect(phaseOf(w)).toBe(needsHuman ? 'failed' : 'queued');
    expect(buildCount(w)).toBe(needsHuman ? 1 : 2);
    expect(failureNeedsHuman(errorMessage)).toBe(needsHuman);
    expect(getTodo(w.deps, w.todoId)?.owner).toBe(needsHuman ? 'coordinator' : null);
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

  test('a transient failure of a scheduled continuation is not retried and enters the current group', async () => {
    const w = openWorld();
    w.s.db
      .update(stepTable)
      .set({ scheduleId: 'once', scheduledBy: w.s.user.id })
      .where(eq(stepTable.id, w.stepId))
      .run();
    w.s.db.update(buildTable).set({ prevPhase: 'done' }).where(eq(buildTable.id, w.buildId)).run();
    const step = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get();
    if (step === undefined) throw new Error('missing step');
    applyStepFailure(w.deps, step, 'connection reset by peer');
    const builds = buildCount(w);
    await sweepFailedRetries(w.deps);

    expect(phaseOf(w)).toBe('failed');
    expect(buildCount(w)).toBe(builds);
    expect(getTodo(w.deps, w.todoId)?.owner).toBe('coordinator');
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
