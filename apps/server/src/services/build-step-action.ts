import type { ReviewGate } from '@cairn/shared';
import {
  buildReplanPrompt,
  buildReviewRejectPrompt,
  buildReviewStepPrompt,
  REVIEW_ANNOUNCEMENT,
  SESSION_REWORK_BRIEF,
} from '@cairn/shared';
import { asc, eq } from 'drizzle-orm';
import { build, plan as planTable } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { recordBuildFeedback } from './build-provenance.js';
import { restartFailedBuild } from './build-restart.js';
import {
  applyBuildConfirm,
  assertParkedBuildIdle,
  type BuildDeps,
  buildRunsSession,
  dispatchHeadSha,
  enqueueStep,
  NotFoundError,
  restoreFailedReview,
  reviewInstructionOf,
} from './builds.js';
import { claimClientMessage, findClientMessage } from './client-message.js';
import { hasRepoBinding, projectOfTodo, readBuildChanges } from './git.js';
import { planAutoConfirmation } from './plan-auto-confirm.js';
import { holdSecondRejectionRework } from './research-stuck.js';
import { assertAutomaticRetryAllowed } from './retry-parking.js';
import { routeForStep } from './routing-rules.js';
import { assertSplitProposalExecutable } from './split-proposal.js';
import { getTodo, setTodoPhase } from './todos.js';
import { insertGateAnnouncement, insertMessageRow } from './transcript.js';

export async function applyBuildStepAction(
  deps: BuildDeps,
  buildId: string,
  body:
    | { action: 'confirm' }
    | { action: 'revision'; side: 'plan'; feedback: string; clientMessageId: string }
    | { action: 'review'; focus?: string }
    | { action: 'restart'; feedback: string; clientMessageId: string },
  actor?: string,
  origin: 'person' | 'automatic' = 'person',
  beforeCommit?: () => void,
): Promise<void> {
  if (
    (body.action === 'revision' || body.action === 'restart') &&
    findClientMessage(deps.db, buildId, body.clientMessageId) !== undefined
  ) {
    return;
  }
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) throw new NotFoundError(`build ${buildId}`);
  assertSplitProposalExecutable(row.errorMessage);
  let todoRecord = getTodo(deps, row.todoId);
  if (!todoRecord) throw new NotFoundError(`todo ${row.todoId}`);
  if (todoRecord.archivedAt != null) throw new HttpError(409, 'Unarchive to continue');
  const actorName = actor ?? deps.user.displayName;
  if (origin === 'automatic') assertAutomaticRetryAllowed(deps, row.todoId);
  else assertParkedBuildIdle(deps, row);

  if (body.action === 'restart') {
    await restartFailedBuild(deps, row, todoRecord, body, actorName, origin, beforeCommit);
    return;
  }

  if (body.action === 'confirm') {
    if (origin === 'automatic' && todoRecord.phase === 'confirm') {
      const eligibility = planAutoConfirmation(deps, buildId);
      if (!eligibility.eligible) throw new HttpError(409, eligibility.reason);
    }
    applyBuildConfirm(deps, buildId, actorName);
    return;
  }
  if (body.action === 'review') {
    const reviewRoute = routeForStep(deps.db, todoRecord, 'review');
    if (reviewRoute === null) {
      throw new HttpError(
        400,
        'No review routing rule: add a `review` routing rule in routing settings before requesting an AI review.',
      );
    }
    restoreFailedReview(deps, row);
    if (todoRecord.phase === 'failed') {
      const restored = getTodo(deps, row.todoId);
      if (restored) todoRecord = restored;
    }
    if (todoRecord.phase !== 'confirm' && todoRecord.phase !== 'review') {
      throw new HttpError(409, `AI 审核仅在待确认/审核关口允许，当前相位 ${todoRecord.phase}`);
    }
    const plan = deps.db
      .select({ content: planTable.content })
      .from(planTable)
      .where(eq(planTable.buildId, buildId))
      .orderBy(asc(planTable.version))
      .all();
    const planText = plan.map((p) => p.content).join('\n\n---\n\n');
    const gate: ReviewGate = todoRecord.phase === 'review' ? 'review' : 'confirm';
    const projectRow = projectOfTodo(deps.db, todoRecord);
    const checkout = hasRepoBinding(projectRow);
    const changes =
      gate === 'review'
        ? deps.reposDir !== undefined
          ? (await readBuildChanges({ db: deps.db, reposDir: deps.reposDir }, buildId)).files
          : []
        : undefined;
    const after = getTodo(deps, row.todoId);
    if (after?.phase !== todoRecord.phase) {
      throw new HttpError(
        409,
        `读取变更期间任务相位已变为 ${after?.phase ?? '（任务已删除）'}，未发起 AI 审核`,
      );
    }
    insertGateAnnouncement(deps, buildId, REVIEW_ANNOUNCEMENT, actorName);
    const expectedHeadSha = gate === 'review' ? dispatchHeadSha(deps, buildId) : null;
    const reviewInstruction = reviewInstructionOf(deps, todoRecord.teamId, gate);
    const promptArgs = {
      gate,
      planText,
      ...(reviewInstruction !== undefined ? { instruction: reviewInstruction } : {}),
      ...(changes !== undefined ? { changes } : {}),
      checkout,
      ...(expectedHeadSha !== null ? { expectedHeadSha } : {}),
    } as const;
    const reviewPrompt = buildReviewStepPrompt({
      agentId: reviewRoute.id,
      ...promptArgs,
      ...(body.focus !== undefined ? { focus: body.focus } : {}),
    });
    enqueueStep(deps, buildId, 'review', todoRecord.teamId, reviewPrompt);
    return;
  }
  if (todoRecord.phase !== 'confirm' && todoRecord.phase !== 'review') {
    throw new HttpError(409, `revision 仅在待确认/审核关口允许，当前相位 ${todoRecord.phase}`);
  }
  const revising = todoRecord;
  const afterCommit: (() => void)[] = [];
  const transcriptDeps = { ...deps, afterCommit };
  deps.db.transaction(() => {
    claimClientMessage(deps.db, buildId, body.clientMessageId, {
      delegated: true,
      delivered: 'revision',
      conversationId: buildId,
    });
    recordBuildFeedback(
      deps.db,
      buildId,
      'revision',
      revising.phase === 'confirm' ? 'plan' : 'build',
      body.feedback,
      actorName,
    );
    insertMessageRow(transcriptDeps, buildId, {
      id: newRecordId(),
      role: 'user',
      content: body.feedback,
      createdAt: nowMs(),
    });
    beforeCommit?.();
    if (revising.phase === 'review' && buildRunsSession(deps, buildId)) {
      deps.db.update(build).set({ prevPhase: 'review' }).where(eq(build.id, buildId)).run();
      setTodoPhase(deps, revising.id, 'queued');
      enqueueStep(
        deps,
        buildId,
        'session',
        revising.teamId,
        `${SESSION_REWORK_BRIEF}\n\n${body.feedback}`,
        false,
        origin === 'person',
        { kind: 'rework' },
      );
      holdSecondRejectionRework(deps, buildId);
      return;
    }
    setTodoPhase(deps, revising.id, 'planning');
    const replanPrompt =
      revising.phase === 'review'
        ? buildReviewRejectPrompt(body.feedback)
        : buildReplanPrompt(body.feedback);
    enqueueStep(deps, buildId, 'plan', revising.teamId, replanPrompt, false, origin === 'person');
    holdSecondRejectionRework(deps, buildId);
  });
  for (const publish of afterCommit) publish();
}
