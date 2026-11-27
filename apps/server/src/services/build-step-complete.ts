import {
  type AcceptanceEvaluation,
  ANSWERS_CONTINUE_PROMPT,
  buildAcceptanceNudgePrompt,
  buildPlanRewritePrompt,
  evaluateStepAcceptance,
  extractEditedPathsFromMessages,
  isAcceptanceNudgePrompt,
  isBuildStepKind,
  isInfoOutput,
  type TodoOutputKind,
} from '@cairn/shared';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { runAfterCommit, withCommitEffects } from '../db/commit-effects.js';
import {
  attachment,
  build,
  message,
  plan as planTable,
  project,
  step,
  stopPending,
  todo,
} from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { receivesAnswers, undeliveredAnswers } from './answer-delivery.js';
import {
  applyStoppedStep,
  hasLeftExecution,
  landReservedPhase,
  settleAfterStopPhase,
} from './build-stop.js';
import {
  askAcceptanceBlockedOnce,
  askUndeliveredOnce,
  undeliveredEnd,
} from './build-undelivered.js';
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
import { planAutoConfirmation } from './plan-auto-confirm.js';
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
): string | null {
  if (stepRow.kind === 'plan') {
    const planRow = deps.db
      .select({ id: planTable.id })
      .from(planTable)
      .where(eq(planTable.buildId, stepRow.buildId))
      .get();
    if (planRow !== undefined) {
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
  report?: string;
  deliverables?: DeliverableManifest;
  unpushedCommits?: number | null;
}

const ACCEPTANCE_NUDGE_MAX = 1;

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
  const blockedByAnswers =
    receivesAnswers(stepRow.kind) && undeliveredAnswers(deps.db, stepRow.buildId).length > 0;
  let acceptance: AcceptanceEvaluation | null = null;
  if (
    isBuildStepKind(stepRow.kind) &&
    pendingWorkerQuestions(deps.db, buildRow.id).length === 0 &&
    !blockedByAnswers
  ) {
    const buildSteps = deps.db
      .select({
        id: step.id,
        kind: step.kind,
        status: step.status,
        scheduleId: step.scheduleId,
        createdAt: step.createdAt,
        finishedAt: step.finishedAt,
        prompt: step.prompt,
      })
      .from(step)
      .where(eq(step.buildId, buildRow.id))
      .orderBy(asc(step.createdAt), asc(step.id))
      .all();
    const buildStepIds = buildSteps.map((s) => s.id);
    let rootIdx = buildSteps.findIndex((s) => s.id === stepRow.id);
    while (rootIdx > 0 && isAcceptanceNudgePrompt(buildSteps[rootIdx]?.prompt)) {
      let prevIdx = rootIdx - 1;
      let prevStep = buildSteps[prevIdx];
      while (prevIdx > 0 && (!prevStep || !isBuildStepKind(prevStep.kind))) {
        prevIdx -= 1;
        prevStep = buildSteps[prevIdx];
      }
      if (!prevStep || !isBuildStepKind(prevStep.kind)) break;
      rootIdx = prevIdx;
    }
    const attemptRoot = (rootIdx >= 0 ? buildSteps[rootIdx] : undefined) ?? stepRow;
    const lastPlanFinishedAt = buildSteps.reduce<number | null>(
      (max, s) =>
        s.kind === 'plan' && s.status === 'done' && s.finishedAt !== null
          ? max === null || s.finishedAt > max
            ? s.finishedAt
            : max
          : max,
      null,
    );
    const allBuildMessages = deps.db
      .select({ role: message.role, content: message.content, createdAt: message.createdAt })
      .from(message)
      .where(eq(message.conversationId, buildRow.id))
      .orderBy(asc(message.createdAt), asc(message.id))
      .all();
    const buildMessages =
      attemptRoot.scheduleId !== null
        ? allBuildMessages.filter((m) => m.createdAt >= attemptRoot.createdAt)
        : lastPlanFinishedAt === null
          ? allBuildMessages
          : allBuildMessages.filter((m) => m.createdAt > lastPlanFinishedAt);
    if (buildMessages.some((m) => m.role === 'assistant')) {
      const projRow = deps.db
        .select({ repoKind: project.repoKind })
        .from(project)
        .where(eq(project.id, todoRow.projectId))
        .get();
      const stepAttachments = deps.db
        .select({
          id: attachment.id,
          createdBy: attachment.createdBy,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          status: attachment.status,
          grantId: attachment.grantId,
          createdAt: attachment.createdAt,
        })
        .from(attachment)
        .where(
          and(
            eq(attachment.teamId, todoRow.teamId),
            inArray(attachment.status, ['ready', 'received', 'pending', 'failed']),
          ),
        )
        .all();
      const recordedChanges = Array.isArray(buildRow.changes)
        ? buildRow.changes
        : (buildRow.changes?.files ?? []);
      const editedPaths =
        recordedChanges.length > 0
          ? recordedChanges.map((f) => f.path)
          : extractEditedPathsFromMessages(buildMessages);
      acceptance = evaluateStepAcceptance({
        output: todoRow.output,
        repoKind: projRow?.repoKind ?? null,
        hasChanges: outcome.hasChanges,
        editedPaths,
        messages: buildMessages,
        attachments: stepAttachments,
        stepIds: buildStepIds,
        unpushedCommits: outcome.unpushedCommits,
        report: outcome.report,
        deliverables: outcome.deliverables,
      });
    }
  }
  if (acceptance !== null && !acceptance.ok && !acceptance.retryable) {
    askAcceptanceBlockedOnce(deps, buildRow, stepRow.id, acceptance);
  } else {
    const undelivered = undeliveredEnd(stepRow, todoRow, outcome);
    if (undelivered !== null && pendingWorkerQuestions(deps.db, buildRow.id).length === 0)
      askUndeliveredOnce(deps, buildRow, undelivered);
  }
  const gateFailure = stepArtifactGate(deps, stepRow, {
    ...outcome,
    output: todoRow.output,
  });
  if (gateFailure !== null) {
    applyStepFailure(deps, stepRow, gateFailure, undefined, {
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
  if (
    isBuildStepKind(stepRow.kind) &&
    acceptance !== null &&
    !acceptance.ok &&
    acceptance.retryable
  ) {
    const priorNudges = deps.db
      .select({ prompt: step.prompt })
      .from(step)
      .where(eq(step.buildId, stepRow.buildId))
      .all()
      .filter((s) => isAcceptanceNudgePrompt(s.prompt)).length;
    if (priorNudges < ACCEPTANCE_NUDGE_MAX) {
      if (todoRow.phase !== 'building' && canTransitionPhase(todoRow.phase, 'building')) {
        setTodoPhase(deps, todoRow.id, 'building');
      }
      enqueueStep(
        deps,
        stepRow.buildId,
        stepRow.kind,
        todoRow.teamId,
        buildAcceptanceNudgePrompt(acceptance),
        false,
        false,
        { kind: 'continue' },
      );
      return;
    }
    askAcceptanceBlockedOnce(deps, buildRow, stepRow.id, acceptance);
    if (isInfoOutput(todoRow.output)) keepInfoReport();
    if (canTransitionPhase(todoRow.phase, 'needs_input')) {
      const hasChanges = deliveredCode ? true : outcome.hasChanges;
      setTodoPhase(deps, todoRow.id, 'needs_input', hasChanges !== undefined ? { hasChanges } : {});
    }
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
