import type { MachineDoneBody } from '@cairn/shared';
import { buildFailureRowContent, isBuildStepKind } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { build, message, plan as planTable, step, stopPending, todo } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { emitRuntimeBuildSpan } from '../runtime-otel.js';
import {
  persistGateVerdict,
  reportedVerdictHeads,
  type VerdictReport,
} from './build-gate-verdict.js';
import {
  applyStoppedStep,
  releaseUnissuedMergeAdmission,
  settleAfterStopPhase,
} from './build-stop.js';
import { type BuildDeps, clearStop, publishBuild } from './builds.js';
import { canTransitionPhase } from './phase.js';
import { publishStepRow } from './quota-wait.js';
import { parkFailedBuild, retryIsParked } from './retry-parking.js';
import { finishScheduledStep } from './schedules.js';
import { setTodoPhase } from './todos.js';
import { insertMessageRow } from './transcript.js';

export function noteDeliveredPlanResidual(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  reason: string,
): boolean {
  if (stepRow.kind !== 'plan') return false;
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return false;
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow?.phase !== 'confirm') return false;
  const planRow = deps.db
    .select({ id: planTable.id })
    .from(planTable)
    .where(eq(planTable.buildId, stepRow.buildId))
    .get();
  if (planRow === undefined) return false;
  const id = `plan-residual-${stepRow.id}`;
  const content = `Plan step ${stepRow.id} reported a failure after the plan was delivered and the confirm gate was parked: ${reason}. The delivered plan and the confirm gate are unchanged.`;
  const createdAt = nowMs();
  const inserted = deps.db
    .insert(message)
    .values({
      id,
      conversationId: stepRow.buildId,
      role: 'system',
      content,
      createdAt,
      actor: null,
    })
    .onConflictDoNothing()
    .run();
  if (inserted.changes > 0) {
    deps.convHub?.publishMessage(stepRow.buildId, {
      id,
      role: 'system',
      content,
      createdAt,
      actor: null,
    });
  }
  finishScheduledStep(deps, stepRow, { status: 'failed', error: reason });
  return true;
}

export function settleParkedStep(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  outcome: Pick<MachineDoneBody, 'status' | 'errorMessage'>,
): boolean {
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow || !retryIsParked(buildRow.errorMessage ?? '')) return false;
  parkFailedBuild(deps, buildRow.id);
  const owner = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (
    owner &&
    owner.latestBuildId === buildRow.id &&
    owner.archivedAt === null &&
    owner.phase !== 'failed' &&
    canTransitionPhase(owner.phase, 'failed')
  )
    setTodoPhase(deps, owner.id, 'failed');
  const status = outcome.status === 'success' ? 'done' : outcome.status;
  const finishedAt = nowMs();
  if (outcome.status !== 'success') releaseUnissuedMergeAdmission(deps.db, stepRow);
  deps.db
    .update(step)
    .set({ status, finishedAt, archiveStop: null })
    .where(eq(step.id, stepRow.id))
    .run();
  deps.db.delete(stopPending).where(eq(stopPending.stepId, stepRow.id)).run();
  settleAfterStopPhase(deps, stepRow.buildId);
  finishScheduledStep(
    deps,
    stepRow,
    outcome.status === 'failed'
      ? { status: 'failed', error: outcome.errorMessage ?? buildRow.errorMessage ?? 'Task parked' }
      : { status: outcome.status === 'success' ? 'completed' : 'stopped' },
  );
  publishStepRow(deps, { ...stepRow, status, finishedAt, archiveStop: null });
  return true;
}

export function applyStepFailure(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  rawErrorMessage: string,
  report?: VerdictReport,
  preservedCommits?: readonly string[],
): void {
  const { db } = deps;
  if (settleParkedStep(deps, stepRow, { status: 'failed', errorMessage: rawErrorMessage })) return;
  db.delete(stopPending).where(eq(stopPending.stepId, stepRow.id)).run();
  if (
    db.select({ archiveStop: step.archiveStop }).from(step).where(eq(step.id, stepRow.id)).get()
      ?.archiveStop != null
  ) {
    applyStoppedStep(deps, stepRow.id);
    return;
  }
  clearStop(db, stepRow.buildId);
  settleAfterStopPhase(deps, stepRow.buildId);
  releaseUnissuedMergeAdmission(db, stepRow);
  const errorMessage =
    rawErrorMessage.trim() === '' ? `${stepRow.kind} 步异常结束，未上报原因` : rawErrorMessage;
  db.update(step)
    .set({ status: 'failed', finishedAt: nowMs() })
    .where(eq(step.id, stepRow.id))
    .run();
  const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return;
  if (
    noteDeliveredPlanResidual(
      deps,
      stepRow,
      rawErrorMessage.trim() === '' ? 'no reason reported' : rawErrorMessage,
    )
  ) {
    return;
  }
  finishScheduledStep(deps, stepRow, { status: 'failed', error: errorMessage });
  db.update(build).set({ errorMessage }).where(eq(build.id, buildRow.id)).run();
  if (isBuildStepKind(stepRow.kind)) {
    const changes = buildRow.changes;
    const files =
      changes == null
        ? undefined
        : (Array.isArray(changes) ? changes : changes.files).map((f) => f.path);
    insertMessageRow(deps, buildRow.id, {
      id: newRecordId(),
      role: 'system',
      content: buildFailureRowContent({
        reason: errorMessage,
        ...(preservedCommits !== undefined ? { commits: preservedCommits } : {}),
        ...(files !== undefined ? { files } : {}),
        pr: buildRow.prNumber !== null ? { number: buildRow.prNumber, url: buildRow.prUrl } : null,
      }),
      createdAt: nowMs(),
    });
  }
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  const finished = db.select().from(step).where(eq(step.id, stepRow.id)).get();
  const failedStep = finished ?? stepRow;
  emitRuntimeBuildSpan(db, buildRow.id, 'failed');
  persistGateVerdict(deps, failedStep, {
    stepFailed: true,
    extracted: false,
    blocked: false,
    report: report ?? reportedVerdictHeads(failedStep, { commit: failedStep.checkpointCommit }),
  });
  parkFailedBuild(deps, buildRow.id);
  if (
    todoRow &&
    todoRow.latestBuildId === buildRow.id &&
    todoRow.archivedAt === null &&
    canTransitionPhase(todoRow.phase, 'failed')
  ) {
    setTodoPhase(deps, todoRow.id, 'failed');
  }
}

export function failStepWithEvents(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  reason: string,
): void {
  applyStepFailure(deps, stepRow, reason);
  const failedBuild = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (failedBuild) publishBuild(deps, failedBuild);
  const failedStep = deps.db.select().from(step).where(eq(step.id, stepRow.id)).get();
  if (failedStep) {
    deps.convHub?.publishStep(stepRow.buildId, {
      id: failedStep.id,
      buildId: failedStep.buildId,
      kind: failedStep.kind,
      machineId: failedStep.machineId,
      createdAt: failedStep.createdAt,
      status: failedStep.status,
      checkpointCommit: failedStep.checkpointCommit,
      skillInjection: failedStep.skillInjection ?? null,
    });
  }
}
