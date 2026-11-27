import type { StepActionOrigin } from '@cairn/shared';
import { buildReplanPrompt, buildReviewRejectPrompt, SESSION_REWORK_BRIEF } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { build } from '../db/schema.js';
import { HttpError, taskArchived } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { recordBuildFeedback } from './build-provenance.js';
import { restartFailedBuild } from './build-restart.js';
import {
  applyBuildConfirm,
  assertParkedBuildIdle,
  type BuildDeps,
  buildRunsSession,
  enqueueStep,
  NotFoundError,
} from './builds.js';
import { claimClientMessage, findClientMessage } from './client-message.js';
import { planAutoConfirmation } from './plan-auto-confirm.js';
import { externalClientMessageId } from './queued-send.js';
import { holdSecondRejectionRework } from './research-stuck.js';
import { assertAutomaticRetryAllowed, assertPermanentRefusalCleared } from './retry-parking.js';
import { assertSplitProposalExecutable } from './split-proposal.js';
import { getTodo, setTodoPhase } from './todos.js';
import { insertMessageRow } from './transcript.js';

export async function applyBuildStepAction(
  deps: BuildDeps,
  buildId: string,
  body:
    | { action: 'confirm' }
    | { action: 'revision'; side: 'plan'; feedback: string; clientMessageId: string }
    | { action: 'restart'; feedback: string; clientMessageId: string },
  actor?: string,
  origin: StepActionOrigin = 'person',
  beforeCommit?: () => void,
  sseClientMessageId?: string,
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
  const todoRecord = getTodo(deps, row.todoId);
  if (!todoRecord) throw new NotFoundError(`todo ${row.todoId}`);
  if (todoRecord.archivedAt != null) throw taskArchived();
  const actorName = actor ?? deps.user.displayName;
  if (origin === 'retry') assertAutomaticRetryAllowed(deps, row.todoId);
  else {
    if (origin !== 'person') assertPermanentRefusalCleared(row.errorMessage);
    assertParkedBuildIdle(deps, row);
  }

  if (body.action === 'restart') {
    await restartFailedBuild(
      deps,
      row,
      todoRecord,
      body,
      actorName,
      origin,
      beforeCommit,
      sseClientMessageId,
    );
    return;
  }

  if (body.action === 'confirm') {
    if (origin !== 'person' && todoRecord.phase === 'confirm') {
      const eligibility = planAutoConfirmation(deps, buildId);
      if (!eligibility.eligible) throw new HttpError(409, eligibility.reason);
    }
    applyBuildConfirm(deps, buildId, actorName, origin === 'person');
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
    insertMessageRow(
      transcriptDeps,
      buildId,
      {
        id: newRecordId(),
        role: 'user',
        content: body.feedback,
        createdAt: nowMs(),
        origin: origin === 'person' ? 'user' : 'synthetic',
      },
      undefined,
      externalClientMessageId(sseClientMessageId, body.clientMessageId),
    );
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
    enqueueStep(deps, buildId, 'plan', revising.teamId, replanPrompt, false, origin === 'person', {
      kind: 'replan',
    });
    holdSecondRejectionRework(deps, buildId);
  });
  for (const publish of afterCommit) publish();
}
