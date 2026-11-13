import type {
  BuildMergePermission,
  BuildRecord,
  GithubRepoRef,
  GitIdentity,
  MachineDoneBody,
  MergeReadiness,
  Phase,
  ReviewGate,
  ReviewVerdict,
  SecretBox,
  StepJournalRow,
  StepKind,
  StepPromptOrigin,
  StepRecord,
  TriggerSource,
  UserRecord,
} from '@cairn/shared';
import {
  ACTIVE_STEP_STATUSES,
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  ANSWERS_CONTINUE_PROMPT,
  BUILD_FAILURE_ROW_KIND,
  buildFailureRowContent,
  buildPlanContractRewritePrompt,
  buildPlanRewritePrompt,
  buildReplanPrompt,
  buildRestartPrompt,
  buildReviewRejectPrompt,
  buildReviewStepPrompt,
  buildReworkNewBranchNote,
  buildReworkReuseNote,
  buildTaskPromptText,
  buildVerifyStepPrompt,
  CONFIRM_ANNOUNCEMENT,
  checkPlanContract,
  conversationBranch,
  DEFAULT_SHIP_ROUTE,
  EVIDENCE_PREFIX,
  GATE_LIMITS,
  hasBlockingFinding,
  isActiveStepStatus,
  isBuildStepKind,
  isPlanContractRewritePrompt,
  isWaitingPhase,
  MERGE_ANNOUNCEMENT,
  PLAN_PRIOR_ART_RULE,
  type PlanContractCheck,
  parseGithubIssueSourceRef,
  parseReviewPromptMeta,
  parseVerifyPromptMeta,
  planVerificationItems,
  prNumberFromUrl,
  projectMergeConfigSchema,
  REVIEW_ANNOUNCEMENT,
  REVIEW_VERDICT_KIND,
  type RouteOverride,
  reconcileVerifyVerdict,
  SESSION_BRIEF,
  SESSION_REWORK_BRIEF,
  STOP_MESSAGE,
  type StopAttribution,
  systemRowOf,
  type TodoOutputKind,
  UNSTARTED_STEP_STATUSES,
  VERIFY_ANNOUNCEMENT,
  VERIFY_VERDICT_KIND,
  type VerifyVerdict,
  withCoAuthor,
  withRetryLessons,
} from '@cairn/shared';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  autonomousMergeAdmission,
  build,
  buildFeedback,
  chief,
  chiefMessage,
  gateVerdict,
  machine,
  message,
  plan as planTable,
  project,
  queuedMessage,
  schedule,
  steerPending,
  step,
  stopPending,
  todo,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { systemGitOps } from '../lib/git.js';
import {
  type FetchLike,
  type GithubMergeResult,
  githubMergePull,
  githubPull,
  githubPullState,
  hasPullFields,
  isFullSha,
  isOwnPull,
  WRITE_AUTHOR_ASSOCIATIONS,
} from '../lib/github.js';
import { newRecordId, newUuidv7, nowMs } from '../lib/ids.js';
import { emitRuntimeBuildSpan } from '../runtime-otel.js';
import { receivesAnswers, undeliveredAnswers } from './answer-delivery.js';
import { addUserMessageAttachmentGrants } from './attachment-authorization.js';
import { claimAutonomousMerge, settleAutonomousMerge } from './autonomous-merge.js';
import { BLOCKED_STEP_KINDS, blockedHold, blockedNow } from './blockers.js';
import { recordBuildFeedback } from './build-provenance.js';
import { askUndeliveredOnce, undeliveredEnd } from './build-undelivered.js';
import { askQuestionContentOf } from './chief-questions.js';
import {
  claimClientMessage,
  completeClientMessage,
  findClientMessage,
  replayAfterConflict,
} from './client-message.js';
import { assertCorrectionDone } from './correction.js';
import { DONE_ROW } from './delivery-rows.js';
import { stepActivityAt } from './dispatch-timeouts.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import { markFirstPrPromptDue } from './first-pr-report.js';
import {
  githubRepoOfProject,
  hasRepoBinding,
  projectOfTodo,
  readBuildChanges,
  repoDirFor,
} from './git.js';
import { githubReadToken } from './github-autonomous-token.js';
import { readGithubAutonomyPause } from './github-autonomy-brake.js';
import { teamUserToken } from './github-connection.js';
import { githubText } from './github-text.js';
import { humanWorkIdentity } from './github-work-attribution.js';
import type { HarnessEvalDispatchPort } from './harness-eval-coordinator.js';
import { buildHostedMergeInstruction } from './hosted-merge-instruction.js';
import { storeInfoReport } from './info-handoff.js';
import { enqueueLocalMerge } from './local-merge.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { readCompareAt } from './merge-gate/github-facts.js';
import { isCodexReviewModel } from './merge-gate/model-identity.js';
import { bindGateVerdict } from './merge-gate/verdict.js';
import { githubGateReadPort } from './merge-gate-github.js';
import { assertMergeRequiredChecks } from './merge-required-checks.js';
import { effectiveModel } from './model-fallback.js';
import { resolveNamedPrompt } from './named-prompts.js';
import type { OAuthClientConfig } from './oauth.js';
import { assertPhaseTransition, canTransitionPhase } from './phase.js';
import { planHasOpenDecisions } from './plan-decisions.js';
import { ensurePullClosesTaskIssue } from './pr-closing-line.js';
import { projectMergeConfigOf, projectShipRouteOf } from './projects.js';
import type { VapidKeys } from './push.js';
import { publishStepRow, toQuotaWait } from './quota-wait.js';
import { holdSecondRejectionRework } from './research-stuck.js';
import { retryLessonsOf } from './retry-lessons.js';
import { assertAutomaticRetryAllowed, parkFailedBuild, retryIsParked } from './retry-parking.js';
import { policyForStep, profileForStep, routeForStep } from './routing-rules.js';
import { finishScheduledStep } from './schedules.js';
import {
  appendShipGateInstruction,
  CUSTOM_NEEDS_PR,
  hasGithubPr,
  judgeShip,
  parseShipGateInstruction,
  settleAbandonedShip,
} from './ship-gate.js';
import { endSnoozeOn } from './snooze.js';
import { assertSplitProposalExecutable } from './split-proposal.js';
import { stepQueueProjector } from './step-queue.js';
import { readTeamAttributionSettings } from './team-attribution-settings.js';
import {
  abandonsQuestions,
  childrenOfTodo,
  getTodo,
  setTodoPhase,
  settleSplitOnDone,
} from './todos.js';
import { insertGateAnnouncement, insertMessageRow } from './transcript.js';
import {
  blockingWorkerQuestions,
  cancelPendingWorkerQuestions,
  pendingWorkerQuestions,
} from './worker-question-store.js';
import {
  type QuestionAnswer,
  settleQuestionAnswers,
  settleWorkerReply,
} from './worker-questions.js';

export interface BuildDeps {
  githubAppTokenSocket?: string | null | undefined;
  githubAppIdentity?: GitIdentity | null | undefined;
  steerOptions?: Pick<BuildSteerOptions, 'human'>;
  db: Db;
  hub: TeamStreamHub;
  machineHub?: MachineWakeHub;
  user: UserRecord;
  vapidKeys?: VapidKeys | null;
  convHub?: ConversationStreamHub;
  reposDir?: string;
  box?: SecretBox;
  githubFetch?: FetchLike;
  oauthClient?: OAuthClientConfig | null;
  attachmentsDir?: string;
  gitOps?: typeof systemGitOps;
  mergeVerdict?: (buildId: string) => Promise<MergeReadiness | null>;
  harnessEval?: {
    dispatch: HarnessEvalDispatchPort;
    attemptTimeoutMs?: number;
    now?: () => number;
    dispatchAuthorized?: boolean;
  };
}

type BuildRow = typeof build.$inferSelect;
type TodoRow = typeof todo.$inferSelect;

export function toBuildRecord(row: BuildRow): BuildRecord {
  return {
    id: row.id,
    todoId: row.todoId,
    withPlan: row.withPlan,
    prevPhase: row.prevPhase ?? null,
    triggerSource: row.triggerSource,
    planDocId: row.planDocId,
    errorMessage: row.errorMessage,
    prUrl: row.prUrl,
    prNumber: row.prNumber,
    diffHash: row.diffHash,
    reportAttachmentId: row.reportAttachmentId,
    stop: row.stop,
    createdAt: row.createdAt,
  };
}

function recordStop(db: Db, buildId: string, by: StopAttribution): void {
  db.update(build)
    .set({ stop: { ...by, at: nowMs() } })
    .where(eq(build.id, buildId))
    .run();
}

function clearStop(db: Db, buildId: string): void {
  db.update(build).set({ stop: null }).where(eq(build.id, buildId)).run();
}

function publishBuild(deps: BuildDeps, row: BuildRow): BuildRecord {
  const record = toBuildRecord(row);
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (todoRow) deps.hub.publishBuildDoc(todoRow.teamId, record);
  return record;
}

export class BuildContinuationPhaseError extends HttpError {
  constructor() {
    super(409, 'Conversation phase cannot accept a continuation');
  }
}

interface BuildSteerOptions {
  allowReviewContinuation?: boolean;
  afterTurn?: boolean;
  human?: boolean;
  actor?: string;
  schedule?: { id: string; createdBy: string; at: number };
  answer?: QuestionAnswer;
  beforeCommit?: () => void;
}

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
  const continuationOptions = typeof options === 'boolean' ? { afterTurn: options } : options;
  const { db } = deps;
  const replay = findClientMessage<BuildSteerResult>(db, conversationId, body.clientMessageId);
  if (replay !== undefined) return replay;
  let buildRow = db.select().from(build).where(eq(build.id, conversationId)).get();
  if (!buildRow) throw new HttpError(404, `conversation ${conversationId}`);
  if ((continuationOptions.human ?? deps.steerOptions?.human) !== true)
    assertAutomaticRetryAllowed(deps, buildRow.todoId);
  else assertParkedBuildIdle(deps, buildRow);
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
    throw new HttpError(409, 'Task cannot accept a message');
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
      const settledMeanwhile = findClientMessage<BuildSteerResult>(
        db,
        conversationId,
        body.clientMessageId,
      );
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
      }
      if (
        body.queuedMessageId !== undefined &&
        !db
          .select({ id: queuedMessage.id })
          .from(queuedMessage)
          .where(
            and(
              eq(queuedMessage.id, body.queuedMessageId),
              eq(queuedMessage.conversationId, conversationId),
            ),
          )
          .get()
      )
        throw new HttpError(409, 'Queued message was already delivered');
      const now = nowMs();
      const human =
        continuationOptions.human ?? deps.steerOptions?.human ?? body.queuedMessageId !== undefined;
      if (continuationOptions.answer !== undefined)
        settleQuestionAnswers(deps, conversationId, [continuationOptions.answer]);
      const answered =
        continuationOptions.answer !== undefined ||
        (human && settleWorkerReply(deps, conversationId, body.content) > 0);
      const messageRow = {
        id: human ? `human-${newRecordId()}` : newRecordId(),
        actor: human ? deps.user.displayName : (continuationOptions.actor ?? null),
        role: 'user' as const,
        content: body.content,
        createdAt: now,
      };
      if (targetBuildId !== conversationId) {
        db.insert(build)
          .values({
            id: targetBuildId,
            todoId: buildRow.todoId,
            withPlan: false,
            prevPhase: todoRow?.phase ?? 'done',
            triggerSource: 'user',
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
          messageRow,
          body.queuedMessageId === undefined
            ? undefined
            : { conversationId, messageId: body.queuedMessageId },
        );
      if (running && !answered) {
        db.insert(steerPending)
          .values({ conversationId, stepId: running.id, content: body.content, createdAt: now })
          .onConflictDoUpdate({
            target: steerPending.conversationId,
            set: { stepId: running.id, content: body.content, createdAt: now },
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
            .set({ errorMessage: null, prevPhase: todoRow?.phase ?? 'done' })
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
          }
          const continued = db.select().from(build).where(eq(build.id, targetBuildId)).get();
          if (continued) publishBuild(deps, continued);
        }
      }
      if (body.queuedMessageId !== undefined)
        db.delete(queuedMessage).where(eq(queuedMessage.id, body.queuedMessageId)).run();
      if (targetBuildId !== conversationId)
        db.update(queuedMessage)
          .set({ conversationId: targetBuildId })
          .where(eq(queuedMessage.conversationId, conversationId))
          .run();
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
  const fromUser =
    continuationOptions.human ?? deps.steerOptions?.human ?? body.queuedMessageId !== undefined;
  if (fromUser && !continuationOptions.schedule) endSnoozeOn(deps, buildRow.todoId, 'user-message');
  return sent;
}

export async function messageTodo(
  deps: BuildDeps,
  teamId: string,
  todoId: string,
  content: string,
) {
  const row = deps.db
    .select()
    .from(todo)
    .where(and(eq(todo.id, todoId), eq(todo.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `todo ${todoId}`);
  if (row.latestBuildId === null) {
    return {
      todoId,
      conversationId: null,
      posted: false,
      error: 'This todo has no build. Start a build before messaging its worker.',
    };
  }
  const result = await sendBuildSteer(
    deps,
    row.latestBuildId,
    { content },
    { allowReviewContinuation: true },
  );
  return {
    todoId,
    conversationId: result.conversationId,
    posted: true,
    delivered: result.delivered,
  };
}

export function readSteerPending(db: Db, conversationId: string): string[] {
  const pending = db
    .select()
    .from(steerPending)
    .where(eq(steerPending.conversationId, conversationId))
    .get();
  return pending ? [pending.content] : [];
}

function hasLeftExecution(phase: Phase): boolean {
  return phase === 'closed' || phase === 'done' || phase === 'todo';
}

function dropQuestionOnPhaseChange(
  deps: BuildDeps,
  todoRow: typeof todo.$inferSelect,
  to: Phase,
): void {
  if (abandonsQuestions(to) && todoRow.latestBuildId !== null) {
    cancelPendingWorkerQuestions(
      deps,
      todoRow.latestBuildId,
      'The thread moved on before an answer.',
    );
  }
}

function settleAfterStopPhase(deps: BuildDeps, buildId: string, land?: () => void): void {
  deps.db.transaction(() => {
    deps.db.update(build).set({ afterStopPhase: null }).where(eq(build.id, buildId)).run();
    land?.();
  });
}

function landReservedPhase(
  deps: BuildDeps,
  todoRow: typeof todo.$inferSelect,
  desired: Phase,
): void {
  if (todoRow.phase !== desired) {
    dropQuestionOnPhaseChange(deps, todoRow, desired);
    deps.db
      .update(todo)
      .set({
        phase: desired,
        phaseAt: nowMs(),
        v: todoRow.v + 1,
      })
      .where(eq(todo.id, todoRow.id))
      .run();
    const record = getTodo(deps, todoRow.id);
    if (record) {
      deps.hub.publishTodoDoc(record.teamId, record);
    }
  }
  if (desired === 'done') settleSplitOnDone(deps, todoRow.id);
}

export function requestStop(
  deps: BuildDeps,
  buildId: string,
  body: { discard: boolean },
  by: StopAttribution,
): { delegated: boolean } {
  const { db } = deps;
  const buildRow = db.select().from(build).where(eq(build.id, buildId)).get();
  if (!buildRow) throw new NotFoundError(`build ${buildId}`);
  const active = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildId), inArray(step.status, [...ACTIVE_STEP_STATUSES])))
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (!active) {
    throw new HttpError(409, 'no active step on this build (stop 只对运行中的任务生效)');
  }
  recordStop(db, buildId, by);
  if (active.status === 'pending' || active.status === 'waiting_quota') {
    applyStoppedStep(deps, active.id);
    return { delegated: false };
  }
  const now = nowMs();
  db.insert(stopPending)
    .values({ conversationId: buildId, stepId: active.id, discard: body.discard, createdAt: now })
    .onConflictDoUpdate({
      target: stopPending.conversationId,
      set: { stepId: active.id, discard: body.discard, createdAt: now },
    })
    .run();
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow) deps.machineHub?.stopSignal(todoRow.teamId, active.id);
  return { delegated: true };
}

function stopFallbackPhase(db: Db, buildRow: BuildRow): Phase {
  const lastDone = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildRow.id), eq(step.status, 'done')))
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (lastDone) return lastDone.kind === 'plan' ? 'confirm' : 'review';
  return buildRow.prevPhase ?? 'todo';
}

export function stoppedBeforeFirstRun(
  db: Db,
  row: Pick<typeof todo.$inferSelect, 'phase' | 'latestBuildId'>,
): boolean {
  if (row.phase !== 'todo' || row.latestBuildId === null) return false;
  const latest = db.select().from(build).where(eq(build.id, row.latestBuildId)).get();
  if (latest?.errorMessage !== STOP_MESSAGE) return false;
  const steps = db
    .select({ status: step.status })
    .from(step)
    .where(eq(step.buildId, latest.id))
    .all();
  return steps.length > 0 && steps.every((s) => s.status === 'stopped');
}

function releaseUnissuedMergeAdmission(db: Db, row: typeof step.$inferSelect): void {
  if (row.kind !== 'merge') return;
  if (row.prompt?.includes('"local-merge"') && (row.status === 'claimed' || row.claimedAt !== null))
    return;
  settleAutonomousMerge(db, row.buildId, 'refused');
}

export function applyStoppedStep(deps: BuildDeps, stepId: string): void {
  const { db } = deps;
  const stepRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow) throw new NotFoundError(`step ${stepId}`);
  if (settleParkedStep(deps, stepRow, { status: 'stopped' })) return;
  releaseUnissuedMergeAdmission(db, stepRow);
  db.update(step)
    .set({ status: 'stopped', finishedAt: nowMs(), archiveStop: null })
    .where(eq(step.id, stepId))
    .run();
  finishScheduledStep(deps, stepRow, { status: 'stopped' });
  db.delete(stopPending).where(eq(stopPending.stepId, stepId)).run();
  const stoppedRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (stoppedRow) publishStepRow(deps, stoppedRow);
  const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return;
  db.update(build).set({ errorMessage: STOP_MESSAGE }).where(eq(build.id, buildRow.id)).run();
  const cancelledRow = db.select().from(build).where(eq(build.id, buildRow.id)).get();
  if (cancelledRow) publishBuild(deps, cancelledRow);
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) return;
  const desired = buildRow.afterStopPhase;
  if (desired === 'done') {
    settleAfterStopPhase(deps, buildRow.id, () => landReservedPhase(deps, todoRow, 'done'));
    return;
  }
  settleAfterStopPhase(deps, buildRow.id);
  if (stepRow.archiveStop === null && desired === 'keep') return;
  if (todoRow.latestBuildId !== buildRow.id || hasLeftExecution(todoRow.phase)) return;
  const target = stopFallbackPhase(db, buildRow);
  if (todoRow.phase === target) return;
  dropQuestionOnPhaseChange(deps, todoRow, target);
  db.update(todo)
    .set({
      phase: target,
      phaseAt: nowMs(),
      v: todoRow.v + 1,
    })
    .where(eq(todo.id, todoRow.id))
    .run();
  const record = getTodo(deps, todoRow.id);
  if (record) deps.hub.publishTodoDoc(record.teamId, record);
}

function releaseZombieQueued(
  deps: BuildDeps,
  buildRow: BuildRow,
  todoRow: typeof todo.$inferSelect,
  by: StopAttribution,
): void {
  const { db } = deps;
  if (todoRow.archivedAt !== null || todoRow.phase !== 'queued') return;
  recordStop(db, buildRow.id, by);
  if (buildRow.errorMessage === null) {
    db.update(build).set({ errorMessage: STOP_MESSAGE }).where(eq(build.id, buildRow.id)).run();
  }
  const target = stopFallbackPhase(db, buildRow);
  if (todoRow.phase === target) return;
  dropQuestionOnPhaseChange(deps, todoRow, target);
  db.update(todo)
    .set({
      phase: target,
      phaseAt: nowMs(),
      v: todoRow.v + 1,
    })
    .where(eq(todo.id, todoRow.id))
    .run();
  const fresh = db.select().from(build).where(eq(build.id, buildRow.id)).get();
  if (fresh) publishBuild(deps, fresh);
  const record = getTodo(deps, todoRow.id);
  if (record) deps.hub.publishTodoDoc(record.teamId, record);
}

export function cancelBuild(
  deps: BuildDeps,
  buildId: string,
  by: StopAttribution,
): 'stopped' | 'delegated' | 'released' | 'not-found' {
  const { db } = deps;
  const buildRow = db.select().from(build).where(eq(build.id, buildId)).get();
  if (!buildRow) return 'not-found';
  const active = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildId), inArray(step.status, [...ACTIVE_STEP_STATUSES])))
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (!active) {
    const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (!todoRow) return 'released';
    releaseZombieQueued(deps, buildRow, todoRow, by);
    return 'released';
  }
  recordStop(db, buildId, by);
  if (active.status === 'pending' || active.status === 'waiting_quota') {
    applyStoppedStep(deps, active.id);
    emitRuntimeBuildSpan(deps.db, buildId, 'cancelled');
    return 'stopped';
  }
  const now = nowMs();
  db.insert(stopPending)
    .values({ conversationId: buildId, stepId: active.id, discard: true, createdAt: now })
    .onConflictDoUpdate({
      target: stopPending.conversationId,
      set: { stepId: active.id, discard: true, createdAt: now },
    })
    .run();
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow) deps.machineHub?.stopSignal(todoRow.teamId, active.id);
  emitRuntimeBuildSpan(deps.db, buildId, 'cancelled');
  return 'delegated';
}

function stopStepKeepPhase(deps: BuildDeps, stepId: string): void {
  const { db } = deps;
  const stepRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow) throw new NotFoundError(`step ${stepId}`);
  if (stepRow.archiveStop !== null) {
    applyStoppedStep(deps, stepId);
    return;
  }
  releaseUnissuedMergeAdmission(db, stepRow);
  db.update(step)
    .set({ status: 'stopped', finishedAt: nowMs(), archiveStop: null })
    .where(eq(step.id, stepId))
    .run();
  finishScheduledStep(deps, stepRow, { status: 'stopped' });
  db.delete(stopPending).where(eq(stopPending.stepId, stepId)).run();
  const stoppedRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (stoppedRow) publishStepRow(deps, stoppedRow);
  const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return;
  db.update(build).set({ errorMessage: STOP_MESSAGE }).where(eq(build.id, buildRow.id)).run();
  const cancelledRow = db.select().from(build).where(eq(build.id, buildRow.id)).get();
  if (cancelledRow) publishBuild(deps, cancelledRow);
}

export function stopUnclaimedGateSteps(
  deps: BuildDeps,
  buildId: string,
): (typeof step.$inferSelect)['kind'][] {
  const rows = deps.db
    .select()
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        inArray(step.status, [...UNSTARTED_STEP_STATUSES]),
        inArray(step.kind, ['verify', 'review']),
      ),
    )
    .all();
  for (const row of rows) {
    const finishedAt = nowMs();
    deps.db.update(step).set({ status: 'stopped', finishedAt }).where(eq(step.id, row.id)).run();
    finishScheduledStep(deps, row, { status: 'stopped' });
    publishStepRow(deps, { ...row, status: 'stopped', finishedAt });
  }
  return rows.map((r) => r.kind);
}

export type StopAndMarkDoneResult = { state: 'ready' } | { state: 'stopping' };

export function prepareStopForDone(
  deps: BuildDeps,
  todoId: string,
  by: StopAttribution,
): StopAndMarkDoneResult {
  return prepareStopFor(deps, todoId, 'done', by);
}

export function stopActiveStepsAfterExit(
  deps: BuildDeps,
  todoId: string,
  by: StopAttribution,
): void {
  prepareStopFor(deps, todoId, 'exit', by);
}

export function stopActiveStepsForArchive(
  deps: BuildDeps,
  todoId: string,
  by: StopAttribution,
): void {
  const rows = deps.db
    .select({ stepRow: step, teamId: todo.teamId })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(and(eq(todo.id, todoId), inArray(step.status, [...ACTIVE_STEP_STATUSES])))
    .all();
  for (const buildId of new Set(rows.map((r) => r.stepRow.buildId)))
    recordStop(deps.db, buildId, by);
  for (const { stepRow, teamId } of rows) {
    deps.db.update(step).set({ archiveStop: 'requested' }).where(eq(step.id, stepRow.id)).run();
    deps.db.delete(stopPending).where(eq(stopPending.stepId, stepRow.id)).run();
    if (stepRow.status !== 'claimed') applyStoppedStep(deps, stepRow.id);
    else deps.machineHub?.stopSignal(teamId, stepRow.id);
  }
}

function prepareStopFor(
  deps: BuildDeps,
  todoId: string,
  after: 'done' | 'exit',
  by: StopAttribution,
): StopAndMarkDoneResult {
  const { db } = deps;
  const todoRow = db.select().from(todo).where(eq(todo.id, todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${todoId}`);
  if (todoRow.latestBuildId == null) return { state: 'ready' };
  const buildId = todoRow.latestBuildId;
  if (after === 'exit') settleAfterStopPhase(deps, buildId);
  const active = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildId), inArray(step.status, [...ACTIVE_STEP_STATUSES])))
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (!active) return { state: 'ready' };
  recordStop(db, buildId, by);
  if (active.status === 'pending' || active.status === 'waiting_quota') {
    stopStepKeepPhase(deps, active.id);
    return { state: 'ready' };
  }
  const now = nowMs();
  db.transaction(() => {
    db.update(build)
      .set({ afterStopPhase: after === 'done' ? 'done' : 'keep' })
      .where(eq(build.id, buildId))
      .run();
    db.insert(stopPending)
      .values({ conversationId: buildId, stepId: active.id, discard: true, createdAt: now })
      .onConflictDoUpdate({
        target: stopPending.conversationId,
        set: { stepId: active.id, discard: true, createdAt: now },
      })
      .run();
  });
  deps.machineHub?.stopSignal(todoRow.teamId, active.id);
  return { state: 'stopping' };
}

export function sweepZombieQueuedTodos(deps: BuildDeps, _now: number = nowMs()): number {
  const rows = deps.db
    .select()
    .from(todo)
    .where(and(eq(todo.phase, 'queued'), isNull(todo.archivedAt)))
    .all();
  let released = 0;
  for (const todoRow of rows) {
    if (todoRow.latestBuildId === null) continue;
    const buildRow = deps.db.select().from(build).where(eq(build.id, todoRow.latestBuildId)).get();
    if (!buildRow) continue;
    const active = deps.db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, buildRow.id), inArray(step.status, [...ACTIVE_STEP_STATUSES])))
      .all();
    if (active.length > 0) continue;
    releaseZombieQueued(deps, buildRow, todoRow, {
      actor: 'system',
      reason: 'queued build had no active step left',
    });
    released += 1;
  }
  return released;
}

export function enqueueStep(
  deps: BuildDeps,
  buildId: string,
  kind: StepRecord['kind'],
  teamId: string,
  prompt?: string,
  freshSession?: boolean,
  byPerson?: boolean,
  promptOrigin?: StepPromptOrigin,
): StepRecord {
  const current = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (byPerson !== true && current && retryIsParked(current.errorMessage ?? ''))
    throw new HttpError(409, current.errorMessage ?? 'Task parked');
  const id = newRecordId();
  const createdAt = nowMs();
  const owner =
    current === undefined || !BLOCKED_STEP_KINDS.includes(kind)
      ? undefined
      : deps.db.select().from(todo).where(eq(todo.id, current.todoId)).get();
  deps.db
    .insert(step)
    .values({
      id,
      buildId,
      kind,
      machineId: null,
      status: 'pending',
      prompt: prompt ?? null,
      promptOrigin: promptOrigin ?? null,
      freshSession: freshSession === true,
      byPerson: byPerson === true,
      createdAt,
      ...(owner !== undefined && blockedNow(deps.db, owner) ? blockedHold() : {}),
    })
    .run();
  clearStop(deps.db, buildId);
  settleAfterStopPhase(deps, buildId);
  if (isBuildStepKind(kind)) {
    deps.db.update(build).set({ reportLine: null }).where(eq(build.id, buildId)).run();
  }
  deps.machineHub?.wake(teamId);
  deps.convHub?.publishStep(buildId, {
    id,
    buildId,
    kind,
    machineId: null,
    createdAt,
    status: 'pending',
    checkpointCommit: null,
    skillInjection: null,
  });
  return { id, buildId, kind, machineId: null, createdAt };
}

export function getBuild(deps: BuildDeps, id: string): BuildRecord | null {
  const row = deps.db.select().from(build).where(eq(build.id, id)).get();
  return row ? toBuildRecord(row) : null;
}

export function listSteps(deps: BuildDeps, buildId: string): StepJournalRow[] {
  const rows = deps.db
    .select()
    .from(step)
    .where(eq(step.buildId, buildId))
    .orderBy(asc(step.createdAt))
    .all();
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  const pendingIds = rows.filter((r) => r.status === 'pending').map((r) => r.id);
  let queueById: Map<string, StepJournalRow['queue']> | null = null;
  if (pendingIds.length > 0 && buildRow !== undefined) {
    const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (todoRow !== undefined) {
      const projector = stepQueueProjector(deps.db, todoRow.teamId);
      queueById = new Map(
        rows.map((r) => {
          if (r.status !== 'pending') return [r.id, undefined];
          const projected = projector.project({
            id: r.id,
            createdAt: r.createdAt,
            homeMachineId: profileForStep(deps.db, todoRow, r.kind, r.id)?.machineId ?? null,
            holdReason: r.holdReason,
            holdUntil: r.holdUntil,
          });
          return [r.id, projected ?? undefined];
        }),
      );
    }
  }
  return rows.map((r) => ({
    id: r.id,
    buildId: r.buildId,
    kind: r.kind,
    machineId: r.machineId,
    createdAt: r.createdAt,
    status: r.status,
    checkpointCommit: r.checkpointCommit,
    ...(queueById?.get(r.id) !== undefined ? { queue: queueById.get(r.id) } : {}),
    skillInjection: r.skillInjection ?? null,
    ...(r.blockerHandoff !== null ? { blockerHandoff: r.blockerHandoff } : {}),
    ...(r.status === 'waiting_quota' && r.quotaBlock !== null
      ? { quotaWait: toQuotaWait(r.quotaBlock) }
      : {}),
    ...(r.promptOrigin !== null ? { promptOrigin: r.promptOrigin } : {}),
  }));
}

export function assertNamedMachineForNewTask(deps: BuildDeps, teamId: string): void {
  namedMachineForStart(deps, { teamId }, undefined);
}

function namedMachineForStart(
  deps: BuildDeps,
  todoRecord: { teamId: string; routeOverride?: { machineId?: string } | null },
  routeOverride: { machineId?: string } | undefined,
): { machineId: string; pin: boolean } | null {
  const profile = profileForStep(deps.db, todoRecord, 'session', null);
  const named =
    routeOverride?.machineId ?? todoRecord.routeOverride?.machineId ?? profile?.machineId ?? null;
  if (named !== null) return { machineId: named, pin: false };
  const registered = deps.db
    .select({ id: machine.id, online: machine.online })
    .from(machine)
    .where(eq(machine.teamId, todoRecord.teamId))
    .all();
  const online = registered.filter((row) => row.online);
  const onlyOnline = online[0];
  if (online.length === 1 && onlyOnline !== undefined)
    return { machineId: onlyOnline.id, pin: true };
  const onlyRegistered = registered[0];
  if (registered.length === 1 && onlyRegistered !== undefined) {
    return { machineId: onlyRegistered.id, pin: true };
  }
  throw new HttpError(409, 'Name a machine before starting this task');
}

export function startBuilds(
  deps: BuildDeps,
  input: {
    projectId: string;
    todoIds: string[];
    routeOverride?: RouteOverride;
    triggerSource?: TriggerSource;
    scheduledBy?: string;
    prompt?: string;
  },
): BuildRecord[] {
  const triggerSource = input.triggerSource ?? 'user';
  const projectRow = deps.db.select().from(project).where(eq(project.id, input.projectId)).get();
  for (const todoId of input.todoIds) {
    const todoRecord = getTodo(deps, todoId);
    if (!todoRecord || todoRecord.projectId !== input.projectId) {
      throw new NotFoundError(`todo ${todoId}`);
    }
    if (projectRow?.teamId !== todoRecord.teamId) {
      throw new NotFoundError(`project ${input.projectId}`);
    }
    const overrideMachine = input.routeOverride?.machineId;
    if (
      overrideMachine !== undefined &&
      deps.db
        .select({ id: machine.id })
        .from(machine)
        .where(and(eq(machine.id, overrideMachine), eq(machine.teamId, todoRecord.teamId)))
        .get() === undefined
    ) {
      throw new NotFoundError(`machine ${overrideMachine}`);
    }
    const previous =
      todoRecord.latestBuildId === null
        ? undefined
        : deps.db
            .select({ errorMessage: build.errorMessage })
            .from(build)
            .where(eq(build.id, todoRecord.latestBuildId))
            .get();
    if (todoRecord.archivedAt != null) throw new HttpError(409, 'Unarchive to continue');
    if (triggerSource !== 'user') assertAutomaticRetryAllowed(deps, todoId);
    assertSplitProposalExecutable(previous?.errorMessage ?? null);
    namedMachineForStart(deps, todoRecord, input.routeOverride);
  }
  const created: BuildRecord[] = [];
  for (const todoId of input.todoIds) {
    const todoRecord = getTodo(deps, todoId);
    if (!todoRecord) throw new NotFoundError(`todo ${todoId}`);
    assertPhaseTransition(todoRecord.phase, 'queued');
    const named = namedMachineForStart(deps, todoRecord, input.routeOverride);
    const routeOverride =
      input.routeOverride === undefined
        ? named?.pin === true
          ? { machineId: named.machineId }
          : undefined
        : {
            ...input.routeOverride,
            ...(input.routeOverride.machineId === undefined && named !== null
              ? { machineId: named.machineId }
              : {}),
          };
    const id = newUuidv7();
    const createdAt = nowMs();
    deps.db
      .insert(build)
      .values({
        id,
        todoId,
        withPlan: false,
        prevPhase: todoRecord.phase,
        triggerSource,
        scheduledBy: input.scheduledBy ?? null,
        planDocId: null,
        errorMessage: null,
        prUrl: null,
        prNumber: null,
        changes: null,
        diffHash: null,
        createdAt,
      })
      .run();
    const lessons =
      todoRecord.phase === 'failed' && todoRecord.latestBuildId !== null
        ? retryLessonsOf(deps.db, todoRecord.latestBuildId)
        : null;
    enqueueStep(
      deps,
      id,
      'session',
      todoRecord.teamId,
      [SESSION_BRIEF, input.prompt, lessons].filter((part) => part != null).join('\n\n'),
    );
    setTodoPhase(deps, todoId, 'queued', {
      ...(routeOverride !== undefined ? { routeOverride } : {}),
      latestBuildId: id,
      lastRunAt: createdAt,
    });
    const row = deps.db.select().from(build).where(eq(build.id, id)).get();
    if (!row) throw new Error('build missing after insert');
    created.push(publishBuild(deps, row));
  }
  return created;
}

function ticketRefOf(todoRow: { sourceRef: string | null; seqNum: number }): string {
  const linked = todoRow.sourceRef !== null ? parseGithubIssueSourceRef(todoRow.sourceRef) : null;
  return String(linked?.issueNumber ?? todoRow.seqNum);
}

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

export function dispatchSplitChildren(deps: BuildDeps, parentId: string): number {
  let dispatched = 0;
  for (const child of childrenOfTodo(deps.db, parentId).filter((c) => c.phase === 'todo')) {
    try {
      startBuilds(deps, {
        projectId: child.projectId,
        todoIds: [child.id],
        triggerSource: 'chief',
      });
      dispatched += 1;
    } catch (error) {
      console.warn('Split child not dispatched', { parentId, childId: child.id, error });
    }
  }
  return dispatched;
}

function latestPrBuild(db: Db, todoId: string): BuildRow | null {
  return (
    db
      .select()
      .from(build)
      .where(and(eq(build.todoId, todoId), or(isNotNull(build.prUrl), isNotNull(build.prNumber))))
      .orderBy(desc(build.createdAt))
      .all()
      .at(0) ?? null
  );
}

async function probePullState(
  deps: BuildDeps,
  teamId: string,
  projectId: string,
  prNumber: number,
  timeoutMs?: number,
): Promise<{ state: 'open' | 'closed'; merged: boolean } | null> {
  const projRow = projectOfTodo(deps.db, { projectId, teamId });
  const repoRef = githubRepoOfProject(projRow);
  if (repoRef === null) return null;
  const { owner, repo } = repoRef;
  const token = await githubReadToken(deps, teamId, repoRef);
  return githubPullState(deps.githubFetch ?? fetch, token, owner, repo, prNumber, timeoutMs);
}

async function probeReworkTargetPr(
  deps: BuildDeps,
  target: BuildRow,
  todo: { projectId: string; teamId: string },
  requireReadable = false,
): Promise<'merged' | 'closed' | null> {
  if (target.prNumber === null) return null;
  const state = await probePullState(deps, todo.teamId, todo.projectId, target.prNumber);
  if (state === null && requireReadable) {
    throw new HttpError(
      409,
      `Could not read PR #${target.prNumber}. Please retry before continuing this task.`,
    );
  }
  if (state === null || state.state === 'open') return null;
  return state.merged ? 'merged' : 'closed';
}

const MERGED_PR_GUARD_PROBE_TIMEOUT_MS = 5_000;

export async function mergedPrElsewhere(
  deps: BuildDeps,
  todoId: string,
  excludeBuildId: string,
): Promise<{ prNumber: number; prUrl: string | null } | null> {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, todoId)).get();
  if (todoRow === undefined) return null;
  const prior = deps.db
    .select()
    .from(build)
    .where(
      and(
        eq(build.todoId, todoId),
        ne(build.id, excludeBuildId),
        or(isNotNull(build.prUrl), isNotNull(build.prNumber)),
      ),
    )
    .orderBy(desc(build.createdAt))
    .all();
  for (const row of prior) {
    if (row.prNumber === null) continue;
    const state = await probePullState(
      deps,
      todoRow.teamId,
      todoRow.projectId,
      row.prNumber,
      MERGED_PR_GUARD_PROBE_TIMEOUT_MS,
    );
    if (state?.merged) return { prNumber: row.prNumber, prUrl: row.prUrl };
  }
  return null;
}

async function assertNoMergedPrElsewhere(
  deps: BuildDeps,
  row: BuildRow,
  prNumber: number,
): Promise<void> {
  const priorMerged = await mergedPrElsewhere(deps, row.todoId, row.id);
  if (priorMerged !== null) {
    throw new HttpError(
      409,
      `本任务已有已合并的 PR #${priorMerged.prNumber}，本 build 又开了 PR #${prNumber}——疑似重复交付，拒绝发起合并（请人工复核后处理）`,
    );
  }
}

function applyBuildConfirm(deps: BuildDeps, buildId: string, actorName: string): void {
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) throw new NotFoundError(`build ${buildId}`);
  assertSplitProposalExecutable(row.errorMessage);
  const todoRecord = getTodo(deps, row.todoId);
  if (!todoRecord) throw new NotFoundError(`todo ${row.todoId}`);
  if (todoRecord.archivedAt != null) throw new HttpError(409, 'Unarchive to continue');
  if (todoRecord.phase !== 'confirm') {
    throw new HttpError(409, `确认仅适用于待确认（confirm）关口，当前相位 ${todoRecord.phase}`);
  }
  insertGateAnnouncement(deps, buildId, CONFIRM_ANNOUNCEMENT, actorName);
  if (childrenOfTodo(deps.db, todoRecord.id).length > 0) {
    dispatchSplitChildren(deps, todoRecord.id);
    setTodoPhase(deps, todoRecord.id, 'building');
    return;
  }
  setTodoPhase(deps, todoRecord.id, 'building');
  enqueueStep(deps, buildId, 'build', todoRecord.teamId);
}

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
        const currentTarget = deps.db
          .select()
          .from(build)
          .where(eq(build.id, reworkTarget.id))
          .get();
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

function restoreFailedReview(deps: BuildDeps, row: BuildRow): void {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (todoRow?.phase !== 'failed') return;
  assertDeliveredBuild(deps, row);
  setTodoPhase(deps, todoRow.id, 'review');
}

export function buildRunsSession(deps: BuildDeps, buildId: string): boolean {
  return (
    deps.db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, buildId), eq(step.kind, 'session')))
      .get() !== undefined
  );
}

function assertDeliveredBuild(deps: BuildDeps, row: BuildRow): void {
  const { db } = deps;
  const buildStep = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, row.id), inArray(step.kind, ['build', 'session'])))
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  const legDone = buildStep?.status === 'done';
  const artifactIn =
    (buildStep?.checkpointCommit ?? null) !== null || row.prUrl !== null || row.prNumber !== null;
  if (!legDone || !artifactIn) {
    const reason = !legDone ? '执行步未完成交付' : '执行步无交付产物（分支/PR 不在）';
    throw new HttpError(
      409,
      `failed 任务的审核关口恢复仅对本轮已交付的 build 开放（${reason}），请重新运行任务`,
    );
  }
}

function reviewInstructionOf(
  deps: BuildDeps,
  teamId: string,
  gate: ReviewGate,
): string | undefined {
  if (gate !== 'review') return undefined;
  const prompt = resolveNamedPrompt(deps.db, teamId, 'review');
  return prompt.overridden ? prompt.text : undefined;
}

export async function requestMerge(
  deps: BuildDeps,
  buildId: string,
  actor?: string,
): Promise<{ delegated: true }> {
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) throw new NotFoundError(`build ${buildId}`);
  let todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${row.todoId}`);
  if (todoRow.archivedAt !== null) throw new HttpError(409, 'Unarchive to continue');
  if (todoRow.output === 'info') throw new HttpError(409, INFO_CARD_MERGE_REFUSAL);
  assertNoMergeStepInFlight(deps, buildId);
  const projectRow = projectOfTodo(deps.db, todoRow);
  const shipRoute = projectRow === undefined ? DEFAULT_SHIP_ROUTE : projectShipRouteOf(projectRow);
  if (shipRoute === 'local-merge' && projectRow?.repoKind !== 'local') {
    throw new HttpError(409, 'local-merge requires a local repository project');
  }
  if (shipRoute === 'custom' && !hasGithubPr(deps, buildId))
    throw new HttpError(409, CUSTOM_NEEDS_PR);
  const judged = shipRoute === 'merge-gate' ? null : await judgeShip(deps, buildId);
  const pr = shipRoute === 'custom' ? null : githubPrOf(deps, todoRow, row.prNumber);
  if (pr !== null) {
    return mergeThroughGithub(deps, row, pr.prNumber, pr.repoRef, actor ?? deps.user.displayName);
  }
  if (
    projectRow?.repoKind === 'local' &&
    shipRoute !== 'custom' &&
    (shipRoute === 'local-merge' || projectMergeConfigOf(projectRow).mergePolicy === 'autonomous')
  ) {
    if (todoRow.phase === 'failed') assertDeliveredBuild(deps, row);
    else assertPhaseTransition(todoRow.phase, 'done');
    assertMergeTools(deps, todoRow);
    const git = deps.gitOps ?? systemGitOps;
    const localPath = projectRow.localPath;
    if (localPath === null) {
      throw new HttpError(409, '本地项目没有仓库路径，拒绝走未受控合并');
    }
    const listing = await git.listBranches(localPath).catch(() => null);
    if (listing === null || listing.defaultBranch === null) {
      throw new HttpError(409, '无法读取本地仓库默认分支，拒绝走未受控合并');
    }
    const local = await enqueueLocalMerge(
      deps,
      buildId,
      projectRow.baseBranch ?? listing.defaultBranch,
      shipRoute === 'local-merge',
      todoRow.phase === 'failed',
    );
    if (local.enqueued) {
      insertGateAnnouncement(deps, buildId, MERGE_ANNOUNCEMENT, actor ?? deps.user.displayName);
      return { delegated: true };
    }
    const blocking = local.readiness?.blockers ?? [];
    if (blocking.length > 0) {
      throw new HttpError(
        409,
        `本地合并未通过关口判定，无法落地：${blocking.map((b) => b.label).join('；')}`,
      );
    }
    throw new HttpError(409, '本地合并未通过关口判定，无法落地');
  }
  restoreFailedReview(deps, row);
  if (todoRow.phase === 'failed') {
    const restored = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
    if (!restored) throw new NotFoundError(`todo ${row.todoId}`);
    todoRow = restored;
  }
  assertPhaseTransition(todoRow.phase, 'done');
  assertMergeTools(deps, todoRow);
  insertGateAnnouncement(deps, buildId, MERGE_ANNOUNCEMENT, actor ?? deps.user.displayName);
  let prompt: string | undefined;
  if (shipRoute === 'custom' && judged !== null) {
    prompt = appendShipGateInstruction(resolveNamedPrompt(deps.db, todoRow.teamId, 'ship').text, {
      buildId,
      judgedHead: judged.headSha,
    });
  } else if (projectRow?.repoKind === 'hosted' && projectRow.repoName !== null) {
    if (deps.reposDir === undefined) throw new HttpError(409, 'Hosted repository unavailable');
    const dir = repoDirFor(deps.reposDir, todoRow.teamId, projectRow.repoName);
    const { defaultBranch } = await systemGitOps.listBranches(dir);
    prompt = buildHostedMergeInstruction({
      projectId: projectRow.id,
      repoName: projectRow.repoName,
      baseBranch: projectRow.baseBranch ?? defaultBranch ?? 'main',
      configuredBaseBranch: projectRow.baseBranch,
    });
  }
  if (prompt !== undefined) assertNoMergeStepInFlight(deps, buildId);
  enqueueStep(deps, buildId, 'merge', todoRow.teamId, prompt);
  return { delegated: true };
}

function assertNoMergeStepInFlight(deps: BuildDeps, buildId: string): void {
  const inFlight = deps.db
    .select({ id: step.id })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        eq(step.kind, 'merge'),
        inArray(step.status, [...ACTIVE_STEP_STATUSES]),
      ),
    )
    .get();
  if (inFlight) throw new HttpError(409, '这个构建已有一个合并步在排队或在跑，等它结束再发起');
}

export const INFO_CARD_MERGE_REFUSAL =
  '信息卡的产出是报告附件，不进合并：要把内容落进仓库，请建下游代码卡走正常流程';

function githubPrOf(
  deps: BuildDeps,
  todoRow: { projectId: string; teamId: string },
  prNumber: number | null,
): { repoRef: GithubRepoRef; prNumber: number } | null {
  if (prNumber === null) return null;
  const repoRef = githubRepoOfProject(projectOfTodo(deps.db, todoRow));
  return repoRef === null ? null : { repoRef, prNumber };
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

export function buildMergePermission(deps: BuildDeps, buildId: string): BuildMergePermission {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!buildRow) throw new NotFoundError(`build ${buildId}`);
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${buildRow.todoId}`);
  const missingTools = missingMergeTools(deps, todoRow);
  return { permitted: missingTools.length === 0, missingTools, prUrl: buildRow.prUrl };
}

function missingMergeTools(deps: BuildDeps, todoRow: TodoRow): string[] {
  const policy = policyForStep(deps.db, todoRow, 'session');
  if (policy === null || policy.seededFromAgentId === null) return [];
  return [AGENT_TOOL_MERGE, AGENT_TOOL_PUSH].filter((tool) => !policy.tools.includes(tool));
}

function assertMergeTools(deps: BuildDeps, todoRow: TodoRow): void {
  const missingTools = missingMergeTools(deps, todoRow);
  if (missingTools.length > 0) {
    throw new HttpError(
      403,
      `The session work policy lacks 「${missingTools.join('」「')}」, so it cannot start a merge (routing settings, work policies)`,
    );
  }
}

const STEP_KIND_TEXT: Record<StepKind, string> = {
  plan: '规划',
  build: '执行',
  session: '会话',
  merge: '合并',
  chief: '编排',
  review: '审核',
  verify: '验证',
};

const mergingBuilds = new Set<string>();

function stepKindInFlight(deps: BuildDeps, buildId: string): StepKind | null {
  return (
    deps.db
      .select({ kind: step.kind })
      .from(step)
      .where(
        and(
          eq(step.buildId, buildId),
          or(
            eq(step.status, 'claimed'),
            and(
              inArray(step.status, [...UNSTARTED_STEP_STATUSES]),
              notInArray(step.kind, ['verify', 'review']),
            ),
          ),
        ),
      )
      .get()?.kind ?? null
  );
}

export function hasActiveStep(deps: BuildDeps, buildId: string): boolean {
  return mergingBuilds.has(buildId) || stepKindInFlight(deps, buildId) !== null;
}

function assertParkedBuildIdle(deps: BuildDeps, row: BuildRow): void {
  if (retryIsParked(row.errorMessage ?? '') && hasActiveStep(deps, row.id))
    throw new HttpError(
      409,
      `${row.errorMessage} Wait for active steps to finish before retrying.`,
    );
}

export function lastPushedCheckpoint(
  deps: BuildDeps,
  buildId: string,
  opts: { mergeSteps: boolean },
): string | null {
  return (
    deps.db
      .select({ commit: step.checkpointCommit })
      .from(step)
      .where(
        and(
          eq(step.buildId, buildId),
          notInArray(step.kind, opts.mergeSteps ? ['review'] : ['review', 'merge']),
          eq(step.status, 'done'),
          isNotNull(step.checkpointCommit),
        ),
      )
      .orderBy(
        desc(
          sql`coalesce(${step.finishedAt}, ${step.lastHeartbeatAt}, ${step.claimedAt}, ${step.createdAt})`,
        ),
        desc(step.createdAt),
      )
      .get()?.commit ?? null
  );
}

function dispatchHeadSha(deps: BuildDeps, buildId: string): string | null {
  const rows = deps.db
    .select({ commit: step.checkpointCommit })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        notInArray(step.kind, ['review', 'merge', 'verify']),
        eq(step.status, 'done'),
        isNotNull(step.checkpointCommit),
      ),
    )
    .orderBy(
      desc(
        sql`coalesce(${step.finishedAt}, ${step.lastHeartbeatAt}, ${step.claimedAt}, ${step.createdAt})`,
      ),
      desc(step.createdAt),
    )
    .all();
  for (const row of rows) {
    if (row.commit !== null && isFullSha(row.commit)) return row.commit;
  }
  return null;
}

export interface VerdictReport {
  reportedHeadSha: string | null;
  driftedHeads: readonly string[];
}

function expectedHeadOf(stepRow: typeof step.$inferSelect): string | null {
  const expected =
    stepRow.kind === 'review'
      ? (parseReviewPromptMeta(stepRow.prompt)?.expectedHeadSha ?? null)
      : stepRow.kind === 'verify'
        ? (parseVerifyPromptMeta(stepRow.prompt)?.expectedHeadSha ?? null)
        : null;
  return expected !== null && isFullSha(expected) ? expected : null;
}

export function reportedVerdictHeads(
  stepRow: typeof step.$inferSelect,
  reported: { gateHeadSha?: string | undefined; commit?: string | null | undefined },
): VerdictReport {
  const candidates = [reported.gateHeadSha, reported.commit].filter(
    (sha): sha is string => typeof sha === 'string' && isFullSha(sha),
  );
  const expected = expectedHeadOf(stepRow);
  const driftedHeads = expected === null ? [] : candidates.filter((sha) => sha !== expected);
  const pick = stepRow.kind === 'verify' ? driftedHeads.at(-1) : driftedHeads[0];
  return { reportedHeadSha: pick ?? candidates[0] ?? null, driftedHeads };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const verdictDigestsInFlight = new Set<Promise<void>>();

export async function flushVerdictDigests(): Promise<void> {
  await Promise.all([...verdictDigestsInFlight]);
}

function persistGateVerdict(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  facts: { stepFailed: boolean; extracted: boolean; blocked: boolean; report: VerdictReport },
): void {
  if (stepRow.kind !== 'review' && stepRow.kind !== 'verify') return;
  const expectedHeadSha = expectedHeadOf(stepRow);
  if (expectedHeadSha === null) return;
  const bound = bindGateVerdict({
    kind: stepRow.kind,
    perspective: null,
    expectedHeadSha,
    reportedHeadSha: facts.report.reportedHeadSha,
    stepFailed: facts.stepFailed,
    extracted: facts.extracted,
    blocked: facts.blocked,
  });
  if (bound === null) return;
  const inserted = deps.db
    .insert(gateVerdict)
    .values({
      stepId: stepRow.id,
      buildId: stepRow.buildId,
      kind: bound.kind,
      perspective: bound.perspective,
      outcome: bound.outcome,
      patchDigest: null,
      headSha: bound.headSha,
      expectedHeadSha: bound.expectedHeadSha,
      createdAt: nowMs(),
    })
    .onConflictDoNothing({ target: gateVerdict.stepId })
    .run();
  if (inserted.changes === 0) return;
  const driftedHeads = facts.report.driftedHeads;
  const pending = (async (): Promise<void> => {
    const row = deps.db.select().from(gateVerdict).where(eq(gateVerdict.stepId, stepRow.id)).get();
    if (row === undefined || row.patchDigest !== null || row.headSha === null) return;
    const expected = row.expectedHeadSha;
    const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
    if (buildRow?.prNumber == null) return;
    const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (todoRow === undefined) return;
    const repo = githubRepoOfProject(projectOfTodo(deps.db, todoRow));
    if (repo === null) return;
    const token = await githubReadToken(deps, todoRow.teamId, repo);
    if (token === null) return;
    const port = githubGateReadPort(
      deps.githubFetch ?? fetch,
      token,
      repo.owner,
      repo.repo,
      10_000,
    );
    let pathsAfterExpected: string[] | null = null;
    if (row.kind === 'verify' && driftedHeads.length > 0) {
      const names = new Set<string>();
      for (const head of driftedHeads) {
        const read = await readCompareAt(port, expected, head);
        const files = typeof read.compare === 'object' ? read.compare.files : null;
        if (files === null || files.length === 0 || files.length >= GATE_LIMITS.compareFileCap) {
          return;
        }
        for (const f of files) {
          names.add(f.filename);
          if (f.previousFilename !== null) names.add(f.previousFilename);
        }
      }
      pathsAfterExpected = [...names];
    } else if (row.headSha !== expected) {
      return;
    }
    let baseSha: string | null = null;
    const pull = await port.pull(buildRow.prNumber, { etag: null });
    const base = asRecord(pull.kind === 'ok' ? asRecord(pull.body)?.base : null);
    if (typeof base?.sha === 'string' && isFullSha(base.sha)) {
      baseSha = base.sha;
    } else if (typeof base?.ref === 'string' && base.ref !== '') {
      const branch = await port.branch(base.ref, { etag: null });
      const commit = asRecord(branch.kind === 'ok' ? asRecord(branch.body)?.commit : null);
      if (typeof commit?.sha === 'string' && isFullSha(commit.sha)) baseSha = commit.sha;
    }
    if (baseSha === null) return;
    const delivery = await readCompareAt(port, baseSha, expected);
    if (typeof delivery.compare !== 'object') return;
    const bound = bindGateVerdict({
      kind: row.kind,
      perspective: row.perspective,
      expectedHeadSha: expected,
      reportedHeadSha: row.headSha,
      stepFailed: false,
      extracted: true,
      blocked: false,
      compareFiles: delivery.compare.files,
      pathsAfterExpected,
      evidenceDir: `${EVIDENCE_PREFIX}${ticketRefOf(todoRow)}/`,
    });
    if (bound?.patchDigest == null) return;
    deps.db
      .update(gateVerdict)
      .set({ patchDigest: bound.patchDigest })
      .where(
        and(
          eq(gateVerdict.stepId, row.stepId),
          eq(gateVerdict.createdAt, row.createdAt),
          isNull(gateVerdict.patchDigest),
        ),
      )
      .run();
  })()
    .catch(() => undefined)
    .finally(() => verdictDigestsInFlight.delete(pending));
  verdictDigestsInFlight.add(pending);
}
function apiMergeGate(deps: BuildDeps, row: BuildRow): { todoRow: TodoRow; failed: boolean } {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${row.todoId}`);
  const failed = todoRow.phase === 'failed';
  if (failed) {
    assertDeliveredBuild(deps, row);
  } else {
    assertPhaseTransition(todoRow.phase, 'done');
    if (todoRow.phase !== 'review') {
      throw new HttpError(409, `合并只在审核关口发起，当前相位 ${todoRow.phase}`);
    }
  }
  if (todoRow.latestBuildId !== null && todoRow.latestBuildId !== row.id) {
    throw new HttpError(
      409,
      `这次运行已不是任务的当前运行（任务重跑过），cairn 不经它合并 PR #${row.prNumber}`,
    );
  }
  const busy = stepKindInFlight(deps, row.id);
  if (busy !== null) {
    throw new HttpError(
      409,
      busy === 'review'
        ? '本任务还有一个审核步在跑：等审核结论出来再合并。'
        : `本任务还有一个${STEP_KIND_TEXT[busy]}步在排队或在跑，它收尾时还会推送提交：等它跑完再合并。`,
    );
  }
  assertCorrectionDone(deps.db, todoRow);
  return { todoRow, failed };
}

const CLOSING_SHAPE = /(?<![a-z])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*\S*\d/i;

const PLAIN_MERGE_BODY = 'Merged by cairn.';

function unclearReason(result: Extract<GithubMergeResult, { kind: 'unknown' }>): string {
  switch (result.reason) {
    case 'timeout':
      return '请求超时';
    case 'network':
      return '网络错误';
    case 'malformed':
      return `HTTP ${result.status}，应答读不出`;
    case 'status':
      return `HTTP ${result.status}`;
  }
}

async function mergeThroughGithub(
  deps: BuildDeps,
  row: BuildRow,
  prNumber: number,
  repoRef: GithubRepoRef,
  actor: string,
): Promise<{ delegated: true }> {
  apiMergeGate(deps, row);
  await assertNoMergedPrElsewhere(deps, row, prNumber);
  const gate = apiMergeGate(deps, row);
  assertMergeTools(deps, gate.todoRow);
  const hint = gate.failed
    ? '在 GitHub 上合并后再点一次合并：cairn 把卡恢复到审核关口，由对账核对后收尾'
    : 'cairn 对账读到合并后核对并收尾（核对不上时在时间线说明，由人处理，例如完成时不勾合并）';
  const access = await teamUserToken(deps, gate.todoRow.teamId);
  if ('reason' in access) {
    if (access.reason === 'no-secret-box') {
      throw new HttpError(
        409,
        `PR #${prNumber} 要经 GitHub 合并，但 server 没有配置密钥（secret box），读不了团队的 GitHub 连接：请检查 server 的密钥配置。`,
      );
    }
    const reconnect = access.reason === 'token-unreadable';
    const connect = reconnect ? '重新连接 GitHub' : '连接 GitHub';
    const next = gate.failed
      ? `任务处于失败态：${connect} 后再点合并`
      : `请${connect} 后再点合并，或直接在 GitHub 上合并这张 PR（${hint}；私有仓库没有连接时对账读不到它）`;
    throw new HttpError(
      409,
      reconnect
        ? `PR #${prNumber} 要经 GitHub 合并，但团队的 GitHub 连接解不开（密钥换过或密文损坏）：${next}。`
        : `PR #${prNumber} 要经 GitHub 合并，但团队没有连接 GitHub：${next}。`,
    );
  }
  const token = access.token;
  if (mergingBuilds.has(row.id)) {
    throw new HttpError(409, `PR #${prNumber} 的合并请求正在进行，等它返回后再试。`);
  }
  mergingBuilds.add(row.id);
  try {
    const fetchImpl = deps.githubFetch ?? fetch;
    const page = await githubPull(fetchImpl, token, repoRef.owner, repoRef.repo, prNumber);
    const before = apiMergeGate(deps, row);
    if (before.todoRow.phase !== gate.todoRow.phase) {
      throw new HttpError(409, `读取 PR 期间任务相位已变为 ${before.todoRow.phase}，没有发起合并`);
    }
    const pull = page?.pull ?? null;
    const branch = conversationBranch(row.id);
    if (pull === null || !hasPullFields(pull) || pull.title === null || pull.headSha === null) {
      throw new HttpError(
        409,
        `读不到 PR #${prNumber} 在 GitHub 上的状态（网络、限流或 GitHub 连接失效），没有发起合并：稍后再试。`,
      );
    }
    if (pull.state === 'closed' && !pull.merged) {
      throw new HttpError(
        409,
        `PR #${prNumber} 在 GitHub 上已关闭且未合并，无法合并：重新打开它，或重新运行任务。`,
      );
    }
    if (!isOwnPull(pull, branch)) {
      throw new HttpError(
        409,
        `PR #${prNumber} 的 head 不是本任务在 ${repoRef.owner}/${repoRef.repo} 的工作分支「${branch}」，cairn 不合并它：请在 GitHub 上核对这张 PR。`,
      );
    }
    if (!WRITE_AUTHOR_ASSOCIATIONS.has(pull.authorAssociation ?? '')) {
      throw new HttpError(
        409,
        `PR #${prNumber} 的作者对仓库没有写权限（author_association ${githubText(pull.authorAssociation ?? '缺失')}），cairn 不经 API 合并它：请在 GitHub 上核对后合并（${hint}）。`,
      );
    }
    const baseBranch = projectOfTodo(deps.db, before.todoRow)?.baseBranch ?? pull.defaultBranch;
    if (pull.baseRef !== baseBranch) {
      throw new HttpError(
        409,
        `PR #${prNumber} targets branch "${githubText(pull.baseRef)}" instead of project base branch "${githubText(baseBranch)}". Check the PR base on GitHub before merging.`,
      );
    }
    if (pull.merged) {
      if (!gate.failed) {
        throw new HttpError(409, `PR #${prNumber} 已在 GitHub 合并，没有再发起合并：${hint}。`);
      }
      setTodoPhase(deps, row.todoId, 'review');
      insertMessageRow(deps, row.id, {
        id: newRecordId(),
        role: 'system',
        content: `PR #${prNumber} 已在 GitHub 合并：任务回到审核关口，cairn 对账核对后收尾（核对不上时在时间线说明）。`,
        createdAt: nowMs(),
      });
      return { delegated: true };
    }
    const checkpoint = lastPushedCheckpoint(deps, row.id, { mergeSteps: true });
    if (checkpoint === null || !isFullSha(checkpoint)) {
      throw new HttpError(
        409,
        `本任务没有可核对的推送提交（执行步没回报有效的提交 SHA），cairn 不经 GitHub 合并 PR #${prNumber}：请在 GitHub 上核对后合并（${hint}），或重新运行任务。`,
      );
    }
    if (pull.headSha !== checkpoint) {
      throw new HttpError(
        409,
        `PR #${prNumber} 的 head 是 ${githubText(pull.headSha).slice(0, 7)}，不是本任务最后推送的提交 ${checkpoint.slice(0, 7)}：GitHub 可能还没同步刚推的提交（稍后再点），或分支上有了别的提交（有人推送，或点了 Update branch）。cairn 只合并它推送过的提交；请在 GitHub 上核对后合并（${hint}），或让任务再跑一轮。`,
      );
    }
    const titled = `${pull.title} (#${prNumber})`;
    if (await readGithubAutonomyPause(fetchImpl, token, `${repoRef.owner}/${repoRef.repo}`)) {
      throw new HttpError(409, 'autonomy-paused: GitHub autonomy marker is open or unreadable');
    }
    await assertMergeRequiredChecks(fetchImpl, token, repoRef, pull.baseRef, checkpoint);
    const closing = apiMergeGate(deps, row);
    await ensurePullClosesTaskIssue(
      fetchImpl,
      token,
      repoRef,
      prNumber,
      closing.todoRow,
      pull.body,
    ).catch((error: unknown) => {
      throw new HttpError(
        409,
        `PR #${prNumber} 的描述里补不上关闭本任务 issue 的那一行（${error instanceof Error ? githubText(error.message) : '未知错误'}），没有发起合并：稍后再试。`,
      );
    });
    apiMergeGate(deps, row);
    claimAutonomousMerge(deps.db, row.id);
    const result = await githubMergePull(fetchImpl, token, repoRef.owner, repoRef.repo, prNumber, {
      sha: checkpoint,
      commitTitle: CLOSING_SHAPE.test(pull.title) ? `Merge pull request #${prNumber}` : titled,
      commitMessage: withCoAuthor(
        PLAIN_MERGE_BODY,
        readTeamAttributionSettings(deps.db, before.todoRow.teamId).coAuthorTrailer
          ? humanWorkIdentity(deps.db, before.todoRow, row.triggerSource)
          : null,
      ),
    });
    if (result.kind === 'merged' || result.kind === 'refused' || result.kind === 'rate-limited')
      settleAutonomousMerge(deps.db, row.id, result.kind === 'merged' ? 'merged' : 'refused');
    if (result.kind === 'rate-limited') {
      const { limit } = result;
      const when =
        limit.retryAfterSeconds !== null
          ? `，${limit.retryAfterSeconds} 秒后再试`
          : limit.resetAt !== null
            ? `，限流在 ${new Date(limit.resetAt).toISOString()} 解除`
            : '';
      throw new HttpError(
        409,
        `GitHub 限流，没有处理合并 PR #${prNumber} 的请求（HTTP ${limit.status}${when}）${result.message === '' ? '' : `：${githubText(result.message)}`}——稍后再点合并，或直接在那里合并（${hint}）`,
      );
    }
    if (result.kind === 'refused') {
      throw new HttpError(
        409,
        result.status === 401
          ? `GitHub 不认团队的 GitHub 连接（HTTP 401），PR #${prNumber} 没有合并：请重新连接 GitHub 后再点合并。`
          : `GitHub 拒绝合并 PR #${prNumber}（HTTP ${result.status}）${result.message === '' ? '' : `：${githubText(result.message)}`}——可在 GitHub 上处理后直接在那里合并（${hint}）`,
      );
    }
    const now = deps.db
      .select({ phase: todo.phase })
      .from(todo)
      .where(eq(todo.id, row.todoId))
      .get();
    const atGate = now?.phase === gate.todoRow.phase;
    if (atGate && gate.failed) setTodoPhase(deps, row.todoId, 'review');
    insertGateAnnouncement(deps, row.id, MERGE_ANNOUNCEMENT, actor);
    insertMessageRow(deps, row.id, {
      id: newRecordId(),
      role: 'system',
      content:
        result.kind === 'merged'
          ? `PR #${prNumber} 已由 cairn 经 GitHub 合并（squash，合并提交 ${githubText(result.sha).slice(0, 7)}）`
          : `已请 GitHub 合并 PR #${prNumber}，GitHub 没有明确答复（${unclearReason(result)}）。cairn 对账会读这张 PR：已合并就收尾；还开着就留在审核关口，可以再点合并。`,
      createdAt: nowMs(),
    });
    if (result.kind === 'merged' && atGate) finishTodoDone(deps, row.todoId, row.id);
    return { delegated: true };
  } finally {
    mergingBuilds.delete(row.id);
  }
}

const PLAN_REWRITE_PROMPT = buildPlanRewritePrompt();

const REVIEW_REVISE_PROMPT = `用户对方案提出审核反馈，结论含 blocking findings。审核结论：<{conclusion}>。\n\nBlocking findings（必须逐条修复）：\n{blockings}\n\n请忠实按反馈调整方案，输出更新后的 plan.md（覆盖 Context/Changes/Edge cases/Verification 四段），并在结尾一句话摘要本次调整了什么。${PLAN_PRIOR_ART_RULE}`;

function enqueueReviewRevision(
  deps: BuildDeps,
  args: { buildId: string; todoId: string; teamId: string; note: string; revisePrompt: string },
): void {
  setTodoPhase(deps, args.todoId, 'planning');
  insertMessageRow(deps, args.buildId, {
    id: newRecordId(),
    role: 'system',
    content: args.note,
    createdAt: nowMs(),
  });
  enqueueStep(deps, args.buildId, 'plan', args.teamId, args.revisePrompt);
}

export function noteDeliveredPlanResidual(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  reason: string,
): boolean {
  if (stepRow.kind !== 'plan') return false;
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return false;
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow?.phase !== 'confirm') return false;
  const planRow = deps.db
    .select({ id: planTable.id })
    .from(planTable)
    .where(eq(planTable.buildId, stepRow.buildId))
    .get();
  if (planRow === undefined) return false;
  const id = `plan-residual-${stepRow.id}`;
  const content = `Plan step ${stepRow.id} reported a failure after the plan was delivered and the confirm gate was parked: ${reason}. The delivered plan and the confirm gate are unchanged.`;
  const createdAt = nowMs();
  const inserted = deps.db
    .insert(message)
    .values({
      id,
      conversationId: stepRow.buildId,
      role: 'system',
      content,
      createdAt,
      actor: null,
    })
    .onConflictDoNothing()
    .run();
  if (inserted.changes > 0) {
    deps.convHub?.publishMessage(stepRow.buildId, {
      id,
      role: 'system',
      content,
      createdAt,
      actor: null,
    });
  }
  finishScheduledStep(deps, stepRow, { status: 'failed', error: reason });
  return true;
}

export function settleParkedStep(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  outcome: Pick<MachineDoneBody, 'status' | 'errorMessage'>,
): boolean {
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow || !retryIsParked(buildRow.errorMessage ?? '')) return false;
  parkFailedBuild(deps, buildRow.id);
  const owner = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (
    owner &&
    owner.latestBuildId === buildRow.id &&
    owner.archivedAt === null &&
    owner.phase !== 'failed' &&
    canTransitionPhase(owner.phase, 'failed')
  )
    setTodoPhase(deps, owner.id, 'failed');
  const status = outcome.status === 'success' ? 'done' : outcome.status;
  const finishedAt = nowMs();
  if (outcome.status !== 'success') releaseUnissuedMergeAdmission(deps.db, stepRow);
  deps.db
    .update(step)
    .set({ status, finishedAt, archiveStop: null })
    .where(eq(step.id, stepRow.id))
    .run();
  deps.db.delete(stopPending).where(eq(stopPending.stepId, stepRow.id)).run();
  settleAfterStopPhase(deps, stepRow.buildId);
  finishScheduledStep(
    deps,
    stepRow,
    outcome.status === 'failed'
      ? { status: 'failed', error: outcome.errorMessage ?? buildRow.errorMessage ?? 'Task parked' }
      : { status: outcome.status === 'success' ? 'completed' : 'stopped' },
  );
  publishStepRow(deps, { ...stepRow, status, finishedAt, archiveStop: null });
  return true;
}

export function applyStepFailure(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  rawErrorMessage: string,
  report?: VerdictReport,
  preservedCommits?: readonly string[],
): void {
  const { db } = deps;
  if (settleParkedStep(deps, stepRow, { status: 'failed', errorMessage: rawErrorMessage })) return;
  db.delete(stopPending).where(eq(stopPending.stepId, stepRow.id)).run();
  if (
    db.select({ archiveStop: step.archiveStop }).from(step).where(eq(step.id, stepRow.id)).get()
      ?.archiveStop != null
  ) {
    applyStoppedStep(deps, stepRow.id);
    return;
  }
  clearStop(db, stepRow.buildId);
  settleAfterStopPhase(deps, stepRow.buildId);
  releaseUnissuedMergeAdmission(db, stepRow);
  const errorMessage =
    rawErrorMessage.trim() === '' ? `${stepRow.kind} 步异常结束，未上报原因` : rawErrorMessage;
  db.update(step)
    .set({ status: 'failed', finishedAt: nowMs() })
    .where(eq(step.id, stepRow.id))
    .run();
  const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return;
  if (
    noteDeliveredPlanResidual(
      deps,
      stepRow,
      rawErrorMessage.trim() === '' ? 'no reason reported' : rawErrorMessage,
    )
  ) {
    return;
  }
  finishScheduledStep(deps, stepRow, { status: 'failed', error: errorMessage });
  db.update(build).set({ errorMessage }).where(eq(build.id, buildRow.id)).run();
  if (isBuildStepKind(stepRow.kind)) {
    const changes = buildRow.changes;
    const files =
      changes == null
        ? undefined
        : (Array.isArray(changes) ? changes : changes.files).map((f) => f.path);
    insertMessageRow(deps, buildRow.id, {
      id: newRecordId(),
      role: 'system',
      content: buildFailureRowContent({
        reason: errorMessage,
        ...(preservedCommits !== undefined ? { commits: preservedCommits } : {}),
        ...(files !== undefined ? { files } : {}),
        pr: buildRow.prNumber !== null ? { number: buildRow.prNumber, url: buildRow.prUrl } : null,
      }),
      createdAt: nowMs(),
    });
  }
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  const finished = db.select().from(step).where(eq(step.id, stepRow.id)).get();
  const failedStep = finished ?? stepRow;
  emitRuntimeBuildSpan(db, buildRow.id, 'failed');
  persistGateVerdict(deps, failedStep, {
    stepFailed: true,
    extracted: false,
    blocked: false,
    report: report ?? reportedVerdictHeads(failedStep, { commit: failedStep.checkpointCommit }),
  });
  parkFailedBuild(deps, buildRow.id);
  if (
    todoRow &&
    todoRow.latestBuildId === buildRow.id &&
    todoRow.archivedAt === null &&
    canTransitionPhase(todoRow.phase, 'failed')
  ) {
    setTodoPhase(deps, todoRow.id, 'failed');
  }
}

export function failStepWithEvents(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  reason: string,
): void {
  applyStepFailure(deps, stepRow, reason);
  const failedBuild = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (failedBuild) publishBuild(deps, failedBuild);
  const failedStep = deps.db.select().from(step).where(eq(step.id, stepRow.id)).get();
  if (failedStep) {
    deps.convHub?.publishStep(stepRow.buildId, {
      id: failedStep.id,
      buildId: failedStep.buildId,
      kind: failedStep.kind,
      machineId: failedStep.machineId,
      createdAt: failedStep.createdAt,
      status: failedStep.status,
      checkpointCommit: failedStep.checkpointCommit,
      skillInjection: failedStep.skillInjection ?? null,
    });
  }
}

export const BUILD_ABANDONED_STEP_MS = 120_000;
export const ABANDONED_CLAIM_QUARANTINE_LIMIT = 3;

export function sweepAbandonedBuildSteps(deps: BuildDeps, now: number = nowMs()): void {
  const exitedLeftovers = deps.db
    .select({ id: step.id })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(
      and(
        or(isNotNull(todo.archivedAt), inArray(todo.phase, ['closed', 'done'])),
        inArray(step.status, [...UNSTARTED_STEP_STATUSES]),
      ),
    )
    .all();
  for (const { id } of exitedLeftovers) stopStepKeepPhase(deps, id);
  const candidates = deps.db
    .select()
    .from(step)
    .where(
      and(
        inArray(step.kind, ['plan', 'build', 'session', 'merge', 'review', 'verify']),
        inArray(step.status, ['pending', 'claimed']),
      ),
    )
    .all();
  for (const row of candidates) {
    if (row.status === 'pending') continue;
    const buildRow = deps.db.select().from(build).where(eq(build.id, row.buildId)).get();
    if (!buildRow) continue;
    const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (!todoRow) continue;
    const ending = abandonedEnding(deps, row, todoRow, now);
    if (ending === null || parseShipGateInstruction(row.prompt) !== null) continue;
    applyAbandonedEnding(deps, row, todoRow, ending);
  }
}

type AbandonedEnding = 'stop' | 'release';

function abandonedEnding(
  deps: BuildDeps,
  row: typeof step.$inferSelect,
  todoRow: typeof todo.$inferSelect,
  now: number,
): AbandonedEnding | null {
  if (now - stepActivityAt(row) <= BUILD_ABANDONED_STEP_MS) return null;
  const machineRow = row.machineId
    ? deps.db.select().from(machine).where(eq(machine.id, row.machineId)).get()
    : undefined;
  const progressed =
    row.lastHeartbeatAt !== null && row.lastHeartbeatAt > (row.claimedAt ?? row.createdAt);
  if (machineRow?.online && progressed) return null;
  return row.archiveStop !== null ||
    todoRow.archivedAt !== null ||
    todoRow.phase === 'closed' ||
    todoRow.phase === 'done'
    ? 'stop'
    : 'release';
}

function applyAbandonedEnding(
  deps: BuildDeps,
  row: typeof step.$inferSelect,
  todoRow: typeof todo.$inferSelect,
  ending: AbandonedEnding,
): void {
  if (ending === 'stop') stopStepKeepPhase(deps, row.id);
  else releaseClaimedStep(deps, row, todoRow);
}

export async function sweepAbandonedShipSteps(
  deps: BuildDeps,
  now: number = nowMs(),
): Promise<void> {
  const candidates = deps.db
    .select()
    .from(step)
    .where(and(eq(step.kind, 'merge'), eq(step.status, 'claimed')))
    .all()
    .filter((row) => parseShipGateInstruction(row.prompt) !== null);
  for (const row of candidates) {
    const todoRow = todoOfBuild(deps, row.buildId);
    if (todoRow === undefined || abandonedEnding(deps, row, todoRow, now) === null) continue;
    const violation = await settleAbandonedShip(deps, row);
    const current = deps.db.select().from(step).where(eq(step.id, row.id)).get();
    const currentTodo = todoOfBuild(deps, row.buildId);
    if (
      current?.status !== 'claimed' ||
      current.claimedAt !== row.claimedAt ||
      currentTodo === undefined
    )
      continue;
    if (violation !== null) {
      applyStepFailure(deps, current, violation);
      continue;
    }
    const ending = abandonedEnding(deps, current, currentTodo, now);
    if (ending !== null) applyAbandonedEnding(deps, current, currentTodo, ending);
  }
}

function todoOfBuild(deps: BuildDeps, buildId: string): typeof todo.$inferSelect | undefined {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  return buildRow && deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
}

function releaseClaimedStep(
  deps: BuildDeps,
  row: typeof step.$inferSelect,
  todoRow: typeof todo.$inferSelect,
): void {
  if (row.archiveStop !== null) {
    applyStoppedStep(deps, row.id);
    return;
  }
  if (row.kind === 'merge' && row.prompt?.includes('"local-merge"')) {
    const projectRow = projectOfTodo(deps.db, todoRow);
    if (projectRow && projectMergeConfigOf(projectRow).mergePolicy === 'autonomous') return;
  }
  const noProgress =
    row.lastHeartbeatAt === null || row.lastHeartbeatAt <= (row.claimedAt ?? row.createdAt);
  const claims = noProgress ? row.claimCount + 1 : row.claimCount;
  if (noProgress && claims >= ABANDONED_CLAIM_QUARANTINE_LIMIT) {
    applyStepFailure(
      deps,
      row,
      `crashed ${claims} times after being claimed without progress; quarantined`,
    );
  } else {
    deps.db
      .update(step)
      .set({ status: 'pending', machineId: null, claimCount: claims })
      .where(eq(step.id, row.id))
      .run();
  }
  const released = deps.db.select().from(step).where(eq(step.id, row.id)).get();
  if (released) {
    deps.convHub?.publishStep(row.buildId, {
      id: released.id,
      buildId: released.buildId,
      kind: released.kind,
      machineId: released.machineId,
      createdAt: released.createdAt,
      status: released.status,
      checkpointCommit: released.checkpointCommit,
      skillInjection: released.skillInjection ?? null,
    });
  }
  deps.machineHub?.wake(todoRow.teamId);
}

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

function latestPlanRow(
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

function planContractOfStep(
  deps: BuildDeps,
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

function planAutoConfirmation(deps: Pick<BuildDeps, 'db'>, buildId: string): PlanAutoConfirmation {
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

export function planAutoApproveAt(deps: BuildDeps, planId: string): number | null {
  const planRow = deps.db.select().from(planTable).where(eq(planTable.id, planId)).get();
  if (planRow === undefined) return null;
  const eligibility = planAutoConfirmation(deps, planRow.buildId);
  return eligibility.eligible && eligibility.planId === planId ? eligibility.deadline : null;
}

function confirmPlanAutomatically(deps: BuildDeps, buildId: string): void {
  try {
    applyBuildConfirm(deps, buildId, 'server');
  } catch (error) {
    if (
      !(
        error instanceof HttpError &&
        error.status === 409 &&
        (error.message.startsWith('agent-label-privileged:') ||
          error.message.startsWith('intake-label-assignment-failed:'))
      )
    )
      throw error;
  }
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

export function sweepPlanAutoConfirm(deps: BuildDeps): void {
  const waiting = deps.db.select().from(todo).where(eq(todo.phase, 'confirm')).all();
  for (const todoRow of waiting) {
    if (todoRow.latestBuildId === null) continue;
    if (planAutoConfirmation(deps, todoRow.latestBuildId).eligible)
      confirmPlanAutomatically(deps, todoRow.latestBuildId);
  }
}

function hasFailureRow(deps: BuildDeps, buildId: string, reason: string): boolean {
  return deps.db
    .select({ content: message.content })
    .from(message)
    .where(and(eq(message.conversationId, buildId), eq(message.role, 'system')))
    .all()
    .some((row) => {
      const parsed = systemRowOf(row.content);
      return parsed?.kind === BUILD_FAILURE_ROW_KIND && parsed.reason === reason;
    });
}

export function completeStep(
  deps: BuildDeps,
  stepId: string,
  outcome: {
    hasChanges?: boolean;
    workBranchDrift?: { expected: string; actual: string };
    findings?: ReviewVerdict;
    findingsError?: string;
    verifyVerdict?: VerifyVerdict;
    verifyVerdictError?: string;
    report?: string;
    verdictReport?: VerdictReport;
  } = {},
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
  if (
    isBuildStepKind(stepRow.kind) &&
    canTransitionPhase(todoRow.phase, 'needs_input') &&
    pendingWorkerQuestions(deps.db, stepRow.buildId).length > 0
  ) {
    setTodoPhase(
      deps,
      todoRow.id,
      'needs_input',
      outcome.hasChanges !== undefined ? { hasChanges: outcome.hasChanges } : {},
    );
    return;
  }
  if (isBuildStepKind(stepRow.kind) && todoRow.output === 'info') {
    if (outcome.report !== undefined && deps.attachmentsDir !== undefined) {
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
    }
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
    const verdict: ReviewVerdict = outcome.findings ?? {
      conclusion: outcome.findingsError !== undefined ? '判定提取失败' : '审核未返回结论',
      findings: [],
    };
    deps.db
      .update(todo)
      .set({ hasChanges: false, v: todoRow.v + 1 })
      .where(eq(todo.id, todoRow.id))
      .run();
    const updatedTodo = getTodo(deps, todoRow.id);
    if (updatedTodo) deps.hub.publishTodoDoc(updatedTodo.teamId, updatedTodo);
    insertMessageRow(deps, buildRow.id, {
      id: newRecordId(),
      role: 'system',
      content: JSON.stringify({
        kind: REVIEW_VERDICT_KIND,
        stepId: stepRow.id,
        verdict,
        ...(outcome.findingsError !== undefined ? { extractionError: outcome.findingsError } : {}),
      }),
      createdAt: nowMs(),
    });
    persistGateVerdict(deps, stepRow, {
      stepFailed: false,
      extracted: outcome.findings !== undefined,
      blocked: outcome.findings !== undefined && hasBlockingFinding(outcome.findings),
      report:
        outcome.verdictReport ??
        reportedVerdictHeads(stepRow, { commit: stepRow.checkpointCommit }),
    });
    if (hasBlockingFinding(verdict)) {
      const revisionInFlight = deps.db
        .select({ id: step.id })
        .from(step)
        .where(
          and(
            eq(step.buildId, stepRow.buildId),
            eq(step.kind, 'plan'),
            inArray(step.status, ['pending', 'claimed']),
          ),
        )
        .get();
      if (revisionInFlight === undefined) {
        const blockings = verdict.findings
          .filter((f) => f.severity === 'blocking')
          .map(
            (f) =>
              `- #${f.id} ${f.summary}${
                f.file !== undefined
                  ? ` (${f.file}${f.line !== undefined ? `:${f.line}` : ''})`
                  : ''
              }`,
          )
          .join('\n');
        const revisePrompt = REVIEW_REVISE_PROMPT.replace(
          '<{conclusion}>',
          verdict.conclusion,
        ).replace('{blockings}', blockings);
        enqueueReviewRevision(deps, {
          buildId: stepRow.buildId,
          todoId: todoRow.id,
          teamId: todoRow.teamId,
          note: `AI 审核检测到 ${blockings.split('\n').length} 处 blocking 风险，已自动入队重规划步`,
          revisePrompt,
        });
      }
    }
    return;
  }
  if (stepRow.kind === 'verify') {
    const latestPlan = latestPlanRow(deps, buildRow.id);
    const verdict: VerifyVerdict =
      outcome.verifyVerdict !== undefined
        ? reconcileVerifyVerdict(
            outcome.verifyVerdict,
            planVerificationItems(latestPlan?.content ?? ''),
          )
        : {
            passed: false,
            conclusion:
              outcome.verifyVerdictError !== undefined ? '判定提取失败' : '验证未返回结论',
            evidence: [],
          };
    insertMessageRow(deps, buildRow.id, {
      id: newRecordId(),
      role: 'system',
      content: JSON.stringify({
        kind: VERIFY_VERDICT_KIND,
        ...(buildRow.evidenceStore === 'attachments' ? { stepId: stepRow.id } : {}),
        verdict,
        ...(outcome.verifyVerdictError !== undefined
          ? { extractionError: outcome.verifyVerdictError }
          : {}),
      }),
      createdAt: nowMs(),
    });
    persistGateVerdict(deps, stepRow, {
      stepFailed: false,
      extracted: outcome.verifyVerdict !== undefined,
      blocked: outcome.verifyVerdict !== undefined && !verdict.passed,
      report:
        outcome.verdictReport ??
        reportedVerdictHeads(stepRow, { commit: stepRow.checkpointCommit }),
    });
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

export function roundStart(deps: BuildDeps, buildId: string): number {
  return (
    deps.db
      .select({ at: step.createdAt })
      .from(step)
      .where(and(eq(step.buildId, buildId), inArray(step.kind, ['build', 'session', 'plan'])))
      .orderBy(desc(step.createdAt))
      .get()?.at ?? 0
  );
}

export function hasMessageRow(
  deps: BuildDeps,
  buildId: string,
  role: 'system' | 'user',
  content: string,
  since = 0,
): boolean {
  return (
    deps.db
      .select({ id: message.id })
      .from(message)
      .where(
        and(
          eq(message.conversationId, buildId),
          eq(message.role, role),
          eq(message.content, content),
          gte(message.createdAt, since),
        ),
      )
      .get() !== undefined
  );
}

export function finishTodoDone(deps: BuildDeps, todoId: string, buildId: string): void {
  const current = deps.db
    .select({ phase: todo.phase })
    .from(todo)
    .where(eq(todo.id, todoId))
    .get()?.phase;
  if (current !== undefined) assertPhaseTransition(current, 'done');
  stopUnclaimedGateSteps(deps, buildId);
  setTodoPhase(deps, todoId, 'done', {}, { landedMerge: true });
  insertMessageRow(deps, buildId, {
    id: newRecordId(),
    role: 'system',
    content: DONE_ROW,
    createdAt: nowMs(),
  });
  emitRuntimeBuildSpan(deps.db, buildId, 'done');
  markFirstPrPromptDue(deps.db, buildId);
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}
