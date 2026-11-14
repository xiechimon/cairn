import type { ReviewVerdict } from '@cairn/shared';
import {
  ANSWERS_CONTINUE_PROMPT,
  buildPlanContractRewritePrompt,
  buildPlanRewritePrompt,
  isBuildStepKind,
  isPlanContractRewritePrompt,
  type PlanContractCheck,
  type TodoOutputKind,
  type VerifyVerdict,
} from '@cairn/shared';
import { and, eq, ne } from 'drizzle-orm';
import { build, plan as planTable, step, stopPending, todo } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { receivesAnswers, undeliveredAnswers } from './answer-delivery.js';
import { settleReviewStep, settleVerifyStep } from './build-gate-steps.js';
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
  maybeEnqueueIndependentReview,
  NotFoundError,
  publishBuild,
  settleParkedStep,
} from './builds.js';
import { storeInfoReport } from './info-handoff.js';
import { assertPhaseTransition, canTransitionPhase } from './phase.js';
import { planAutoConfirmation, planContractOfStep } from './plan-auto-confirm.js';
import { finishScheduledStep } from './schedules.js';
import { setTodoPhase } from './todos.js';
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
    if (outcome.output === 'info') {
      return outcome.report === undefined ? '信息卡未产出报告' : null;
    }
    const drift = outcome.workBranchDrift;
    if (drift !== undefined) {
      if (outcome.hasChanges === false) {
        return `agent 偏离工作分支且步窗口内未见任何提交：收尾时 HEAD 在「${drift.actual}」，契约工作分支是「${drift.expected}」`;
      }
      return `agent 偏离工作分支交付，已拒绝自动收工：收尾时 HEAD 在「${drift.actual}」，契约工作分支是「${drift.expected}」`;
    }
  }
  return null;
}

function confirmDeliveredPlan(deps: BuildDeps, buildId: string): void {
  try {
    deps.db.transaction(() => {
      if (planAutoConfirmation(deps, buildId).eligible) confirmPlanAutomatically(deps, buildId);
    });
  } catch {
    return;
  }
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
}

export function completeStep(
  deps: BuildDeps,
  stepId: string,
  outcome: CompleteStepOutcome = {},
): void {
  const stepRow = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow) throw new NotFoundError(`step ${stepId}`);
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
  const undelivered = undeliveredEnd(deps, stepRow, todoRow, buildRow, outcome);
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
    const refuseDriftRecord =
      isBuildStepKind(stepRow.kind) &&
      outcome.workBranchDrift !== undefined &&
      outcome.hasChanges !== false;
    if (refuseDriftRecord) {
      deps.db
        .update(build)
        .set({ prUrl: null, prNumber: null })
        .where(eq(build.id, stepRow.buildId))
        .run();
    }
    applyStepFailure(deps, stepRow, gateFailure, outcome.verdictReport);
    if (refuseDriftRecord) {
      const cleared = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
      if (cleared) publishBuild(deps, cleared);
    }
    return;
  }
  deps.db
    .update(step)
    .set({ status: 'done', finishedAt: nowMs() })
    .where(eq(step.id, stepId))
    .run();

  finishScheduledStep(deps, stepRow);

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
      enqueueStep(deps, stepRow.buildId, 'plan', todoRow.teamId, PLAN_REWRITE_PROMPT);
      return;
    }
    if (planContract !== null && !planContract.ok) {
      enqueueStep(
        deps,
        stepRow.buildId,
        'plan',
        todoRow.teamId,
        buildPlanContractRewritePrompt(planContract.problem),
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
      { db: deps.db, attachmentsDir: deps.attachmentsDir },
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
    if (todoRow.output === 'info') keepInfoReport();
    setTodoPhase(
      deps,
      todoRow.id,
      'needs_input',
      outcome.hasChanges !== undefined ? { hasChanges: outcome.hasChanges } : {},
    );
    return;
  }
  if (isBuildStepKind(stepRow.kind) && todoRow.output === 'info') {
    keepInfoReport();
    setTodoPhase(deps, todoRow.id, 'review', { hasChanges: false });
    return;
  }
  if (isBuildStepKind(stepRow.kind)) {
    const deliveredGithubPr = githubPrOf(deps, todoRow, buildRow.prNumber) !== null;
    if (!deliveredGithubPr) {
      setTodoPhase(deps, todoRow.id, 'review', {
        hasChanges: outcome.hasChanges ?? true,
      });
      return;
    }
    if (todoRow.phase === 'building' || canTransitionPhase(todoRow.phase, 'building')) {
      setTodoPhase(deps, todoRow.id, 'building', {
        hasChanges: outcome.hasChanges ?? true,
      });
    }
    const freshTodo = deps.db.select().from(todo).where(eq(todo.id, todoRow.id)).get();
    if (freshTodo) maybeEnqueueIndependentReview(deps, freshTodo, stepRow.buildId);
    return;
  }
  if (stepRow.kind === 'review') {
    settleReviewStep(deps, stepRow, todoRow, buildRow, outcome);
    return;
  }
  if (stepRow.kind === 'verify') {
    settleVerifyStep(deps, stepRow, buildRow, outcome);
    return;
  }
  const pr = githubPrOf(deps, todoRow, buildRow.prNumber);
  if (pr !== null) {
    assertPhaseTransition(todoRow.phase, 'done');
    insertMessageRow(deps, buildRow.id, {
      id: newRecordId(),
      role: 'system',
      content: `合并步跑完了；本任务以 PR #${pr.prNumber} 在 GitHub 上合并为准，cairn 对账读到它合并后收尾。它若还开着：在审核关口点「合并」由 cairn 经 GitHub 合并，或直接在 GitHub 上合并。`,
      createdAt: nowMs(),
    });
    return;
  }
  finishTodoDone(deps, todoRow.id, buildRow.id);
}
