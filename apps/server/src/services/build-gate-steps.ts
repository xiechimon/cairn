import {
  ACTIVE_STEP_STATUSES,
  hasBlockingFinding,
  isActiveStepStatus,
  isBuildStepKind,
  type MachineDoneBody,
  REVIEW_VERDICT_KIND,
  VERIFY_VERDICT_KIND,
} from '@cairn/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { build, message, step, stopPending, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { persistGateVerdict, reportedVerdictHeads } from './build-gate-verdict.js';
import { landReservedPhase, settleAfterStopPhase } from './build-stop.js';
import type { BuildDeps, CompleteStepOutcome } from './builds.js';
import { publishStepRow } from './quota-wait.js';
import { finishScheduledStep } from './schedules.js';
import { setTodoPhase } from './todos.js';
import { insertMessageRow } from './transcript.js';
import { pendingWorkerQuestions } from './worker-question-store.js';

export function settleRetiredGateStep(
  deps: BuildDeps,
  row: typeof step.$inferSelect,
  outcome?: Omit<CompleteStepOutcome, 'deliverables'> &
    Partial<Pick<MachineDoneBody, 'status' | 'errorMessage' | 'commit' | 'gateHeadSha'>>,
): boolean {
  if (row.kind !== 'review' && row.kind !== 'verify') return false;
  const finishedAt = row.finishedAt ?? nowMs();
  deps.db
    .update(step)
    .set({ status: 'stopped', finishedAt, archiveStop: null })
    .where(eq(step.id, row.id))
    .run();
  deps.db.delete(stopPending).where(eq(stopPending.stepId, row.id)).run();
  finishScheduledStep(deps, row, { status: 'stopped' });
  publishStepRow(deps, { ...row, status: 'stopped', finishedAt, archiveStop: null });
  const id = `retired-gate-report-${row.id}`;
  if (
    outcome !== undefined &&
    deps.db.select({ id: message.id }).from(message).where(eq(message.id, id)).get() === undefined
  ) {
    persistGateVerdict(deps, row, {
      stepFailed: outcome.status === 'failed' || outcome.errorMessage !== undefined,
      extracted:
        row.kind === 'review'
          ? outcome.findings !== undefined
          : outcome.verifyVerdict !== undefined,
      blocked:
        row.kind === 'review'
          ? outcome.findings !== undefined && hasBlockingFinding(outcome.findings)
          : outcome.verifyVerdict?.passed === false,
      report: outcome.verdictReport ?? reportedVerdictHeads(row, outcome),
    });
    const verdict = row.kind === 'review' ? outcome.findings : outcome.verifyVerdict;
    insertMessageRow(deps, row.buildId, {
      id,
      role: 'system',
      content:
        verdict === undefined
          ? `Retired ${row.kind} step reported: ${outcome.errorMessage ?? outcome.findingsError ?? outcome.verifyVerdictError ?? 'completed'}. The delivered result is unchanged.`
          : JSON.stringify({
              kind: row.kind === 'review' ? REVIEW_VERDICT_KIND : VERIFY_VERDICT_KIND,
              stepId: row.id,
              verdict,
              retired: true,
            }),
      createdAt: finishedAt,
    });
  }
  return true;
}

export function retireMergeGateSteps(deps: BuildDeps): void {
  const rows = deps.db
    .select({ stepRow: step, teamId: todo.teamId })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(
      and(
        inArray(step.kind, ['review', 'verify']),
        inArray(step.status, [...ACTIVE_STEP_STATUSES]),
      ),
    )
    .all();
  for (const { stepRow, teamId } of rows) {
    if (stepRow.status !== 'claimed') settleRetiredGateStep(deps, stepRow);
    else if (stepRow.archiveStop !== 'acknowledged') {
      deps.db.update(step).set({ archiveStop: 'requested' }).where(eq(step.id, stepRow.id)).run();
      deps.machineHub?.stopSignal(teamId, stepRow.id);
    }
  }
  const stalled = deps.db
    .select({ task: todo, run: build })
    .from(todo)
    .innerJoin(build, eq(todo.latestBuildId, build.id))
    .where(
      and(
        inArray(todo.phase, ['building', 'review', 'confirm']),
        isNull(todo.archivedAt),
        isNull(build.errorMessage),
      ),
    )
    .all();
  for (const { task, run } of stalled) {
    if (run.afterStopPhase === 'keep') continue;
    if (run.afterStopPhase === null && task.phase !== 'building') continue;
    const steps = deps.db.select().from(step).where(eq(step.buildId, run.id)).all();
    if (!steps.some((s) => s.kind === 'review' || s.kind === 'verify')) continue;
    const execution = steps
      .filter((s) => s.kind === 'plan' || isBuildStepKind(s.kind))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!execution || !isBuildStepKind(execution.kind) || execution.status !== 'done') continue;
    if (
      steps.some((s) => s.kind !== 'review' && s.kind !== 'verify' && isActiveStepStatus(s.status))
    )
      continue;
    if (run.afterStopPhase === 'done') {
      settleAfterStopPhase(deps, run.id, () => landReservedPhase(deps, task, 'done'));
      continue;
    }
    if (pendingWorkerQuestions(deps.db, run.id).length > 0) continue;
    setTodoPhase(deps, task.id, 'review');
  }
}
