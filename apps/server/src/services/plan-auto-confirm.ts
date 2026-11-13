import {
  ACTIVE_STEP_STATUSES,
  checkPlanContract,
  isPlanContractRewritePrompt,
  type PlanContractCheck,
  projectMergeConfigSchema,
} from '@cairn/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  build,
  buildFeedback,
  chief,
  chiefMessage,
  plan as planTable,
  queuedMessage,
  step,
  todo,
} from '../db/schema.js';
import type { BuildDeps } from './builds.js';
import { askQuestionContentOf } from './chief-questions.js';
import { projectOfTodo } from './git.js';
import { planHasOpenDecisions } from './plan-decisions.js';
import { childrenOfTodo } from './todos.js';

export function latestPlanRow(
  deps: Pick<BuildDeps, 'db'>,
  buildId: string,
): typeof planTable.$inferSelect | undefined {
  return deps.db
    .select()
    .from(planTable)
    .where(eq(planTable.buildId, buildId))
    .orderBy(desc(planTable.version))
    .get();
}

export function planContractOfStep(
  deps: Pick<BuildDeps, 'db'>,
  stepRow: typeof step.$inferSelect,
): PlanContractCheck | null {
  const rewrite = isPlanContractRewritePrompt(stepRow.prompt);
  const latest = latestPlanRow(deps, stepRow.buildId);
  if (latest === undefined) return null;
  if (!rewrite && latest.stepId !== stepRow.id) return null;
  return checkPlanContract(latest.content);
}

type PlanAutoConfirmation =
  | { eligible: true; planId: string; deadline: number }
  | { eligible: false; reason: string };

export function planAwaitsAutoConfirm(deps: Pick<BuildDeps, 'db'>, buildId: string): boolean {
  return planAutoConfirmation(deps, buildId).eligible;
}

export function planAutoConfirmation(
  deps: Pick<BuildDeps, 'db'>,
  buildId: string,
): PlanAutoConfirmation {
  const latestPlan = latestPlanRow(deps, buildId);
  if (latestPlan === undefined)
    return { eligible: false, reason: 'No plan is available for automatic confirmation' };
  if (latestPlan.autoApprovePausedAt !== null)
    return {
      eligible: false,
      reason: 'Plan auto-approve is paused; explicit user approval is required',
    };
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (buildRow === undefined || buildRow.errorMessage !== null)
    return { eligible: false, reason: 'Build is missing or has an error' };
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (
    todoRow === undefined ||
    todoRow.phase !== 'confirm' ||
    todoRow.archivedAt !== null ||
    todoRow.latestBuildId !== buildId
  )
    return {
      eligible: false,
      reason: 'Build is not the current unarchived task awaiting confirmation',
    };
  const liveStep = deps.db
    .select({ id: step.id })
    .from(step)
    .where(and(eq(step.buildId, buildId), inArray(step.status, [...ACTIVE_STEP_STATUSES])))
    .get();
  if (liveStep !== undefined) return { eligible: false, reason: 'Build still has an active step' };
  if (!checkPlanContract(latestPlan.content).ok)
    return { eligible: false, reason: 'Plan does not satisfy the verification contract' };
  if (planHasOpenDecisions(latestPlan.content))
    return {
      eligible: false,
      reason: 'Plan has unresolved decisions; explicit user approval is required',
    };
  const config = projectMergeConfigSchema.parse(projectOfTodo(deps.db, todoRow)?.autonomy ?? {});
  if (!config.planAutoApproveEnabled)
    return {
      eligible: false,
      reason: 'Plan auto-approve is disabled for this project; explicit user approval is required',
    };
  const mergePolicy = config.mergePolicy;
  if (mergePolicy === 'human')
    return { eligible: false, reason: 'Project requires explicit user approval' };
  if (childrenOfTodo(deps.db, todoRow.id).length > 0)
    return { eligible: false, reason: 'Split plans require explicit user approval' };
  const latestFeedback = deps.db
    .select({ kind: buildFeedback.kind, side: buildFeedback.side })
    .from(buildFeedback)
    .where(eq(buildFeedback.buildId, buildId))
    .orderBy(desc(buildFeedback.createdAt), desc(buildFeedback.id))
    .get();
  if (latestFeedback?.kind === 'revision' && latestFeedback.side === 'plan')
    return { eligible: false, reason: 'Revised plans require explicit user approval' };
  const threadIds = [
    ...new Set(
      deps.db
        .select({ watches: chief.watches })
        .from(chief)
        .where(eq(chief.teamId, todoRow.teamId))
        .all()
        .flatMap((row) =>
          row.watches.filter((watch) => watch.todoId === todoRow.id).map((watch) => watch.threadId),
        ),
    ),
  ];
  const pendingQuestion =
    threadIds.length > 0 &&
    deps.db
      .select({ content: chiefMessage.content })
      .from(chiefMessage)
      .where(inArray(chiefMessage.threadId, threadIds))
      .all()
      .some((row) => askQuestionContentOf(row.content)?.status === 'pending');
  if (pendingQuestion)
    return { eligible: false, reason: 'A pending Chief question requires a user answer' };
  const queuedFeedback = deps.db
    .select({ id: queuedMessage.id })
    .from(queuedMessage)
    .where(and(eq(queuedMessage.conversationId, buildId), isNull(queuedMessage.error)))
    .get();
  if (queuedFeedback !== undefined)
    return { eligible: false, reason: 'A queued user message is waiting for the planning turn' };
  return {
    eligible: true,
    planId: latestPlan.id,
    deadline: todoRow.phaseAt,
  };
}

export function planAutoApproveAt(deps: Pick<BuildDeps, 'db'>, planId: string): number | null {
  const planRow = deps.db.select().from(planTable).where(eq(planTable.id, planId)).get();
  if (planRow === undefined) return null;
  const eligibility = planAutoConfirmation(deps, planRow.buildId);
  return eligibility.eligible && eligibility.planId === planId ? eligibility.deadline : null;
}
