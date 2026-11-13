import {
  ACTIVE_STEP_STATUSES,
  buildReviewStepPrompt,
  buildTaskPromptText,
  buildVerifyStepPrompt,
  isActiveStepStatus,
  isBuildStepKind,
  parseReviewPromptMeta,
  planVerificationItems,
  REVIEW_ANNOUNCEMENT,
  VERIFY_ANNOUNCEMENT,
} from '@cairn/shared';
import { and, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import { build, step, type todo } from '../db/schema.js';
import { ticketRefOf } from './build-gate-verdict.js';
import {
  type BuildDeps,
  dispatchHeadSha,
  enqueueStep,
  githubPrOf,
  reviewInstructionOf,
  roundStart,
} from './builds.js';
import { hasRepoBinding, projectOfTodo } from './git.js';
import { isCodexReviewModel } from './merge-gate/model-identity.js';
import { effectiveModel } from './model-fallback.js';
import { latestPlanRow } from './plan-auto-confirm.js';
import { profileForStep, routeForStep } from './routing-rules.js';
import { insertGateAnnouncement } from './transcript.js';
import { blockingWorkerQuestions } from './worker-question-store.js';

type TodoRow = typeof todo.$inferSelect;

export function maybeEnqueueVerifyStep(
  deps: BuildDeps,
  todoRow: typeof todo.$inferSelect,
  buildId: string,
  opts: { reverify?: boolean } = {},
): void {
  if (routeForStep(deps.db, todoRow, 'verify') === null) return;
  const expectedHeadSha = dispatchHeadSha(deps, buildId);
  if (expectedHeadSha === null) return;
  if (blockingWorkerQuestions(deps.db, buildId).length > 0) return;
  const existing = deps.db
    .select({ id: step.id })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        eq(step.kind, 'verify'),
        opts.reverify === true
          ? inArray(step.status, [...ACTIVE_STEP_STATUSES])
          : or(
              inArray(step.status, [...ACTIVE_STEP_STATUSES]),
              gte(step.createdAt, roundStart(deps, buildId)),
            ),
      ),
    )
    .get();
  if (existing !== undefined) return;
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (buildRow === undefined) return;
  if (githubPrOf(deps, todoRow, buildRow.prNumber) === null) return;
  const projectRow = projectOfTodo(deps.db, todoRow);
  if (projectRow === undefined) return;
  const planRow = latestPlanRow(deps, buildId);
  deps.db.transaction(() => {
    deps.db
      .update(build)
      .set({ evidenceStore: projectRow.evidenceStore })
      .where(and(eq(build.id, buildId), isNull(build.evidenceStore)))
      .run();
    const snapshot = deps.db
      .select({ evidenceStore: build.evidenceStore })
      .from(build)
      .where(eq(build.id, buildId))
      .get();
    if (snapshot?.evidenceStore == null) throw new Error('Verify evidence snapshot unavailable');
    const prompt = buildVerifyStepPrompt({
      ticketRef: ticketRefOf(todoRow),
      taskText: buildTaskPromptText(todoRow.title, todoRow.spec, todoRow),
      planText: planRow?.content ?? '',
      verificationItems: planVerificationItems(planRow?.content ?? ''),
      pr: buildRow.prNumber !== null ? { number: buildRow.prNumber, url: buildRow.prUrl } : null,
      expectedHeadSha,
      evidenceStore: snapshot.evidenceStore,
    });
    insertGateAnnouncement(deps, buildId, VERIFY_ANNOUNCEMENT, deps.user.displayName);
    enqueueStep(deps, buildId, 'verify', todoRow.teamId, prompt);
  });
}

function authorModelOf(deps: BuildDeps, todoRow: TodoRow, buildId: string): string | null {
  const authorStep = deps.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildId), eq(step.status, 'done')))
    .all()
    .filter((row) => isBuildStepKind(row.kind))
    .sort((a, b) => (a.finishedAt ?? a.createdAt) - (b.finishedAt ?? b.createdAt))
    .at(-1);
  if (authorStep === undefined) return null;
  const authorAgent = profileForStep(deps.db, todoRow, authorStep.kind, authorStep.id);
  return authorAgent === null ? null : effectiveModel(authorAgent, authorStep).modelId;
}

export function maybeEnqueueIndependentReview(
  deps: BuildDeps,
  todoRow: TodoRow,
  buildId: string,
): void {
  if (blockingWorkerQuestions(deps.db, buildId).length > 0) return;
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (buildRow === undefined || githubPrOf(deps, todoRow, buildRow.prNumber) === null) return;
  const head = dispatchHeadSha(deps, buildId);
  if (head === null) return;
  const reviews = deps.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildId), eq(step.kind, 'review')))
    .all();
  if (reviews.some((row) => isActiveStepStatus(row.status))) return;
  const since = roundStart(deps, buildId);
  if (
    reviews.some(
      (row) =>
        row.createdAt >= since && parseReviewPromptMeta(row.prompt)?.expectedHeadSha === head,
    )
  )
    return;
  const reviewRoute = routeForStep(deps.db, todoRow, 'review');
  if (reviewRoute === null) return;
  const authorModel = authorModelOf(deps, todoRow, buildId);
  if (authorModel === null || !isCodexReviewModel(reviewRoute.modelId)) return;
  const agentId = reviewRoute.id;
  const plan = latestPlanRow(deps, buildId);
  const reviewInstruction = reviewInstructionOf(deps, todoRow.teamId, 'review');
  const prompt = buildReviewStepPrompt({
    agentId,
    gate: 'review',
    planText: plan?.content ?? '',
    changes: [],
    checkout: hasRepoBinding(projectOfTodo(deps.db, todoRow)),
    expectedHeadSha: head,
    ...(reviewInstruction !== undefined ? { instruction: reviewInstruction } : {}),
  });
  insertGateAnnouncement(deps, buildId, REVIEW_ANNOUNCEMENT, deps.user.displayName);
  enqueueStep(deps, buildId, 'review', todoRow.teamId, prompt);
}
