import type { Phase } from '@cairn/shared';
import {
  ACTIVE_STEP_STATUSES,
  backgroundTaskMessageId,
  NOTHING_TO_STOP,
  STOP_MESSAGE,
  type StopAttribution,
  TASK_COMPUTER_OFFLINE,
  UNSTARTED_STEP_STATUSES,
} from '@cairn/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { runAfterCommit } from '../db/commit-effects.js';
import {
  build,
  message,
  queuedMessage,
  steerPending,
  step,
  stopPending,
  todo,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { emitRuntimeBuildSpan } from '../runtime-otel.js';
import { settleAutonomousMerge } from './autonomous-merge.js';
import { type BuildDeps, NotFoundError, publishBuild, settleParkedStep } from './builds.js';
import { isClaimedStepDead } from './dispatch-timeouts.js';
import { announceMergeStepOutcome } from './merge-announcement.js';
import { canStopTransitionPhase, stopReturnPhase } from './phase.js';
import { publishStepRow } from './quota-wait.js';
import { finishScheduledStep } from './schedules.js';
import { setTodoPhase, settleSplitOnDone } from './todos.js';

type BuildRow = typeof build.$inferSelect;

function recordStop(db: Db, buildId: string, by: StopAttribution): void {
  db.update(build)
    .set({ stop: { ...by, at: nowMs() } })
    .where(eq(build.id, buildId))
    .run();
}

export function hasLeftExecution(phase: Phase): boolean {
  return phase === 'closed' || phase === 'done' || phase === 'todo' || phase === 'stopped';
}

export function settleAfterStopPhase(deps: BuildDeps, buildId: string, land?: () => void): void {
  deps.db.transaction(() => {
    deps.db.update(build).set({ afterStopPhase: null }).where(eq(build.id, buildId)).run();
    land?.();
  });
}

export function landReservedPhase(
  deps: BuildDeps,
  todoRow: typeof todo.$inferSelect,
  desired: Phase,
): void {
  if (todoRow.phase === desired) {
    if (desired === 'done') settleSplitOnDone(deps, todoRow.id);
    return;
  }
  if (!canStopTransitionPhase(todoRow.phase, desired)) return;
  setTodoPhase(deps, todoRow.id, desired, {}, { cause: 'stop' });
}

export function requestStop(
  deps: BuildDeps,
  buildId: string,
  body: { discard: boolean },
  by: StopAttribution,
): { delegated: boolean } {
  const { db } = deps;
  const buildRow = db.select().from(build).where(eq(build.id, buildId)).get();
  if (!buildRow) throw new NotFoundError(`build ${buildId}`);
  const active = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildId), inArray(step.status, [...ACTIVE_STEP_STATUSES])))
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (!active) {
    throw new HttpError(
      409,
      'no active step on this build (stop 只对运行中的任务生效)',
      NOTHING_TO_STOP,
    );
  }
  recordStop(db, buildId, by);
  if (active.status === 'pending' || active.status === 'waiting_quota') {
    applyStoppedStep(deps, active.id);
    return { delegated: false };
  }
  const now = nowMs();
  db.insert(stopPending)
    .values({ conversationId: buildId, stepId: active.id, discard: body.discard, createdAt: now })
    .onConflictDoUpdate({
      target: stopPending.conversationId,
      set: { stepId: active.id, discard: body.discard, createdAt: now },
    })
    .run();
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow) deps.machineHub?.stopSignal(todoRow.teamId, active.id);
  return { delegated: true };
}

export function requestBackgroundTaskStop(deps: BuildDeps, buildId: string, taskId: string): void {
  const active = deps.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildId), eq(step.status, 'claimed')))
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (active?.machineId == null)
    throw new HttpError(409, 'no running step on this build', NOTHING_TO_STOP);
  const row = deps.db
    .select({ content: message.content })
    .from(message)
    .where(eq(message.id, backgroundTaskMessageId(active.id, taskId)))
    .get();
  if ((row?.content as { task?: { status?: string } } | undefined)?.task?.status !== 'running')
    throw new HttpError(409, 'background task is not running', NOTHING_TO_STOP);
  if (deps.machineHub?.pushTaskStop(active.machineId, active.id, taskId) !== true)
    throw new HttpError(
      409,
      'the computer running this task is not connected',
      TASK_COMPUTER_OFFLINE,
    );
}

function stopFallbackPhase(db: Db, buildRow: BuildRow): Phase {
  const lastDone = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildRow.id), eq(step.status, 'done')))
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  return stopReturnPhase(lastDone?.kind ?? null, buildRow.prevPhase);
}

function landStopPhase(deps: BuildDeps, todoRow: typeof todo.$inferSelect, buildRow: BuildRow) {
  const target = stopFallbackPhase(deps.db, buildRow);
  if (todoRow.phase === target) return;
  setTodoPhase(deps, todoRow.id, target, {}, { cause: 'stop' });
}

export function releaseUnissuedMergeAdmission(db: Db, row: typeof step.$inferSelect): void {
  if (row.kind !== 'merge') return;
  if (row.prompt?.includes('"local-merge"') && (row.status === 'claimed' || row.claimedAt !== null))
    return;
  settleAutonomousMerge(db, row.buildId, 'refused');
}

export function applyStoppedStep(deps: BuildDeps, stepId: string): void {
  const { db } = deps;
  const stepRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow) throw new NotFoundError(`step ${stepId}`);
  if (settleParkedStep(deps, stepRow, { status: 'stopped' })) return;
  releaseUnissuedMergeAdmission(db, stepRow);
  db.update(step)
    .set({ status: 'stopped', finishedAt: nowMs(), archiveStop: null })
    .where(eq(step.id, stepId))
    .run();
  finishScheduledStep(deps, stepRow, { status: 'stopped' });
  db.delete(stopPending).where(eq(stopPending.stepId, stepId)).run();
  const stoppedRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (stoppedRow) publishStepRow(deps, stoppedRow);
  const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return;
  if (stepRow.kind === 'merge')
    announceMergeStepOutcome(deps, {
      stepId,
      buildId: buildRow.id,
      text: '合并没有完成：合并步被停止。',
    });
  db.update(build).set({ errorMessage: STOP_MESSAGE }).where(eq(build.id, buildRow.id)).run();
  const cancelledRow = db.select().from(build).where(eq(build.id, buildRow.id)).get();
  if (cancelledRow) publishBuild(deps, cancelledRow);
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) return;
  const desired = buildRow.afterStopPhase;
  if (desired === 'done') {
    settleAfterStopPhase(deps, buildRow.id, () => landReservedPhase(deps, todoRow, 'done'));
    return;
  }
  settleAfterStopPhase(deps, buildRow.id);
  if (stepRow.archiveStop === null && desired === 'keep') return;
  if (todoRow.latestBuildId !== buildRow.id || hasLeftExecution(todoRow.phase)) return;
  if (continuesAfterStop(db, buildRow.id)) return;
  landStopPhase(deps, todoRow, buildRow);
}

function continuesAfterStop(db: Db, buildId: string): boolean {
  return (
    db
      .select({ id: queuedMessage.id })
      .from(queuedMessage)
      .where(
        and(
          eq(queuedMessage.conversationId, buildId),
          eq(queuedMessage.deliverAfterStop, true),
          isNull(queuedMessage.error),
        ),
      )
      .get() !== undefined
  );
}

export function releaseZombieQueued(
  deps: BuildDeps,
  buildRow: BuildRow,
  todoRow: typeof todo.$inferSelect,
  by: StopAttribution,
): void {
  const { db } = deps;
  if (todoRow.archivedAt !== null || todoRow.phase !== 'queued') return;
  recordStop(db, buildRow.id, by);
  if (buildRow.errorMessage === null) {
    db.update(build).set({ errorMessage: STOP_MESSAGE }).where(eq(build.id, buildRow.id)).run();
  }
  const fresh = db.select().from(build).where(eq(build.id, buildRow.id)).get();
  if (fresh) publishBuild(deps, fresh);
  landStopPhase(deps, todoRow, buildRow);
}

export function cancelBuild(
  deps: BuildDeps,
  buildId: string,
  by: StopAttribution,
): 'stopped' | 'delegated' | 'released' | 'not-found' {
  const { db } = deps;
  const buildRow = db.select().from(build).where(eq(build.id, buildId)).get();
  if (!buildRow) return 'not-found';
  const active = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildId), inArray(step.status, [...ACTIVE_STEP_STATUSES])))
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (!active) {
    const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (!todoRow) return 'released';
    releaseZombieQueued(deps, buildRow, todoRow, by);
    return 'released';
  }
  recordStop(db, buildId, by);
  if (active.status === 'pending' || active.status === 'waiting_quota') {
    applyStoppedStep(deps, active.id);
    runAfterCommit(deps, 'emitRuntimeBuildSpan', () =>
      emitRuntimeBuildSpan(deps.db, buildId, 'cancelled'),
    );
    return 'stopped';
  }
  const now = nowMs();
  db.insert(stopPending)
    .values({ conversationId: buildId, stepId: active.id, discard: true, createdAt: now })
    .onConflictDoUpdate({
      target: stopPending.conversationId,
      set: { stepId: active.id, discard: true, createdAt: now },
    })
    .run();
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow) deps.machineHub?.stopSignal(todoRow.teamId, active.id);
  runAfterCommit(deps, 'emitRuntimeBuildSpan', () =>
    emitRuntimeBuildSpan(deps.db, buildId, 'cancelled'),
  );
  return 'delegated';
}

export function stopStepKeepPhase(deps: BuildDeps, stepId: string): void {
  const { db } = deps;
  const stepRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow) throw new NotFoundError(`step ${stepId}`);
  if (stepRow.archiveStop !== null) {
    applyStoppedStep(deps, stepId);
    return;
  }
  releaseUnissuedMergeAdmission(db, stepRow);
  db.update(step)
    .set({ status: 'stopped', finishedAt: nowMs(), archiveStop: null })
    .where(eq(step.id, stepId))
    .run();
  finishScheduledStep(deps, stepRow, { status: 'stopped' });
  db.delete(stopPending).where(eq(stopPending.stepId, stepId)).run();
  const stoppedRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (stoppedRow) publishStepRow(deps, stoppedRow);
  const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return;
  if (stepRow.kind === 'merge')
    announceMergeStepOutcome(deps, {
      stepId,
      buildId: buildRow.id,
      text: '合并没有完成：合并步被停止。',
    });
  db.update(build).set({ errorMessage: STOP_MESSAGE }).where(eq(build.id, buildRow.id)).run();
  const cancelledRow = db.select().from(build).where(eq(build.id, buildRow.id)).get();
  if (cancelledRow) publishBuild(deps, cancelledRow);
}

export function endDeadBuildTurn(deps: BuildDeps, buildId: string, now: number = nowMs()): boolean {
  const head = deps.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildId), eq(step.status, 'claimed')))
    .orderBy(asc(step.createdAt), sql`rowid`)
    .all()
    .at(-1);
  if (head === undefined || !isClaimedStepDead(deps.db, deps.machineHub, head, now)) return false;
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!buildRow) return false;
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (
    !todoRow ||
    todoRow.archivedAt !== null ||
    todoRow.latestBuildId !== buildId ||
    todoRow.phase === 'closed'
  ) {
    return false;
  }
  stopStepKeepPhase(deps, head.id);
  deps.db
    .delete(steerPending)
    .where(and(eq(steerPending.conversationId, buildId), eq(steerPending.stepId, head.id)))
    .run();
  deps.machineHub?.stopSignal(todoRow.teamId, head.id);
  deps.machineHub?.wake(todoRow.teamId);
  return true;
}

export function stopUnclaimedGateSteps(
  deps: BuildDeps,
  buildId: string,
): (typeof step.$inferSelect)['kind'][] {
  const rows = deps.db
    .select()
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        inArray(step.status, [...UNSTARTED_STEP_STATUSES]),
        inArray(step.kind, ['verify', 'review']),
      ),
    )
    .all();
  for (const row of rows) {
    const finishedAt = nowMs();
    deps.db.update(step).set({ status: 'stopped', finishedAt }).where(eq(step.id, row.id)).run();
    finishScheduledStep(deps, row, { status: 'stopped' });
    publishStepRow(deps, { ...row, status: 'stopped', finishedAt });
  }
  return rows.map((r) => r.kind);
}

export type StopAndMarkDoneResult = { state: 'ready' } | { state: 'stopping' };

export function prepareStopForDone(
  deps: BuildDeps,
  todoId: string,
  by: StopAttribution,
): StopAndMarkDoneResult {
  return prepareStopFor(deps, todoId, 'done', by);
}

export function stopActiveStepsAfterExit(
  deps: BuildDeps,
  todoId: string,
  by: StopAttribution,
): void {
  prepareStopFor(deps, todoId, 'exit', by);
}

export function stopActiveStepsForArchive(
  deps: BuildDeps,
  todoId: string,
  by: StopAttribution,
): void {
  const rows = deps.db
    .select({ stepRow: step, teamId: todo.teamId })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(and(eq(todo.id, todoId), inArray(step.status, [...ACTIVE_STEP_STATUSES])))
    .all();
  for (const buildId of new Set(rows.map((r) => r.stepRow.buildId)))
    recordStop(deps.db, buildId, by);
  for (const { stepRow, teamId } of rows) {
    deps.db.update(step).set({ archiveStop: 'requested' }).where(eq(step.id, stepRow.id)).run();
    deps.db.delete(stopPending).where(eq(stopPending.stepId, stepRow.id)).run();
    if (stepRow.status !== 'claimed') applyStoppedStep(deps, stepRow.id);
    else deps.machineHub?.stopSignal(teamId, stepRow.id);
  }
}

function prepareStopFor(
  deps: BuildDeps,
  todoId: string,
  after: 'done' | 'exit',
  by: StopAttribution,
): StopAndMarkDoneResult {
  const { db } = deps;
  const todoRow = db.select().from(todo).where(eq(todo.id, todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${todoId}`);
  if (todoRow.latestBuildId == null) return { state: 'ready' };
  const buildId = todoRow.latestBuildId;
  if (after === 'exit') settleAfterStopPhase(deps, buildId);
  const active = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildId), inArray(step.status, [...ACTIVE_STEP_STATUSES])))
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (!active) return { state: 'ready' };
  recordStop(db, buildId, by);
  if (active.status === 'pending' || active.status === 'waiting_quota') {
    stopStepKeepPhase(deps, active.id);
    return { state: 'ready' };
  }
  const now = nowMs();
  db.transaction(() => {
    db.update(build)
      .set({ afterStopPhase: after === 'done' ? 'done' : 'keep' })
      .where(eq(build.id, buildId))
      .run();
    db.insert(stopPending)
      .values({ conversationId: buildId, stepId: active.id, discard: true, createdAt: now })
      .onConflictDoUpdate({
        target: stopPending.conversationId,
        set: { stepId: active.id, discard: true, createdAt: now },
      })
      .run();
  });
  deps.machineHub?.stopSignal(todoRow.teamId, active.id);
  return { state: 'stopping' };
}
