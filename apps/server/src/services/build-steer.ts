import {
  ACTIVE_STEP_STATUSES,
  ANSWERS_CONTINUE_PROMPT,
  buildReworkNewBranchNote,
  conversationBranch,
  isWaitingPhase,
  prNumberFromUrl,
  TASK_ARCHIVED,
} from '@cairn/shared';
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  autonomousMergeAdmission,
  build,
  queuedMessage,
  schedule,
  steerPending,
  step,
  todo,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, newUuidv7, nowMs } from '../lib/ids.js';
import { addUserMessageAttachmentGrants } from './attachment-authorization.js';
import { probeReworkTargetPr } from './build-pr-probe.js';
import {
  assertParkedBuildIdle,
  BuildContinuationPhaseError,
  type BuildDeps,
  type BuildSteerOptions,
  endDeadBuildTurn,
  enqueueStep,
  githubPrOf,
  publishBuild,
} from './builds.js';
import {
  claimClientMessage,
  completeClientMessage,
  findClientMessage,
  replayAfterConflict,
} from './client-message.js';
import { projectOfTodo } from './git.js';
import { externalClientMessageId, moveQueuedMessages, refuseRemovedSend } from './queued-send.js';
import { assertAutomaticRetryAllowed } from './retry-parking.js';
import { setTodoPhase } from './todos.js';
import { insertMessageRow } from './transcript.js';
import { cancelPendingWorkerQuestions } from './worker-question-store.js';
import { settleQuestionAnswers, settleWorkerReply } from './worker-questions.js';

type BuildRow = typeof build.$inferSelect;
type TodoRow = typeof todo.$inferSelect;

function continuationTodo(
  deps: BuildDeps,
  buildRow: BuildRow,
  options: BuildSteerOptions,
): TodoRow {
  const row = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  const active = deps.db
    .select({ id: step.id })
    .from(step)
    .where(and(eq(step.buildId, buildRow.id), inArray(step.status, [...ACTIVE_STEP_STATUSES])))
    .get();
  const stopped =
    deps.db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, buildRow.id), eq(step.status, 'stopped')))
      .get() !== undefined;
  const resumable =
    row?.phase === 'done' ||
    row?.phase === 'building' ||
    (options.allowReviewContinuation === true && row?.phase === 'review') ||
    (options.afterTurn === true &&
      options.schedule === undefined &&
      options.actor === undefined &&
      row?.phase === 'stopped') ||
    row?.phase === 'needs_input' ||
    (options.afterTurn === true &&
      row !== undefined &&
      (['planning', 'confirm', 'review', 'failed'].includes(row.phase) ||
        (row.phase === 'todo' && stopped)));
  if (row && row.archivedAt === null && row.latestBuildId === buildRow.id && (!resumable || active))
    throw new BuildContinuationPhaseError();
  if (
    !row ||
    row.archivedAt !== null ||
    !resumable ||
    row.latestBuildId !== buildRow.id ||
    active
  ) {
    throw new HttpError(
      409,
      'conversation must have an active step or be the completed task thread',
    );
  }
  return row;
}

function ensureBuildPrNumber(deps: BuildDeps, row: BuildRow): BuildRow {
  if (row.prNumber !== null) return row;
  const parsed = prNumberFromUrl(row.prUrl);
  if (parsed === null) return row;
  deps.db.update(build).set({ prNumber: parsed }).where(eq(build.id, row.id)).run();
  const updated = deps.db.select().from(build).where(eq(build.id, row.id)).get();
  if (updated === undefined) return row;
  publishBuild(deps, updated);
  return updated;
}

export interface BuildSteerResult {
  conversationId: string;
  message: { id: string; role: 'user'; content: string; createdAt: number };
  delivered: 'steer' | 'new-turn';
}

export async function sendBuildSteer(
  deps: BuildDeps,
  conversationId: string,
  body: { content: string; queuedMessageId?: string; clientMessageId?: string },
  options: BuildSteerOptions | boolean = {},
): Promise<BuildSteerResult> {
  const rawOptions = typeof options === 'boolean' ? { afterTurn: options } : options;
  const { db } = deps;
  let buildRow = db.select().from(build).where(eq(build.id, conversationId)).get();
  const todoId = buildRow?.todoId;
  const settled = () => {
    if (todoId !== undefined && body.clientMessageId !== undefined)
      refuseRemovedSend(db, todoId, body.clientMessageId);
    const stored = findClientMessage<BuildSteerResult>(db, conversationId, body.clientMessageId);
    const replaced = rawOptions.replacing?.messageId;
    return replaced !== undefined && stored?.message.id === replaced ? undefined : stored;
  };
  const replay = settled();
  if (replay !== undefined) return replay;
  if (!buildRow) throw new HttpError(404, `conversation ${conversationId}`);
  const automatic = (rawOptions.human ?? deps.steerOptions?.human) !== true;
  if (automatic) assertAutomaticRetryAllowed(deps, buildRow.todoId);
  else assertParkedBuildIdle(deps, buildRow);
  const deadTurnEnded =
    !automatic && !rawOptions.schedule ? endDeadBuildTurn(deps, conversationId) : false;
  const continuationOptions = deadTurnEnded ? { ...rawOptions, afterTurn: true } : rawOptions;
  const running = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, conversationId), eq(step.status, 'claimed')))
    .all()
    .at(-1);
  let todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow?.phase === 'closed' && todoRow.archivedAt === null)
    throw new BuildContinuationPhaseError();
  if (!todoRow || todoRow.archivedAt !== null || todoRow.latestBuildId !== conversationId)
    throw new HttpError(
      409,
      'Task cannot accept a message',
      todoRow?.archivedAt != null ? TASK_ARCHIVED : undefined,
    );
  let targetBuildId = conversationId;
  let prClosed: 'closed' | null = null;
  if (running && continuationOptions.schedule) {
    throw new HttpError(409, 'Scheduled continuation requires an idle thread');
  }
  if (!running) {
    todoRow = continuationTodo(deps, buildRow, continuationOptions);
    buildRow = ensureBuildPrNumber(deps, buildRow);
    if (projectOfTodo(db, todoRow)?.repoKind === 'local') {
      const admission = db
        .select()
        .from(autonomousMergeAdmission)
        .where(eq(autonomousMergeAdmission.buildId, buildRow.id))
        .get();
      const landedStep = db
        .select({ id: step.id })
        .from(step)
        .where(
          and(
            eq(step.buildId, buildRow.id),
            eq(step.kind, 'merge'),
            eq(step.status, 'done'),
            isNotNull(step.checkpointCommit),
          ),
        )
        .get();
      if (admission?.state === 'merged' || landedStep) targetBuildId = newUuidv7();
    }
    if (githubPrOf(deps, todoRow, buildRow.prNumber) !== null) {
      const outcome = await probeReworkTargetPr(deps, buildRow, todoRow, true);
      const settledMeanwhile = settled();
      if (settledMeanwhile !== undefined) return settledMeanwhile;
      todoRow = continuationTodo(deps, buildRow, continuationOptions);
      if (outcome === 'merged') {
        throw new HttpError(
          409,
          `PR #${buildRow.prNumber} is already merged. Create a new task for further changes; this task cannot merge a second delivery.`,
        );
      }
      prClosed = outcome;
      if (prClosed === 'closed') targetBuildId = newUuidv7();
    }
  }
  if (continuationOptions.schedule && targetBuildId !== conversationId) {
    throw new HttpError(
      409,
      'Scheduled continuation would require a new build after the previous delivery. Create a new task.',
    );
  }
  const afterCommit: (() => void)[] = [];
  const transcriptDeps = { ...deps, afterCommit };
  let sent: BuildSteerResult;
  try {
    sent = db.transaction((): BuildSteerResult => {
      continuationOptions.replacing?.commit();
      if (automatic) assertAutomaticRetryAllowed(deps, buildRow.todoId);
      claimClientMessage(db, conversationId, body.clientMessageId);
      if (continuationOptions.schedule) {
        const wake = continuationOptions.schedule;
        const current = db.select().from(schedule).where(eq(schedule.id, wake.id)).get();
        if (!current?.enabled || current.nextRunAt === null || current.nextRunAt > wake.at) {
          throw new HttpError(409, 'Scheduled wake is no longer enabled or due');
        }
        if (wake.createdBy.startsWith('worker:') && isWaitingPhase(todoRow?.phase ?? '')) {
          throw new HttpError(409, 'Worker schedule is waiting at a confirmation or review gate');
        }
        cancelPendingWorkerQuestions(
          deps,
          conversationId,
          'A new scheduled run started before an answer.',
        );
      }
      const queued =
        body.queuedMessageId === undefined
          ? undefined
          : db
              .select()
              .from(queuedMessage)
              .where(
                and(
                  eq(queuedMessage.id, body.queuedMessageId),
                  eq(queuedMessage.conversationId, conversationId),
                ),
              )
              .get();
      if (body.queuedMessageId !== undefined && queued === undefined)
        throw new HttpError(409, 'Queued message was already delivered');
      const now = running ? Math.max(nowMs(), running.createdAt + 1) : nowMs();
      const human =
        continuationOptions.human ?? deps.steerOptions?.human ?? body.queuedMessageId !== undefined;
      if (continuationOptions.answer !== undefined)
        settleQuestionAnswers(deps, conversationId, [continuationOptions.answer]);
      const answered =
        continuationOptions.answer !== undefined ||
        (human && settleWorkerReply(deps, conversationId, body.content) > 0);
      const messageRow = {
        id: running
          ? human
            ? `human-steer-${newRecordId()}`
            : `steer-${newRecordId()}`
          : human
            ? `human-${newRecordId()}`
            : newRecordId(),
        actor: human ? deps.user.displayName : (continuationOptions.actor ?? null),
        role: 'user' as const,
        content: body.content,
        createdAt: now,
        origin: continuationOptions.origin ?? (human ? 'user' : 'synthetic'),
      };
      const keepRetryEpisode = human !== true && todoRow?.phase === 'failed';
      const nextRetryAttempt = !keepRetryEpisode
        ? 0
        : buildRow.retryClass === 'rate_limit'
          ? buildRow.retryAttempt
          : buildRow.retryAttempt + 1;
      const nextRetryWindowStartedAt = keepRetryEpisode
        ? (buildRow.retryWindowStartedAt ?? todoRow?.phaseAt ?? now)
        : null;
      if (targetBuildId !== conversationId) {
        db.insert(build)
          .values({
            id: targetBuildId,
            todoId: buildRow.todoId,
            withPlan: false,
            prevPhase: todoRow?.phase ?? 'done',
            triggerSource: 'user',
            retryAttempt: nextRetryAttempt,
            retryClass: null,
            retryNextAt: null,
            retryWindowStartedAt: nextRetryWindowStartedAt,
            retryParkReason: null,
            failureCode: null,
            failureDetail: null,
            createdAt: now,
          })
          .run();
        insertMessageRow(transcriptDeps, targetBuildId, {
          id: newRecordId(),
          role: 'system',
          content:
            prClosed === 'closed'
              ? buildReworkNewBranchNote({
                  prNumber: buildRow.prNumber,
                  prUrl: buildRow.prUrl,
                  branch: conversationBranch(targetBuildId),
                  outcome: 'closed',
                })
              : `The previous build was merged locally. Continuing this task on a new branch: ${conversationBranch(targetBuildId)}.`,
          createdAt: now,
        });
      }
      if (!continuationOptions.schedule)
        insertMessageRow(
          transcriptDeps,
          targetBuildId,
          {
            ...messageRow,
            ...(queued === undefined
              ? {}
              : { typedAt: queued.createdAt, sentByAgent: queued.sentByAgent ?? false }),
          },
          body.queuedMessageId === undefined
            ? undefined
            : { conversationId, messageId: body.queuedMessageId },
          externalClientMessageId(continuationOptions.sseClientMessageId, body.clientMessageId),
        );
      if (running && !answered) {
        const prior = db
          .select()
          .from(steerPending)
          .where(eq(steerPending.conversationId, conversationId))
          .get();
        const merged =
          prior?.stepId === running.id && prior.sentAt === null
            ? `${prior.content}\n\n${body.content}`
            : body.content;
        db.insert(steerPending)
          .values({ conversationId, stepId: running.id, content: merged, createdAt: now })
          .onConflictDoUpdate({
            target: steerPending.conversationId,
            set: { stepId: running.id, content: merged, createdAt: now, sentAt: null },
          })
          .run();
      }
      const result = {
        conversationId: targetBuildId,
        message: messageRow,
        delivered: running ? ('steer' as const) : ('new-turn' as const),
      };
      completeClientMessage(db, conversationId, body.clientMessageId, result);
      continuationOptions.beforeCommit?.();
      if (todoRow) {
        if (
          !continuationOptions.schedule &&
          (continuationOptions.human ?? deps.steerOptions?.human) !== false
        )
          addUserMessageAttachmentGrants(db, todoRow.id, todoRow.teamId, body.content);
        if (running) {
          deps.machineHub?.steerSignal(todoRow.teamId, running.id);
        } else {
          db.update(build)
            .set({
              errorMessage: null,
              failureCode: null,
              failureDetail: null,
              prevPhase: todoRow?.phase ?? 'done',
              retryAttempt: nextRetryAttempt,
              retryClass: null,
              retryNextAt: null,
              retryWindowStartedAt: nextRetryWindowStartedAt,
              retryParkReason: null,
            })
            .where(eq(build.id, targetBuildId))
            .run();
          const nextPhase =
            todoRow.phase === 'building' || todoRow.phase === 'planning' ? todoRow.phase : 'queued';
          setTodoPhase(deps, todoRow.id, nextPhase, {
            lastRunAt: now,
            latestBuildId: targetBuildId,
          });
          const previousWork = db
            .select({ kind: step.kind })
            .from(step)
            .where(
              and(
                eq(step.buildId, conversationId),
                inArray(step.kind, ['plan', 'build', 'session']),
              ),
            )
            .orderBy(desc(step.createdAt))
            .get();
          const continuedStep = enqueueStep(
            deps,
            targetBuildId,
            continuationOptions.afterTurn && previousWork?.kind === 'plan'
              ? 'plan'
              : previousWork?.kind === 'session'
                ? 'session'
                : 'build',
            todoRow.teamId,
            answered ? ANSWERS_CONTINUE_PROMPT : body.content,
            false,
            human && !continuationOptions.schedule,
            answered ? { kind: 'continue' } : undefined,
          );
          if (continuationOptions.schedule) {
            const wake = continuationOptions.schedule;
            db.update(step)
              .set({ scheduleId: wake.id, scheduledBy: wake.createdBy })
              .where(eq(step.id, continuedStep.id))
              .run();
            insertMessageRow(transcriptDeps, targetBuildId, {
              id: `schedule-wake-${continuedStep.id}`,
              role: 'system',
              content: JSON.stringify({ kind: 'schedule-wake', stepId: continuedStep.id }),
              createdAt: wake.at,
            });
            const marked = db
              .update(schedule)
              .set({
                lastRunAt: wake.at,
                lastRunStatus: 'started',
                lastRunError: null,
                retryNotBefore: null,
                lastRunStepId: continuedStep.id,
                nextRunAt: wake.next,
              })
              .where(
                and(
                  eq(schedule.id, wake.id),
                  eq(schedule.enabled, true),
                  wake.expected === null
                    ? isNull(schedule.nextRunAt)
                    : eq(schedule.nextRunAt, wake.expected),
                ),
              )
              .run().changes;
            if (marked === 0) {
              if (!wake.triggered) {
                throw new HttpError(409, 'Scheduled wake is no longer due');
              }
              const queued = db
                .update(schedule)
                .set({
                  lastRunAt: wake.at,
                  lastRunStatus: 'started',
                  lastRunError: null,
                  retryNotBefore: null,
                  lastRunStepId: continuedStep.id,
                })
                .where(and(eq(schedule.id, wake.id), eq(schedule.enabled, true)))
                .run().changes;
              if (queued === 0) throw new HttpError(409, 'Scheduled wake is no longer due');
            }
          }
          const continued = db.select().from(build).where(eq(build.id, targetBuildId)).get();
          if (continued) publishBuild(deps, continued);
        }
      }
      if (body.queuedMessageId !== undefined)
        db.delete(queuedMessage).where(eq(queuedMessage.id, body.queuedMessageId)).run();
      moveQueuedMessages(db, conversationId, targetBuildId);
      return {
        conversationId: targetBuildId,
        message: messageRow,
        delivered: running ? ('steer' as const) : ('new-turn' as const),
      };
    });
  } catch (error) {
    return replayAfterConflict<BuildSteerResult>(db, conversationId, body.clientMessageId, error);
  }
  for (const publish of afterCommit) publish();
  return sent;
}
