import type { ReviewVerdict } from '@cairn/shared';
import {
  ANSWERS_CONTINUE_PROMPT,
  buildPlanContractRewritePrompt,
  buildPlanRewritePrompt,
  isBuildStepKind,
  isInfoOutput,
  isPlanContractRewritePrompt,
  type PlanContractCheck,
  type TodoOutputKind,
  type VerifyVerdict,
} from '@cairn/shared';
import { and, eq, ne } from 'drizzle-orm';
import { runAfterCommit, withCommitEffects } from '../db/commit-effects.js';
import { build, plan as planTable, step, stopPending, todo } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { receivesAnswers, undeliveredAnswers } from './answer-delivery.js';
import { settleRetiredGateStep } from './build-gate-steps.js';
import type { VerdictReport } from './build-gate-verdict.js';
import {
  applyStoppedStep,
  hasLeftExecution,
  landReservedPhase,
  settleAfterStopPhase,
} from './build-stop.js';
import { askUndeliveredOnce, undeliveredEnd } from './build-undelivered.js';
import {
  applyStepFailure,
  type BuildDeps,
  clearStop,
  confirmPlanAutomatically,
  enqueueStep,
  finishTodoDone,
  githubPrOf,
  NotFoundError,
  publishBuild,
  settleParkedStep,
} from './builds.js';
import { storeInfoReport } from './info-handoff.js';
import {
  type DeliverableManifest,
  deliverableManifestFailure,
  publishDeliverables,
} from './machine-deliverables.js';
import {
  announceMergeStepOutcome,
  MERGE_LANDED_TEXT,
  MERGE_UNCONFIRMED_TEXT,
} from './merge-announcement.js';
import { assertPhaseTransition, canTransitionPhase } from './phase.js';
import { planAutoConfirmation, planContractOfStep } from './plan-auto-confirm.js';
import { finishScheduledStep } from './schedules.js';
import { noteTaskCodeDelivered, setTodoPhase } from './todos.js';
import { insertMessageRow } from './transcript.js';
import { blockingWorkerQuestions, pendingWorkerQuestions } from './worker-question-store.js';

const PLAN_REWRITE_PROMPT = buildPlanRewritePrompt();

function stepArtifactGate(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  outcome: {
    hasChanges?: boolean;
    workBranchDrift?: { expected: string; actual: string };
    report?: string;
    output?: TodoOutputKind;
    deliverables?: DeliverableManifest;
  },
  planContract: PlanContractCheck | null,
): string | null {
  if (stepRow.kind === 'plan') {
    const planRow = deps.db
      .select({ id: planTable.id })
      .from(planTable)
      .where(eq(planTable.buildId, stepRow.buildId))
      .get();
    if (planRow !== undefined) {
      if (
        planContract !== null &&
        !planContract.ok &&
        isPlanContractRewritePrompt(stepRow.prompt)
      ) {
        return `方案结构不合格：${planContract.problem}`;
      }
      return null;
    }
    const priorPlanStep = deps.db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, stepRow.buildId), eq(step.kind, 'plan'), ne(step.id, stepRow.id)))
      .get();
    if (priorPlanStep === undefined) return null;
    return '规划未产出方案';
  }
  if (isBuildStepKind(stepRow.kind)) {
    if (blockingWorkerQuestions(deps.db, stepRow.buildId).length > 0) return null;
    if (outcome.deliverables !== undefined) {
      return deliverableManifestFailure(deps.db, stepRow.id, outcome.deliverables);
    }
  }
  return null;
}

function confirmDeliveredPlan(deps: BuildDeps, buildId: string): void {
  const { commitEffects, ...settled } = deps;
  const committedDeps = { ...settled, ...commitEffects?.hubs };
  runAfterCommit(deps, 'confirmDeliveredPlan', () => {
    if (planAutoConfirmation(committedDeps, buildId).eligible)
      confirmPlanAutomatically(committedDeps, buildId);
  });
}

export interface CompleteStepOutcome {
  hasChanges?: boolean;
  workBranchDrift?: { expected: string; actual: string };
  findings?: ReviewVerdict;
  findingsError?: string;
  verifyVerdict?: VerifyVerdict;
  verifyVerdictError?: string;
  report?: string;
  verdictReport?: VerdictReport;
  deliverables?: DeliverableManifest;
}

export function completeStep(
  deps: BuildDeps,
  stepId: string,
  outcome: CompleteStepOutcome = {},
): void {
  withCommitEffects(deps, (settled) => completeStepSettled(settled, stepId, outcome));
}

function completeStepSettled(deps: BuildDeps, stepId: string, outcome: CompleteStepOutcome): void {
  const stepRow = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow) throw new NotFoundError(`step ${stepId}`);
  if (settleRetiredGateStep(deps, stepRow, outcome)) return;
  deps.db.delete(stopPending).where(eq(stopPending.stepId, stepId)).run();
  if (stepRow.archiveStop !== null) {
    applyStoppedStep(deps, stepId);
    return;
  }
  clearStop(deps.db, stepRow.buildId);
  if (settleParkedStep(deps, stepRow, { status: 'success' })) return;
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) {
    deps.db
      .update(step)
      .set({ status: 'done', finishedAt: nowMs() })
      .where(eq(step.id, stepId))
      .run();
    finishScheduledStep(deps, stepRow);
    return;
  }
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) {
    deps.db
      .update(step)
      .set({ status: 'done', finishedAt: nowMs() })
      .where(eq(step.id, stepId))
      .run();
    finishScheduledStep(deps, stepRow);
    return;
  }
  const reserved = buildRow.afterStopPhase;
  const staleBuild = todoRow.latestBuildId !== null && todoRow.latestBuildId !== buildRow.id;
  if (
    (todoRow.archivedAt !== null && stepRow.kind !== 'merge') ||
    reserved !== null ||
    staleBuild ||
    hasLeftExecution(todoRow.phase)
  ) {
    deps.db
      .update(step)
      .set({ status: 'done', finishedAt: nowMs() })
      .where(eq(step.id, stepId))
      .run();
    finishScheduledStep(deps, stepRow);
    settleAfterStopPhase(
      deps,
      buildRow.id,
      reserved === 'done' ? () => landReservedPhase(deps, todoRow, 'done') : undefined,
    );
    return;
  }
  const undelivered = undeliveredEnd(stepRow, todoRow, outcome);
  if (undelivered !== null && pendingWorkerQuestions(deps.db, buildRow.id).length === 0)
    askUndeliveredOnce(deps, buildRow, undelivered);
  const planContract = stepRow.kind === 'plan' ? planContractOfStep(deps, stepRow) : null;
  const gateFailure = stepArtifactGate(
    deps,
    stepRow,
    { ...outcome, output: todoRow.output },
    planContract,
  );
  if (gateFailure !== null) {
    applyStepFailure(deps, stepRow, gateFailure, outcome.verdictReport, undefined, {
      code: 'gate_rejection',
    });
    return;
  }
  deps.db
    .update(step)
    .set({ status: 'done', finishedAt: nowMs() })
    .where(eq(step.id, stepId))
    .run();

  finishScheduledStep(deps, stepRow);

  const deliveredCode =
    outcome.hasChanges === true || buildRow.prNumber !== null || buildRow.prUrl !== null;
  if (isBuildStepKind(stepRow.kind) && deliveredCode) noteTaskCodeDelivered(deps, todoRow.id);

  if (
    receivesAnswers(stepRow.kind) &&
    pendingWorkerQuestions(deps.db, stepRow.buildId).length === 0 &&
    undeliveredAnswers(deps.db, stepRow.buildId).length > 0
  ) {
    const working = stepRow.kind === 'plan' ? 'planning' : 'building';
    if (todoRow.phase !== working && canTransitionPhase(todoRow.phase, working)) {
      setTodoPhase(deps, todoRow.id, working);
    }
    enqueueStep(
      deps,
      stepRow.buildId,
      stepRow.kind,
      todoRow.teamId,
      ANSWERS_CONTINUE_PROMPT,
      false,
      true,
      { kind: 'continue' },
    );
    return;
  }
  if (stepRow.kind === 'plan') {
    const planDoc = deps.db
      .select({ id: planTable.id })
      .from(planTable)
      .where(eq(planTable.buildId, stepRow.buildId))
      .get();
    if (!planDoc) {
      enqueueStep(
        deps,
        stepRow.buildId,
        'plan',
        todoRow.teamId,
        PLAN_REWRITE_PROMPT,
        undefined,
        undefined,
        {
          kind: 'plan-rewrite',
        },
      );
      return;
    }
    if (planContract !== null && !planContract.ok) {
      enqueueStep(
        deps,
        stepRow.buildId,
        'plan',
        todoRow.teamId,
        buildPlanContractRewritePrompt(planContract.problem),
        undefined,
        undefined,
        { kind: 'plan-rewrite' },
      );
      return;
    }
    setTodoPhase(deps, todoRow.id, 'confirm', { hasPlan: true });
    confirmDeliveredPlan(deps, stepRow.buildId);
    return;
  }
  const keepInfoReport = () => {
    if (outcome.report === undefined || deps.attachmentsDir === undefined) return;
    storeInfoReport(
      { ...deps, attachmentsDir: deps.attachmentsDir },
      {
        buildId: stepRow.buildId,
        teamId: todoRow.teamId,
        createdBy: deps.user.id,
        report: outcome.report,
      },
    );
    const stored = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
    if (stored) publishBuild(deps, stored);
  };
  if (
    isBuildStepKind(stepRow.kind) &&
    canTransitionPhase(todoRow.phase, 'needs_input') &&
    pendingWorkerQuestions(deps.db, stepRow.buildId).length > 0
  ) {
    if (isInfoOutput(todoRow.output)) keepInfoReport();
    const hasChanges = deliveredCode ? true : outcome.hasChanges;
    setTodoPhase(deps, todoRow.id, 'needs_input', hasChanges !== undefined ? { hasChanges } : {});
    return;
  }
  if (isBuildStepKind(stepRow.kind) && isInfoOutput(todoRow.output)) {
    keepInfoReport();
    if (outcome.deliverables !== undefined) {
      publishDeliverables(deps.db, {
        stepId,
        buildId: stepRow.buildId,
        manifest: outcome.deliverables,
      });
    }
    setTodoPhase(deps, todoRow.id, 'review', { hasChanges: false });
    return;
  }
  if (isBuildStepKind(stepRow.kind)) {
    finishTodoDone(deps, todoRow.id, buildRow.id, {
      hasChanges: outcome.hasChanges !== false || deliveredCode,
    });
    return;
  }
  const pr = githubPrOf(deps, todoRow, buildRow.prNumber);
  if (pr !== null) {
    assertPhaseTransition(todoRow.phase, 'done');
    insertMessageRow(deps, buildRow.id, {
      id: newRecordId(),
      role: 'system',
      content: `合并步已完成；本任务以 PR #${pr.prNumber} 在 GitHub 上的状态为准，cairn 对账读到它合并后记录结果。`,
      createdAt: nowMs(),
    });
    announceMergeStepOutcome(deps, {
      stepId,
      buildId: buildRow.id,
      text: MERGE_UNCONFIRMED_TEXT,
    });
    return;
  }
  finishTodoDone(deps, todoRow.id, buildRow.id);
  announceMergeStepOutcome(deps, { stepId, buildId: buildRow.id, text: MERGE_LANDED_TEXT });
}
