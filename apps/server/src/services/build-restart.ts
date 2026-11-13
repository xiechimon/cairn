import type { TodoRecord } from '@cairn/shared';
import {
  buildFailureRowContent,
  buildRestartPrompt,
  buildReworkNewBranchNote,
  buildReworkReuseNote,
  conversationBranch,
  SESSION_BRIEF,
  withRetryLessons,
} from '@cairn/shared';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { build, step } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, newUuidv7, nowMs } from '../lib/ids.js';
import { latestPrBuild, probeReworkTargetPr } from './build-pr-probe.js';
import { recordBuildFeedback } from './build-provenance.js';
import {
  assertParkedBuildIdle,
  type BuildDeps,
  buildRunsSession,
  enqueueStep,
  githubPrOf,
  hasActiveStep,
  hasFailureRow,
  publishBuild,
} from './builds.js';
import { claimClientMessage, completeClientMessage } from './client-message.js';
import { retryLessonsOf } from './retry-lessons.js';
import { assertAutomaticRetryAllowed } from './retry-parking.js';
import { getTodo, setTodoPhase } from './todos.js';
import { insertMessageRow } from './transcript.js';

export async function restartFailedBuild(
  deps: BuildDeps,
  row: typeof build.$inferSelect,
  initialTodo: TodoRecord,
  body: { feedback: string; clientMessageId: string },
  actorName: string,
  origin: 'person' | 'automatic',
  beforeCommit: (() => void) | undefined,
): Promise<void> {
  const buildId = row.id;
  let todoRecord = initialTodo;
  if (todoRecord.phase !== 'failed') {
    throw new HttpError(409, `restart 仅适用于 failed 相位（当前 ${todoRecord.phase}）`);
  }
  const feedbackText = body.feedback.trim() === '' ? null : body.feedback;
  const preservedStep = deps.db
    .select({ id: step.id })
    .from(step)
    .where(
      and(
        eq(step.buildId, row.id),
        inArray(step.kind, ['build', 'session']),
        eq(step.status, 'failed'),
        isNotNull(step.checkpointCommit),
      ),
    )
    .get();
  const reworkTarget = preservedStep !== undefined ? row : latestPrBuild(deps.db, row.todoId);
  const prClosed: 'merged' | 'closed' | null =
    reworkTarget !== null
      ? await probeReworkTargetPr(
          deps,
          reworkTarget,
          todoRecord,
          githubPrOf(deps, todoRecord, reworkTarget.prNumber) !== null,
        )
      : null;
  const afterCommit: (() => void)[] = [];
  const transcriptDeps = { ...deps, afterCommit };
  const recordRestartConversation = (conversationId: string) => {
    completeClientMessage(deps.db, buildId, body.clientMessageId, {
      delegated: true,
      delivered: 'restart',
      conversationId,
    });
    beforeCommit?.();
  };
  deps.db.transaction(() => {
    claimClientMessage(deps.db, buildId, body.clientMessageId, {
      delegated: true,
      delivered: 'restart',
    });
    const current = getTodo(deps, row.todoId);
    if (
      !current ||
      current.archivedAt !== null ||
      current.phase !== 'failed' ||
      current.latestBuildId !== row.id
    )
      throw new HttpError(
        409,
        'Task changed while restart was being prepared; retry from its current state.',
      );
    todoRecord = current;
    if (origin === 'automatic') assertAutomaticRetryAllowed(deps, current.id);
    if (reworkTarget !== null && prClosed === null) {
      const currentTarget = deps.db.select().from(build).where(eq(build.id, reworkTarget.id)).get();
      if (currentTarget) assertParkedBuildIdle(deps, currentTarget);
      if (hasActiveStep(deps, reworkTarget.id))
        throw new HttpError(409, 'Wait for active steps to finish before restarting this build.');
      const now = nowMs();
      const reuseLessons = feedbackText !== null ? retryLessonsOf(deps.db, buildId) : null;
      recordBuildFeedback(deps.db, buildId, 'restart', 'build', body.feedback, actorName);
      if (feedbackText !== null) {
        insertMessageRow(transcriptDeps, reworkTarget.id, {
          id: newRecordId(),
          role: 'user',
          content: feedbackText,
          createdAt: now,
        });
      }
      if (
        reworkTarget.errorMessage !== null &&
        !hasFailureRow(deps, reworkTarget.id, reworkTarget.errorMessage)
      ) {
        insertMessageRow(transcriptDeps, reworkTarget.id, {
          id: newRecordId(),
          role: 'system',
          content: buildFailureRowContent({
            reason: reworkTarget.errorMessage,
            pr:
              reworkTarget.prNumber !== null
                ? { number: reworkTarget.prNumber, url: reworkTarget.prUrl }
                : null,
          }),
          createdAt: now - 1,
        });
      }
      insertMessageRow(transcriptDeps, reworkTarget.id, {
        id: newRecordId(),
        role: 'system',
        content: buildReworkReuseNote({ prNumber: reworkTarget.prNumber }),
        createdAt: now,
      });
      const restartPrompt = feedbackText !== null ? buildRestartPrompt(feedbackText) : undefined;
      const reuseKind = buildRunsSession(deps, reworkTarget.id)
        ? 'session'
        : reworkTarget.withPlan
          ? 'plan'
          : 'build';
      recordRestartConversation(reworkTarget.id);
      enqueueStep(
        deps,
        reworkTarget.id,
        reuseKind,
        todoRecord.teamId,
        withRetryLessons(
          restartPrompt,
          reuseKind === 'session' ? 'build' : reuseKind,
          reuseLessons,
        ),
        true,
        origin === 'person',
      );
      deps.db
        .update(build)
        .set({
          errorMessage: null,
          prevPhase: 'failed',
        })
        .where(eq(build.id, reworkTarget.id))
        .run();
      setTodoPhase(deps, todoRecord.id, 'queued', {
        latestBuildId: reworkTarget.id,
        lastRunAt: now,
      });
      const reusedRow = deps.db.select().from(build).where(eq(build.id, reworkTarget.id)).get();
      if (!reusedRow) throw new Error('build missing after update');
      publishBuild(deps, reusedRow);
      return;
    }
    const priorLessons = feedbackText !== null ? retryLessonsOf(deps.db, buildId) : null;
    recordBuildFeedback(deps.db, buildId, 'restart', 'build', body.feedback, actorName);
    const newId = newUuidv7();
    const createdAt = nowMs();
    deps.db
      .insert(build)
      .values({
        id: newId,
        todoId: todoRecord.id,
        withPlan: false,
        prevPhase: todoRecord.phase,
        triggerSource: 'user',
        planDocId: null,
        errorMessage: null,
        prUrl: null,
        prNumber: null,
        changes: null,
        diffHash: null,
        createdAt,
      })
      .run();
    if (feedbackText !== null) {
      insertMessageRow(transcriptDeps, newId, {
        id: newRecordId(),
        role: 'user',
        content: feedbackText,
        createdAt,
      });
    }
    if (prClosed !== null && reworkTarget !== null) {
      insertMessageRow(transcriptDeps, newId, {
        id: newRecordId(),
        role: 'system',
        content: buildReworkNewBranchNote({
          prNumber: reworkTarget.prNumber,
          prUrl: reworkTarget.prUrl,
          branch: conversationBranch(newId),
          outcome: prClosed,
        }),
        createdAt,
      });
    }
    const restartPrompt = feedbackText !== null ? buildRestartPrompt(feedbackText) : undefined;
    recordRestartConversation(newId);
    enqueueStep(
      deps,
      newId,
      'session',
      todoRecord.teamId,
      [SESSION_BRIEF, restartPrompt, priorLessons].filter((part) => part != null).join('\n\n'),
      false,
      origin === 'person',
    );
    setTodoPhase(deps, todoRecord.id, 'queued', {
      latestBuildId: newId,
      lastRunAt: createdAt,
    });
    const newRow = deps.db.select().from(build).where(eq(build.id, newId)).get();
    if (!newRow) throw new Error('build missing after insert');
    publishBuild(deps, newRow);
    return;
  });
  for (const publish of afterCommit) publish();
}
